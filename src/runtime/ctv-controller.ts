import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import * as vscode from 'vscode';
import type { CucumberProject } from '../types';
import useCtvConfig from '../use-ctv-config';

const runWorkerPath = path.resolve(__dirname, 'run-worker.js');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — warm-worker eviction timeout
const DEBUG_CONFIG_NAME = 'Attach Cucumber-tsflow Debug';

// Worker lifecycle states
const enum WorkerState {
	'new',
	'idle',
	'running',
	'reloading',
	'closed'
}

// --- IPC: Controller → Worker ---

export interface InitializeCommand {
	type: 'INITIALIZE';
	debug?: boolean;
}

export interface RunCommand {
	type: 'RUN';
	testId: string;
	featurePath: string;
	lineNumber: number;
}

export interface IdleCommand {
	type: 'IDLE';
}

export interface ReloadCommand {
	type: 'RELOAD';
	changedPaths: string[];
}

export interface ShutdownCommand {
	type: 'SHUTDOWN';
}

export interface EnableInspectorCommand {
	type: 'ENABLE_INSPECTOR';
	port: number;
}

export interface DisableInspectorCommand {
	type: 'DISABLE_INSPECTOR';
}

export type CoordinatorToWorkerCommand =
	| InitializeCommand
	| RunCommand
	| IdleCommand
	| ReloadCommand
	| ShutdownCommand
	| EnableInspectorCommand
	| DisableInspectorCommand;

// --- IPC: Worker → Controller ---

export interface ReadyEvent {
	type: 'READY';
}

export interface TestStartedEvent {
	type: 'TEST_STARTED';
	testId: string;
}

export interface TestPassedEvent {
	type: 'TEST_PASSED';
	testId: string;
}

export interface TestFailedEvent {
	type: 'TEST_FAILED';
	testId: string;
	message: string;
}

export interface TestSkippedEvent {
	type: 'TEST_SKIPPED';
	testId: string;
}

export interface OutputEvent {
	type: 'OUTPUT';
	testId: string;
	text: string;
}

export interface FinishedEvent {
	type: 'FINISHED';
	success: boolean;
}

export interface InspectorReadyEvent {
	type: 'INSPECTOR_READY';
}

export interface InspectorClosedEvent {
	type: 'INSPECTOR_CLOSED';
}

export type WorkerToCoordinatorEvent =
	| ReadyEvent
	| TestStartedEvent
	| TestPassedEvent
	| TestFailedEvent
	| TestSkippedEvent
	| OutputEvent
	| FinishedEvent
	| InspectorReadyEvent
	| InspectorClosedEvent;

/** Scenario location data used to build RUN commands. */
export type ScenarioLocation = {
	featurePath: string;
	lineNumber: number;
};

interface ManagedWorker {
	state: WorkerState;
	process: ChildProcess;
	id: string;
	currentTestId?: string;
	/** True once inspector.open() has been called in this worker process. */
	debugInspectorOpen: boolean;
	/** True when a step file changed while this worker was running tests. */
	pendingReload: boolean;
}

/**
 * Controls a pool of persistent worker processes that run cucumber tests.
 * Workers are reused across runs; idle workers reload support code incrementally
 * when step files change, and are evicted after 5 minutes of inactivity.
 */
export class CtvController {
	private readonly profileName: string;
	private readonly cucumberProject: CucumberProject;

	// Persistent warm-worker pool
	private warmWorkers: ManagedWorker[] = [];
	private warmTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private nextWorkerId = 0;

	// Per-run state
	private runWorkers: ManagedWorker[] = [];
	private pendingWorkerCount = 0;
	private todo: Array<vscode.TestItem> = [];
	private allItems = new Map<string, vscode.TestItem>();
	private testRun: vscode.TestRun | null = null;
	private cancellationToken: vscode.CancellationToken | null = null;
	private scenarioLocations = new Map<string, ScenarioLocation>();
	private failing = false;
	private currentRunDebug = false;
	private resolveRun?: (success: boolean) => void;

	// Debug session state
	private debugTerminatedListener?: vscode.Disposable;
	private activeDebugSession?: vscode.DebugSession;

	constructor(profileName: string, project: CucumberProject) {
		this.profileName = profileName;
		this.cucumberProject = project;
	}

	/**
	 * Run a set of scenario test items, reusing warm pool workers where possible
	 * and forking new ones only as needed.
	 */
	async run(
		testItems: ReadonlyArray<vscode.TestItem>,
		testRun: vscode.TestRun,
		scenarioLocations: Map<string, ScenarioLocation>,
		cancellationToken: vscode.CancellationToken,
		debug = false
	): Promise<boolean> {
		this.todo = Array.from(testItems);
		this.allItems = new Map(testItems.map(item => [item.id, item]));
		this.testRun = testRun;
		this.scenarioLocations = scenarioLocations;
		this.cancellationToken = cancellationToken;
		this.failing = false;
		this.currentRunDebug = debug;
		this.runWorkers = [];

		cancellationToken.onCancellationRequested(() => this.handleCancellation());

		const ctvConfig = useCtvConfig().getConfig();
		// Debug runs use at most one worker (shared inspector port).
		const maxWorkers = debug ? 1 : ctvConfig.workerCount;
		const workerCount = Math.max(1, Math.min(maxWorkers, testItems.length));
		const warmToAcquire = debug ? Math.min(1, this.warmWorkers.length) : Math.min(workerCount, this.warmWorkers.length);
		const toFork = workerCount - warmToAcquire;

		return new Promise<boolean>(resolve => {
			this.resolveRun = resolve;
			this.pendingWorkerCount = workerCount;

			// Acquire warm workers
			for (let i = 0; i < warmToAcquire; i++) {
				const worker = this.warmWorkers.shift()!;
				clearTimeout(this.warmTimers.get(worker.id));
				this.warmTimers.delete(worker.id);
				worker.state = WorkerState.running;
				this.runWorkers.push(worker);
				if (debug) {
					// Warm worker reused for debug — always open a fresh inspector.
					// The inspector was closed when the worker returned to the warm pool,
					// so we need to re-enable it and re-attach VS Code.
					worker.process.send({
						type: 'ENABLE_INSPECTOR',
						port: ctvConfig.debugPort
					} satisfies EnableInspectorCommand);
				} else {
					this.giveWork(worker);
				}
			}

			// Fork new workers. Debug workers start with --inspect so V8 is inspector-ready
			// before any user code runs. READY triggers attach + giveWork in the handler.
			for (let i = 0; i < toFork; i++) {
				this.startWorker(String(this.nextWorkerId++), debug);
			}
		});
	}

	/**
	 * Notify all idle warm workers that a step file has changed.
	 * Each worker reloads its support code library incrementally via reloadSupport.
	 */
	/**
	 * Notify warm (and currently-running) workers that a step file changed.
	 * Warm workers reload immediately. Running workers are flagged so they
	 * reload before re-entering the pool once their current tests finish.
	 */
	notifyFileChanged(changedPath: string): void {
		// Warm workers: send RELOAD right away
		if (this.warmWorkers.length > 0) {
			const workers = [...this.warmWorkers];
			this.warmWorkers = [];
			for (const worker of workers) {
				clearTimeout(this.warmTimers.get(worker.id));
				this.warmTimers.delete(worker.id);
				worker.state = WorkerState.reloading;
				worker.process.send({ type: 'RELOAD', changedPaths: [changedPath] } satisfies ReloadCommand);
			}
		}
		// Running workers: flag them; they will reload in drainWorker when tests finish
		for (const worker of this.runWorkers) {
			if (worker.state === WorkerState.running) {
				worker.pendingReload = true;
			}
		}
	}

	/**
	 * Shut down all warm workers and release resources. Call when the extension
	 * is deactivated or the project is closing.
	 */
	dispose(): void {
		this.stopDebugSession();
		for (const timer of this.warmTimers.values()) clearTimeout(timer);
		this.warmTimers.clear();
		for (const worker of this.warmWorkers) {
			this.sendShutdown(worker);
		}
		this.warmWorkers = [];
	}

	// --- Worker lifecycle ---

	private startWorker(id: string, debug: boolean): void {
		const ctvConfig = useCtvConfig().getConfig();
		// Debug workers use --inspect-brk so V8 pauses at entry before any user
		// code runs. The debugger attaches while paused, sets breakpoints, then
		// resumes — guaranteeing breakpoints are in place before step code executes.
		const execArgv = debug ? [`--inspect-brk=${ctvConfig.debugPort}`] : [];

		const workerProcess = fork(runWorkerPath, ['-p', this.profileName], {
			cwd: this.cucumberProject.path,
			execArgv,
			silent: true,
			env: {
				...process.env,
				// Prevent the child from inheriting --inspect flags from the extension host
				NODE_OPTIONS: '',
				WORKER_ID: id,
				PROJECT_PATH: ctvConfig.projectPath ?? '',
				FORCE_COLOR: '1'
			}
		});

		const managedWorker: ManagedWorker = {
			state: WorkerState.new,
			process: workerProcess,
			id,
			debugInspectorOpen: debug,
			pendingReload: false
		};
		this.runWorkers.push(managedWorker);

		workerProcess.on('message', (message: WorkerToCoordinatorEvent) => {
			this.handleWorkerMessage(managedWorker, message);
		});

		// Capture stdout from the worker and forward to the active TestItem's output
		workerProcess.stdout?.on('data', (chunk: Buffer) => {
			const text = chunk.toString().replace(/(?<!\r)\n/gm, '\r\n');
			const testItem = managedWorker.currentTestId ? this.allItems.get(managedWorker.currentTestId) : undefined;
			this.testRun?.appendOutput(text, undefined, testItem);
		});

		workerProcess.stderr?.on('data', (chunk: Buffer) => {
			const text = chunk.toString();
			// Suppress debugger attachment noise
			if (!text.includes('Debugger attached')) {
				const testItem = managedWorker.currentTestId ? this.allItems.get(managedWorker.currentTestId) : undefined;
				this.testRun?.appendOutput(text.replace(/(?<!\r)\n/gm, '\r\n'), undefined, testItem);
			}
		});

		workerProcess.on('close', exitCode => this.handleWorkerClose(managedWorker, exitCode));
		workerProcess.on('error', err => {
			this.testRun?.appendOutput(`Worker ${id} error: ${err.message}\r\n`);
		});

		workerProcess.send({ type: 'INITIALIZE', debug } satisfies InitializeCommand);

		// For debug workers, start attaching the debugger immediately while V8 is
		// paused at entry (--inspect-brk). The debugger sets breakpoints then
		// resumes the worker. By the time the worker sends READY, the debug
		// session is already active so the READY handler just calls giveWork.
		if (debug) {
			this.startDebugSession().catch(() => {
				/* attach failure will surface when the worker closes */
			});
		}
	}

	private sendShutdown(worker: ManagedWorker): void {
		if (worker.state !== WorkerState.closed) {
			try {
				worker.process.send({ type: 'SHUTDOWN' } satisfies ShutdownCommand);
			} catch {
				/* process may already be dead */
			}
		}
	}

	/**
	 * Attach the VS Code debugger to the worker process inspector port.
	 * Waits for the session to fully start and for VS Code to propagate breakpoints
	 * to V8 before resolving, so tests don't begin before breakpoints are set.
	 */
	private async startDebugSession(): Promise<void> {
		if (this.activeDebugSession) return; // already attached

		const ctvConfig = useCtvConfig().getConfig();
		const config: vscode.DebugConfiguration = {
			name: DEBUG_CONFIG_NAME,
			stopOnEntry: false,
			request: 'attach',
			type: 'node',
			port: ctvConfig.debugPort,
			sourceMaps: true,
			...ctvConfig.debugOptions
		};

		// Listen for session start to capture the session reference
		const sessionStarted = new Promise<void>(resolve => {
			const listener = vscode.debug.onDidStartDebugSession(s => {
				if (s.name === DEBUG_CONFIG_NAME) {
					this.activeDebugSession = s;
					listener.dispose();
					resolve();
				}
			});
		});

		// Clear activeDebugSession when the user terminates it manually
		this.debugTerminatedListener?.dispose();
		this.debugTerminatedListener = vscode.debug.onDidTerminateDebugSession(s => {
			if (s === this.activeDebugSession) {
				this.activeDebugSession = undefined;
			}
		});

		await vscode.debug.startDebugging(undefined, config);
		await sessionStarted;
		// No artificial delay needed: fresh workers use --inspect-brk and warm
		// workers call inspector.waitForDebugger(), both of which keep V8 paused
		// until VS Code has finished setting breakpoints and sends
		// Runtime.runIfWaitingForDebugger.
	}

	/** Stop the active VS Code debug session (only called on dispose). */
	private stopDebugSession(): void {
		this.debugTerminatedListener?.dispose();
		this.debugTerminatedListener = undefined;
		if (this.activeDebugSession) {
			vscode.debug.stopDebugging(this.activeDebugSession);
			this.activeDebugSession = undefined;
		}
	}

	// --- Incoming IPC message handling ---

	private handleWorkerMessage(worker: ManagedWorker, message: WorkerToCoordinatorEvent): void {
		switch (message.type) {
			case 'READY':
				if (worker.state === WorkerState.reloading) {
					// Reload complete — return to warm pool with fresh support code
					this.addToWarmPool(worker);
				} else if (this.currentRunDebug) {
					// Fresh debug worker (forked with --inspect): support code loaded,
					// now attach VS Code so breakpoints are set before the first RUN.
					worker.state = WorkerState.idle;
					this.startDebugSession().then(() => this.giveWork(worker));
				} else {
					worker.state = WorkerState.idle;
					this.giveWork(worker);
				}
				break;

			case 'INSPECTOR_READY':
				// Worker opened its inspector dynamically — mark it and attach VS Code
				worker.debugInspectorOpen = true;
				this.startDebugSession().then(() => this.giveWork(worker));
				break;

			case 'INSPECTOR_CLOSED':
				worker.debugInspectorOpen = false;
				break;

			case 'TEST_STARTED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun!.started(item);
				break;
			}

			case 'TEST_PASSED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun!.passed(item);
				worker.state = WorkerState.idle;
				worker.currentTestId = undefined;
				this.giveWork(worker);
				break;
			}

			case 'TEST_FAILED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun!.failed(item, new vscode.TestMessage(message.message));
				this.failing = true;
				worker.state = WorkerState.idle;
				worker.currentTestId = undefined;
				this.giveWork(worker);
				break;
			}

			case 'TEST_SKIPPED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun!.skipped(item);
				worker.state = WorkerState.idle;
				worker.currentTestId = undefined;
				this.giveWork(worker);
				break;
			}

			case 'OUTPUT': {
				const item = this.allItems.get(message.testId);
				this.testRun!.appendOutput(message.text.replace(/(?<!\r)\n/gm, '\r\n'), undefined, item);
				break;
			}

			case 'FINISHED':
				// Worker is exiting (response to SHUTDOWN)
				worker.state = WorkerState.closed;
				break;
		}
	}

	// --- Work distribution ---

	private giveWork(worker: ManagedWorker): void {
		if (this.cancellationToken?.isCancellationRequested) {
			this.drainWorker(worker);
			return;
		}

		const testItem = this.todo.shift();
		if (!testItem) {
			// No more work — drain this worker
			this.drainWorker(worker);
			return;
		}

		const location = this.scenarioLocations.get(testItem.id);
		if (!location) {
			// No scenario location — skip and try the next item
			this.testRun?.skipped(testItem);
			this.giveWork(worker);
			return;
		}

		worker.state = WorkerState.running;
		worker.currentTestId = testItem.id;

		// Output a scenario header so individual tests are visually separated
		const separator = '─'.repeat(60);
		this.testRun?.appendOutput(`\r\n${separator}\r\n`, undefined, testItem);
		this.testRun?.appendOutput(`▶ Scenario: ${testItem.label}\r\n`, undefined, testItem);
		this.testRun?.appendOutput(`${separator}\r\n`, undefined, testItem);

		worker.process.send({
			type: 'RUN',
			testId: testItem.id,
			featurePath: location.featurePath,
			lineNumber: location.lineNumber
		} satisfies RunCommand);
	}

	/**
	 * Called when a worker has exhausted the todo queue or cancellation was
	 * requested. Settles the run counter, then either returns the worker to
	 * the warm pool (run mode) or shuts it down (debug mode).
	 */
	private drainWorker(worker: ManagedWorker): void {
		this.pendingWorkerCount--;
		if (this.pendingWorkerCount <= 0) {
			// Stop the debug session when the last debug worker finishes so the
			// inspector port can be handed to a fresh debug run if needed.
			if (this.currentRunDebug) this.stopDebugSession();
			this.settle(!this.failing);
		}

		// Close the V8 inspector before returning to the warm pool so the
		// debug port is freed for the next debug run.
		if (worker.debugInspectorOpen) {
			worker.process.send({ type: 'DISABLE_INSPECTOR' } satisfies DisableInspectorCommand);
			// INSPECTOR_CLOSED handler will flip debugInspectorOpen to false
		}

		if (worker.pendingReload) {
			// A step file changed while this worker was running. Reload its support
			// code now before returning it to the pool.
			worker.pendingReload = false;
			worker.state = WorkerState.reloading;
			worker.process.send({ type: 'RELOAD', changedPaths: [] } satisfies ReloadCommand);
			// READY from the RELOAD will trigger addToWarmPool via the reloading branch
		} else {
			this.addToWarmPool(worker);
		}
	}

	private addToWarmPool(worker: ManagedWorker): void {
		worker.process.send({ type: 'IDLE' } satisfies IdleCommand);
		worker.state = WorkerState.idle;
		worker.currentTestId = undefined;
		worker.pendingReload = false;
		this.warmWorkers.push(worker);

		// Evict worker after idle timeout to free memory
		const timer = setTimeout(() => {
			const idx = this.warmWorkers.indexOf(worker);
			if (idx >= 0) {
				this.warmWorkers.splice(idx, 1);
				this.warmTimers.delete(worker.id);
				this.sendShutdown(worker);
			}
		}, IDLE_TIMEOUT_MS);
		this.warmTimers.set(worker.id, timer);
	}

	// --- Process close and cancellation ---

	private handleWorkerClose(worker: ManagedWorker, exitCode: number | null): void {
		if (worker.state === WorkerState.closed) return;

		// Remove from warm pool if present (unexpected close while idle)
		const warmIdx = this.warmWorkers.indexOf(worker);
		if (warmIdx >= 0) {
			this.warmWorkers.splice(warmIdx, 1);
			clearTimeout(this.warmTimers.get(worker.id));
			this.warmTimers.delete(worker.id);
			worker.state = WorkerState.closed;
			return;
		}

		// Crash during an active run — count as a failed/drained worker
		if (exitCode !== null && exitCode !== 0 && exitCode !== 2) {
			this.failing = true;
		}
		worker.state = WorkerState.closed;
		this.pendingWorkerCount--;
		if (this.pendingWorkerCount <= 0) {
			this.settle(!this.failing);
		}
	}

	private handleCancellation(): void {
		// Mark all queued items as skipped
		for (const item of this.todo) {
			this.testRun?.skipped(item);
		}
		this.todo = [];

		// Kill all run workers
		for (const worker of this.runWorkers) {
			try {
				worker.process.kill();
			} catch {
				/* ignored */
			}
		}

		// Dispose warm pool as well
		this.dispose();
		this.settle(false);
	}

	/** Resolve the run Promise exactly once. */
	private settle(success: boolean): void {
		const resolve = this.resolveRun;
		this.resolveRun = undefined;
		resolve?.(success);
	}
}
