import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import * as vscode from 'vscode';
import type { CucumberProject } from '../types';
import useCtvConfig from '../use-ctv-config';

const runWorkerPath = path.resolve(__dirname, 'run-worker.js');

// Worker lifecycle states
const enum WorkerState {
	'new',
	'idle',
	'running',
	'closed'
}

// --- IPC: Controller → Worker ---

export interface InitializeCommand {
	type: 'INITIALIZE';
}

export interface RunCommand {
	type: 'RUN';
	testId: string;
	featurePath: string;
	lineNumber: number;
}

export interface FinalizeCommand {
	type: 'FINALIZE';
}

export type CoordinatorToWorkerCommand = InitializeCommand | RunCommand | FinalizeCommand;

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

export type WorkerToCoordinatorEvent =
	| ReadyEvent
	| TestStartedEvent
	| TestPassedEvent
	| TestFailedEvent
	| TestSkippedEvent
	| OutputEvent
	| FinishedEvent;

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
}

/**
 * Controls a forked worker process that runs cucumber tests.
 * Manages work distribution and maps worker results back to a VS Code TestRun.
 */
export class CtvController {
	private readonly profileName: string;
	private readonly cucumberProject: CucumberProject;
	private workers: ManagedWorker[] = [];
	private pendingWorkerCount = 0;
	private todo: Array<vscode.TestItem> = [];
	private allItems = new Map<string, vscode.TestItem>();
	private testRun: vscode.TestRun | null = null;
	private cancellationToken: vscode.CancellationToken | null = null;
	private scenarioLocations = new Map<string, ScenarioLocation>();
	private failing = false;
	private resolveRun?: (success: boolean) => void;

	constructor(profileName: string, project: CucumberProject) {
		this.profileName = profileName;
		this.cucumberProject = project;
	}

	/**
	 * Run a set of scenario test items through a forked worker process.
	 * Reports results directly to the VS Code TestRun.
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
		this.workers = [];

		cancellationToken.onCancellationRequested(() => this.handleCancellation());

		const ctvConfig = useCtvConfig().getConfig();
		const workerCount = Math.max(1, Math.min(ctvConfig.workerCount, testItems.length));

		return new Promise<boolean>(resolve => {
			this.resolveRun = resolve;
			this.pendingWorkerCount = workerCount;
			for (let i = 0; i < workerCount; i++) {
				this.startWorker(String(i), debug);
			}
		});
	}

	// --- Worker lifecycle ---

	private startWorker(id: string, debug: boolean): void {
		const ctvConfig = useCtvConfig().getConfig();
		const execArgv: string[] = debug ? [`--inspect=${ctvConfig.debugPort}`] : [];

		const workerProcess = fork(runWorkerPath, ['-p', this.profileName], {
			cwd: this.cucumberProject.path,
			execArgv,
			silent: true,
			env: {
				...process.env,
				WORKER_ID: id,
				PROJECT_PATH: ctvConfig.projectPath ?? '',
				FORCE_COLOR: '1'
			}
		});

		const managedWorker: ManagedWorker = { state: WorkerState.new, process: workerProcess, id };
		this.workers.push(managedWorker);

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

		workerProcess.send({ type: 'INITIALIZE' } satisfies InitializeCommand);
	}

	// --- Incoming IPC message handling ---

	private handleWorkerMessage(worker: ManagedWorker, message: WorkerToCoordinatorEvent): void {
		if (!this.testRun) return;

		switch (message.type) {
			case 'READY':
				// Worker finished initialization — send the first test
				worker.state = WorkerState.idle;
				this.giveWork(worker);
				break;

			case 'TEST_STARTED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun.started(item);
				break;
			}

			case 'TEST_PASSED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun.passed(item);
				worker.state = WorkerState.idle;
				worker.currentTestId = undefined;
				this.giveWork(worker);
				break;
			}

			case 'TEST_FAILED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun.failed(item, new vscode.TestMessage(message.message));
				this.failing = true;
				worker.state = WorkerState.idle;
				worker.currentTestId = undefined;
				this.giveWork(worker);
				break;
			}

			case 'TEST_SKIPPED': {
				const item = this.allItems.get(message.testId);
				if (item) this.testRun.skipped(item);
				worker.state = WorkerState.idle;
				worker.currentTestId = undefined;
				this.giveWork(worker);
				break;
			}

			case 'OUTPUT': {
				const item = this.allItems.get(message.testId);
				this.testRun.appendOutput(message.text.replace(/(?<!\r)\n/gm, '\r\n'), undefined, item);
				break;
			}

			case 'FINISHED':
				if (!message.success) this.failing = true;
				worker.state = WorkerState.closed;
				this.pendingWorkerCount--;
				if (this.pendingWorkerCount <= 0) {
					this.settle(!this.failing);
				}
				break;
		}
	}

	// --- Work distribution ---

	private giveWork(worker: ManagedWorker): void {
		if (this.cancellationToken?.isCancellationRequested) {
			this.finalize(worker);
			return;
		}

		const testItem = this.todo.shift();
		if (!testItem) {
			// No more work — tell the worker to clean up and exit
			this.finalize(worker);
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

		worker.process.send({
			type: 'RUN',
			testId: testItem.id,
			featurePath: location.featurePath,
			lineNumber: location.lineNumber
		} satisfies RunCommand);
	}

	private finalize(worker: ManagedWorker): void {
		worker.process.send({ type: 'FINALIZE' } satisfies FinalizeCommand);
	}

	// --- Process close and cancellation ---

	private handleWorkerClose(worker: ManagedWorker, exitCode: number | null): void {
		// Already counted via FINISHED message — avoid double-decrement
		if (worker.state === WorkerState.closed) return;

		// Exit code 2 means pending/skipped tests — not a failure
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

		// Kill all worker processes
		for (const worker of this.workers) {
			try {
				worker.process.kill();
			} catch {
				/* ignored */
			}
		}
		this.settle(false);
	}

	/** Resolve the run Promise exactly once. */
	private settle(success: boolean): void {
		const resolve = this.resolveRun;
		this.resolveRun = undefined;
		resolve?.(success);
	}
}
