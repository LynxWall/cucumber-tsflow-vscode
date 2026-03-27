import path from 'node:path';
import ArgvParser from '@lynxwall/cucumber-tsflow/lib/cli/argv-parser';
import type {
	IRunEnvironment,
	ISupportCodeLibrary,
	ITsflowResolvedConfiguration
} from '@lynxwall/cucumber-tsflow/lib/api/index';
import type { CoordinatorToWorkerCommand, RunCommand, WorkerToCoordinatorEvent } from './ctv-controller';
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
	async initialize(): Promise<void> {
		const { options, configuration: argvConfiguration } = ArgvParser.parse(this.argv);

		// Dynamically require the tsflow API from the target project's node_modules
		this.tsflowApi = require(path.join(
			this.env.PROJECT_PATH ?? '',
			'node_modules',
			'@lynxwall',
			'cucumber-tsflow',
			'lib/api'
		)) as TsflowApi;

		this.environment = {
			cwd: this.cwd,
			stdout: this.stdout,
			stderr: this.stderr,
			env: this.env,
			debug: false
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
	 * Clean up resources and signal completion to the controller.
	 */
	private finalize(): void {
		this.sendMessage({ type: 'FINISHED', success: true });
		this.exit(0);
	}

	/**
	 * Receives IPC commands from CtvController and dispatches to the appropriate handler.
	 */
	async receiveMessage(command: CoordinatorToWorkerCommand): Promise<void> {
		switch (command.type) {
			case 'INITIALIZE':
				await this.initialize();
				break;
			case 'RUN':
				await this.runTestCase(command);
				break;
			case 'FINALIZE':
				this.finalize();
				break;
		}
	}
}
