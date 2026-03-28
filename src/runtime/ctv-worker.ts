import path from 'node:path';
import ArgvParser from '@lynxwall/cucumber-tsflow/lib/cli/argv-parser';
import type {
	IRunEnvironment,
	ISupportCodeLibrary,
	ITsflowResolvedConfiguration
} from '@lynxwall/cucumber-tsflow/lib/api/index';
import inspector from 'node:inspector';
import type {
	CoordinatorToWorkerCommand,
	DisableInspectorCommand,
	EnableInspectorCommand,
	InitializeCommand,
	ReloadCommand,
	RunCommand,
	WorkerToCoordinatorEvent
} from './ctv-controller';
import type { TsflowApi } from './Types';

type IExitFunction = (exitCode: number, error?: Error, message?: string) => void;
type IMessageSender = (command: WorkerToCoordinatorEvent) => void;

/**
 * Runs inside a forked process and executes cucumber scenarios on demand.
 * Communicates with CtvController via IPC messages.
 */
export class CtvWorker {
	private readonly argv: string[];
	private readonly cwd: string;
	private readonly stdout: NodeJS.WriteStream;
	private readonly stderr: NodeJS.WriteStream;
	private readonly env: NodeJS.ProcessEnv;
	private readonly id: string;
	private readonly exit: IExitFunction;
	private readonly sendMessage: IMessageSender;

	private tsflowApi!: TsflowApi;
	private environment!: IRunEnvironment;
	private resolvedConfig: ITsflowResolvedConfiguration | null = null;
	private supportCodeLibrary: ISupportCodeLibrary | null = null;

	constructor({
		argv,
		cwd,
		stdout,
		stderr,
		env,
		id,
		exit,
		sendMessage
	}: {
		argv: string[];
		cwd: string;
		stdout: NodeJS.WriteStream;
		stderr: NodeJS.WriteStream;
		env: NodeJS.ProcessEnv;
		id: string;
		exit: IExitFunction;
		sendMessage: IMessageSender;
	}) {
		this.argv = argv;
		this.cwd = cwd;
		this.stdout = stdout;
		this.stderr = stderr;
		this.env = env;
		this.id = id;
		this.exit = exit;
		this.sendMessage = sendMessage;
	}

	/**
	 * Load the cucumber configuration and support code (step definitions).
	 * Sends READY when complete so the controller can begin sending RUN commands.
	 */
	async initialize(command: InitializeCommand): Promise<void> {
		const { options, configuration: argvConfiguration } = ArgvParser.parse(this.argv);

		// Dynamically require the tsflow API from the target project's node_modules
		this.tsflowApi = require(
			path.join(this.env.PROJECT_PATH ?? '', 'node_modules', '@lynxwall', 'cucumber-tsflow', 'lib/api')
		) as TsflowApi;

		this.environment = {
			cwd: this.cwd,
			stdout: this.stdout,
			stderr: this.stderr,
			env: this.env,
			debug: command.debug ?? false
		};

		this.resolvedConfig = await this.tsflowApi.loadConfiguration(
			{
				file: options.config,
				profiles: options.profile,
				provided: argvConfiguration
			},
			this.environment
		);

		// Pre-load support code once so each RUN command doesn't reload step definitions
		this.supportCodeLibrary = await this.tsflowApi.loadSupport(this.resolvedConfig.runConfiguration, this.environment);

		this.sendMessage({ type: 'READY' });
	}

	/**
	 * Execute a single scenario at the given feature file path and line number.
	 * Sends TEST_STARTED, then TEST_PASSED / TEST_FAILED / TEST_SKIPPED on completion.
	 */
	private async runTestCase(command: RunCommand): Promise<void> {
		const { testId, lineNumber } = command;
		let featurePath = command.featurePath;

		// On Windows, vscode paths may have a leading slash — strip it
		if (featurePath.startsWith('/') && process.platform === 'win32') {
			featurePath = featurePath.substring(1);
		}

		this.sendMessage({ type: 'TEST_STARTED', testId });

		try {
			const sourceSpec = `${featurePath}:${lineNumber}`;
			const runConfig = {
				...this.resolvedConfig!.runConfiguration,
				sources: {
					...this.resolvedConfig!.runConfiguration.sources,
					paths: [sourceSpec]
				}
			};

			// Track whether any step had a real failure vs. just being pending/undefined
			let hasHardFailure = false;
			const result = await this.tsflowApi.runCucumber(
				{ ...runConfig, support: this.supportCodeLibrary! },
				this.environment,
				envelope => {
					const status = envelope.testStepFinished?.testStepResult?.status;
					if (status === 'FAILED' || status === 'AMBIGUOUS') {
						hasHardFailure = true;
					}
				}
			);

			if (result.success) {
				this.sendMessage({ type: 'TEST_PASSED', testId });
			} else if (hasHardFailure) {
				this.sendMessage({
					type: 'TEST_FAILED',
					testId,
					message: `Scenario at ${sourceSpec} failed. See test output for details.`
				});
			} else {
				// No step failed outright — scenario has pending or undefined steps
				this.sendMessage({ type: 'TEST_SKIPPED', testId });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.sendMessage({ type: 'TEST_FAILED', testId, message });
		}
	}

	/**
	 * Reload the support code library when a step file changes.
	 * Sends READY when complete so the controller returns this worker to the pool.
	 */
	private async reload(_command: ReloadCommand): Promise<void> {
		// Preserve the current library so a failed reload doesn't leave the
		// worker in a broken state with an empty BindingRegistry.
		const previousLibrary = this.supportCodeLibrary;
		try {
			// The BindingRegistry is a global singleton. Re-requiring changed step files
			// adds new bindings but never removes stale ones from changed/removed steps.
			// Reset it so all decorators re-run against a clean slate.
			(global as Record<string, unknown>)['__CUCUMBER_TSFLOW_BINDINGREGISTRY'] = undefined;

			// Pass empty changedPaths to evict ALL support modules from require.cache.
			// This ensures every decorator re-runs, fully rebuilding the fresh registry.
			// ts-node's own cache still skips recompilation of unchanged TypeScript files.
			this.supportCodeLibrary = await this.tsflowApi.reloadSupport(
				this.resolvedConfig!.runConfiguration,
				[],
				this.environment
			);
			this.sendMessage({ type: 'READY' });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Restore the previous working library so the worker is still usable
			this.supportCodeLibrary = previousLibrary;
			process.stderr.write(`[worker ${this.id}] reloadSupport failed: ${message}\n`);
			this.sendMessage({ type: 'READY' });
		}
	}

	/**
	 * Dynamically open the V8 inspector so the controller can attach a debug session
	 * to a warm (already-initialized) worker without forking a new process.
	 *
	 * After opening the port and notifying the controller, V8 is paused via
	 * waitForDebugger() so the debugger has time to set breakpoints before any
	 * RUN command executes.
	 */
	private enableInspector(command: EnableInspectorCommand): void {
		inspector.open(command.port, '127.0.0.1', false);
		this.sendMessage({ type: 'INSPECTOR_READY' });
		// Pause V8 until the debugger attaches and sends
		// Runtime.runIfWaitingForDebugger. The INSPECTOR_READY IPC message is
		// already in the kernel pipe buffer so the controller can read it and
		// start the debug session while this worker is paused.
		inspector.waitForDebugger();
	}

	/**
	 * Close the V8 inspector so the debug port is released.
	 * Called when the worker returns to the warm pool after a debug run.
	 */
	private disableInspector(): void {
		inspector.close();
		this.sendMessage({ type: 'INSPECTOR_CLOSED' });
	}

	/**
	 * Shut down cleanly — signals the controller then exits.
	 */
	private shutdown(): void {
		this.sendMessage({ type: 'FINISHED', success: true });
		this.exit(0);
	}

	/**
	 * Receives IPC commands from CtvController and dispatches to the appropriate handler.
	 */
	async receiveMessage(command: CoordinatorToWorkerCommand): Promise<void> {
		switch (command.type) {
			case 'INITIALIZE':
				await this.initialize(command);
				break;
			case 'RUN':
				await this.runTestCase(command);
				break;
			case 'IDLE':
				// Stay alive and await the next command — no action needed
				break;
			case 'RELOAD':
				await this.reload(command);
				break;
			case 'ENABLE_INSPECTOR':
				this.enableInspector(command);
				break;
			case 'DISABLE_INSPECTOR':
				this.disableInspector();
				break;
			case 'SHUTDOWN':
				this.shutdown();
				break;
		}
	}
}
