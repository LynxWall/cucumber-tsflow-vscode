import * as path from 'path';
import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams } from 'child_process';
import styles from 'ansi-styles';
import { isWindows, normalizePath } from '../utils';

const crlf = '\r\n';
// Lines written to stderr by the Node inspector (node --inspect) when debugging
const inspectorLine =
	/^(Debugger listening on ws:|For help, see: https:\/\/nodejs\.org\/en\/docs\/inspector|Debugger attached|Waiting for the debugger to disconnect)/;
const forceCRLF = (str: string) => str.replace(/(?<!\r)\n/gm, '\r\n');
const stripAnsi = (str: string) => str.replace(/\u001b\[[0-9;]*m/g, '');

export class TestOutputScanner implements vscode.Disposable {
	protected outputStdoutEmitter = new vscode.EventEmitter<Buffer>();
	protected outputStderrEmitter = new vscode.EventEmitter<Buffer>();
	protected onCloseEmitter = new vscode.EventEmitter<number>();
	protected onErrorEmitter = new vscode.EventEmitter<string>();

	/**
	 * Fired when output from the process comes in.
	 */
	public readonly onRunnerStdout = this.outputStdoutEmitter.event;

	public readonly onRunnerStderr = this.outputStderrEmitter.event;

	/**
	 * Fired when the process encounters an error.
	 */
	public readonly onRunnerError = this.onErrorEmitter.event;

	/**
	 * Fired when the process closes
	 */
	public readonly onRunnerClose = this.onCloseEmitter.event;

	constructor(private readonly process: ChildProcessWithoutNullStreams) {
		process.stdout.on('data', data => this.outputStdoutEmitter.fire(data));
		process.stderr.on('data', data => this.outputStderrEmitter.fire(data));
		process.on('error', e => this.onErrorEmitter.fire(e.message));
		process.on('close', code => {
			if (code !== null) {
				this.onCloseEmitter.fire(code);
			}
		});
	}

	/**
	 * @override
	 */
	public dispose() {
		try {
			this.process.kill();
		} catch {
			// ignored
		}
	}
}

/**
 * A scenario the run asked for, keyed the way cucumber reports it
 * (see scenarioKey) so that the messages can be mapped back to it.
 */
export type RequestedScenario = {
	item: vscode.TestItem;
	key: string;
};

/**
 * Key for a scenario: the feature file relative to the working directory the
 * CLI runs in, plus the line of its Scenario keyword or, for an example of a
 * Scenario Outline, of its table row. Cucumber reports the file and the line
 * the same way in its messages, so both sides of the mapping go through here.
 */
export const scenarioKey = (cwd: string, featureFile: string, line: number): string => {
	const relative = normalizePath(path.relative(cwd, path.resolve(cwd, featureFile)));
	return `${isWindows() ? relative.toLowerCase() : relative}:${line}`;
};

// The subset of cucumber's message envelopes (ndjson from `--format message`) the scanner reads
type Status = 'UNKNOWN' | 'PASSED' | 'SKIPPED' | 'PENDING' | 'UNDEFINED' | 'AMBIGUOUS' | 'FAILED';
type Timestamp = { seconds: number; nanos: number };
type GherkinStep = { id: string; location: { line: number } };
type GherkinScenario = { id: string; location: { line: number }; steps: GherkinStep[] };
type GherkinChild = {
	scenario?: GherkinScenario;
	background?: { steps: GherkinStep[] };
	rule?: { children: GherkinChild[] };
};
type Pickle = {
	id: string;
	uri: string;
	name: string;
	location?: { line: number };
	astNodeIds: string[];
	steps: { id: string; text: string; astNodeIds: string[] }[];
};
type TestCase = { id: string; pickleId: string; testSteps: { id: string; pickleStepId?: string }[] };
type Envelope = {
	gherkinDocument?: { uri?: string; feature?: { children: GherkinChild[] } };
	pickle?: Pickle;
	testCase?: TestCase;
	testCaseStarted?: { id: string; testCaseId: string; attempt: number; timestamp: Timestamp };
	testStepFinished?: {
		testCaseStartedId: string;
		testStepId: string;
		testStepResult: { status: Status; message?: string };
	};
	testCaseFinished?: { testCaseStartedId: string; willBeRetried: boolean; timestamp: Timestamp };
};

// Worst result wins when more than one test case reports to the same test item
const severity: Record<Status, number> = {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	PASSED: 0,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	UNKNOWN: 1,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	SKIPPED: 2,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	PENDING: 3,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	UNDEFINED: 4,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	AMBIGUOUS: 5,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	FAILED: 6
};
const isFailure = (status: Status) => severity[status] >= severity.UNDEFINED;
const millis = (from: Timestamp, to: Timestamp) => (to.seconds - from.seconds) * 1000 + (to.nanos - from.nanos) / 1e6;

type Tracker = {
	item: vscode.TestItem;
	expected: number;
	finished: number;
	started: boolean;
	finalized: boolean;
	worst: Status;
	messages: vscode.TestMessage[];
	duration: number;
};

type StartedCase = {
	testCase: TestCase;
	pickle: Pickle;
	tracker: Tracker | undefined;
	startedAt: Timestamp;
	worst: Status;
	failure?: vscode.TestMessage;
};

/**
 * Runs one cucumber-tsflow process to completion and reports a result for every
 * requested scenario from the message stream the CLI writes to stdout
 * (`--format message`). Everything the CLI writes to stderr, and any stdout line
 * that is not a message, is appended to the run as it arrives.
 */
export const scanTestRun = async (
	requested: RequestedScenario[],
	run: vscode.TestRun,
	scanner: TestOutputScanner,
	cancellation: vscode.CancellationToken,
	cwd: string
): Promise<void> => {
	const trackers = new Map<string, Tracker>();
	for (const scenario of requested) {
		trackers.set(scenario.key, {
			item: scenario.item,
			expected: 0,
			finished: 0,
			started: false,
			finalized: false,
			worst: 'PASSED',
			messages: [],
			duration: 0
		});
	}

	const scenarioLines = new Map<string, number>(); // gherkin scenario id -> line
	const stepLines = new Map<string, number>(); // gherkin step id -> line
	const pickles = new Map<string, Pickle>();
	const testCases = new Map<string, TestCase>();
	const startedCases = new Map<string, StartedCase>();
	const stderrTail: string[] = [];
	let sawTestCases = false;
	let done = false;

	const append = (str: string) => run.appendOutput(str + crlf);

	const indexGherkin = (children: GherkinChild[]) => {
		for (const child of children) {
			if (child.scenario) {
				scenarioLines.set(child.scenario.id, child.scenario.location.line);
				child.scenario.steps.forEach(step => stepLines.set(step.id, step.location.line));
			} else if (child.background) {
				child.background.steps.forEach(step => stepLines.set(step.id, step.location.line));
			} else if (child.rule) {
				indexGherkin(child.rule.children);
			}
		}
	};

	// A pickle is located at its Scenario keyword or, for an example of a
	// Scenario Outline, at its table row; that is how the tree keys its leaves.
	// The line of the Scenario keyword from the gherkin document is the fallback.
	const trackerFor = (pickle: Pickle): Tracker | undefined => {
		const scenarioLine = scenarioLines.get(pickle.astNodeIds[0]);
		const byLocation = pickle.location ? trackers.get(scenarioKey(cwd, pickle.uri, pickle.location.line)) : undefined;
		return (
			byLocation ?? (scenarioLine === undefined ? undefined : trackers.get(scenarioKey(cwd, pickle.uri, scenarioLine)))
		);
	};

	const finalize = (tracker: Tracker) => {
		if (tracker.finalized) {
			return;
		}
		tracker.finalized = true;
		if (isFailure(tracker.worst)) {
			const messages =
				tracker.messages.length > 0
					? tracker.messages
					: [new vscode.TestMessage(`${tracker.item.label}: ${tracker.worst.toLowerCase()}`)];
			run.failed(tracker.item, messages, tracker.duration);
		} else if (tracker.worst === 'PASSED') {
			run.passed(tracker.item, tracker.duration);
		} else {
			run.skipped(tracker.item);
		}
	};

	const stepLocation = (started: StartedCase, testStepId: string): vscode.Location | undefined => {
		const pickleStepId = started.testCase.testSteps.find(step => step.id === testStepId)?.pickleStepId;
		const pickleStep = started.pickle.steps.find(step => step.id === pickleStepId);
		const line = pickleStep ? stepLines.get(pickleStep.astNodeIds[0]) : undefined;
		const uri = started.tracker?.item.uri;
		return line !== undefined && uri ? new vscode.Location(uri, new vscode.Position(line - 1, 0)) : undefined;
	};

	const handle = (envelope: Envelope) => {
		if (envelope.gherkinDocument?.feature) {
			indexGherkin(envelope.gherkinDocument.feature.children);
		} else if (envelope.pickle) {
			pickles.set(envelope.pickle.id, envelope.pickle);
		} else if (envelope.testCase) {
			sawTestCases = true;
			testCases.set(envelope.testCase.id, envelope.testCase);
			const pickle = pickles.get(envelope.testCase.pickleId);
			const tracker = pickle && trackerFor(pickle);
			if (tracker) {
				tracker.expected++;
			}
		} else if (envelope.testCaseStarted) {
			const testCase = testCases.get(envelope.testCaseStarted.testCaseId);
			const pickle = testCase && pickles.get(testCase.pickleId);
			if (!testCase || !pickle) {
				return;
			}
			const tracker = trackerFor(pickle);
			if (tracker && !tracker.started) {
				tracker.started = true;
				run.started(tracker.item);
			}
			const attempt = envelope.testCaseStarted.attempt > 0 ? ` (retry ${envelope.testCaseStarted.attempt})` : '';
			append(`${crlf}${styles.blue.open}Executing Scenario: ${pickle.name}${attempt}${styles.blue.close}`);
			startedCases.set(envelope.testCaseStarted.id, {
				testCase,
				pickle,
				tracker,
				startedAt: envelope.testCaseStarted.timestamp,
				worst: 'PASSED'
			});
		} else if (envelope.testStepFinished) {
			const started = startedCases.get(envelope.testStepFinished.testCaseStartedId);
			if (!started) {
				return;
			}
			const result = envelope.testStepFinished.testStepResult;
			if (severity[result.status] > severity[started.worst]) {
				started.worst = result.status;
			}
			if (isFailure(result.status) && !started.failure) {
				const text = result.message ? stripAnsi(result.message) : `${result.status.toLowerCase()} step`;
				started.failure = new vscode.TestMessage(text);
				started.failure.location = stepLocation(started, envelope.testStepFinished.testStepId);
				append(forceCRLF(result.message ?? text));
			}
		} else if (envelope.testCaseFinished) {
			const started = startedCases.get(envelope.testCaseFinished.testCaseStartedId);
			if (!started) {
				return;
			}
			if (envelope.testCaseFinished.willBeRetried) {
				append(`${styles.yellowBright.open}${started.pickle.name}: Failed, will be retried.${styles.yellowBright.close}`);
				return;
			}
			if (isFailure(started.worst)) {
				append(`${styles.red.open}${started.pickle.name}: Failed!${styles.red.close}`);
			} else if (started.worst === 'PASSED') {
				append(`${styles.green.open}${started.pickle.name}: Passed!${styles.green.close}`);
			} else {
				append(`${styles.yellowBright.open}${started.pickle.name}: ${started.worst.toLowerCase()}.${styles.yellowBright.close}`);
			}
			const tracker = started.tracker;
			if (tracker) {
				tracker.finished++;
				tracker.duration += millis(started.startedAt, envelope.testCaseFinished.timestamp);
				if (severity[started.worst] > severity[tracker.worst]) {
					tracker.worst = started.worst;
				}
				if (started.failure) {
					tracker.messages.push(started.failure);
				}
				if (tracker.finished >= tracker.expected) {
					finalize(tracker);
				}
			}
		}
	};

	// stdout is one JSON envelope per line; anything else (console.log from support code) is shown as is
	let stdoutRemainder = '';
	const onStdout = (text: string) => {
		const lines = (stdoutRemainder + text).split('\n');
		stdoutRemainder = lines.pop() ?? '';
		for (const raw of lines) {
			const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
			if (line.length === 0) {
				continue;
			}
			if (line.startsWith('{')) {
				try {
					handle(JSON.parse(line) as Envelope);
					continue;
				} catch {
					// not a message after all; fall through and show it
				}
			}
			append(line);
		}
	};

	// cucumber-tsflow 8.0 writes its own output (configuration, startup progress,
	// notices) to stderr, so show it as it arrives and drop only the lines the
	// Node inspector prints when debugging.
	let stderrRemainder = '';
	const onStderr = (text: string) => {
		const lines = (stderrRemainder + text).split('\n');
		stderrRemainder = lines.pop() ?? '';
		for (const raw of lines) {
			const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
			if (!inspectorLine.test(line)) {
				append(line);
				stderrTail.push(stripAnsi(line));
				if (stderrTail.length > 40) {
					stderrTail.shift();
				}
			}
		}
	};

	const flush = () => {
		if (stdoutRemainder.length > 0) {
			onStdout('\n');
		}
		if (stderrRemainder.length > 0) {
			onStderr('\n');
		}
	};

	const settleUnfinished = (code: number | undefined, cancelled: boolean) => {
		const configurationError = code === 1 && !sawTestCases;
		for (const tracker of trackers.values()) {
			if (tracker.finalized) {
				continue;
			}
			tracker.finalized = true;
			if (cancelled) {
				run.skipped(tracker.item);
			} else if (configurationError) {
				const detail = stderrTail.filter(line => line.trim().length > 0).join('\n');
				run.errored(
					tracker.item,
					new vscode.TestMessage(`Bad configuration or unhandled exception in test runner.\n\n${detail}`)
				);
			} else if (tracker.started) {
				run.failed(
					tracker.item,
					new vscode.TestMessage(`cucumber-tsflow exited with code ${code} before the scenario finished.`)
				);
			} else {
				run.skipped(tracker.item);
			}
		}
	};

	const summary = (code: number) => {
		let passed = 0;
		let failed = 0;
		let skipped = 0;
		for (const tracker of trackers.values()) {
			if (!tracker.started) {
				skipped++;
			} else if (isFailure(tracker.worst)) {
				failed++;
			} else if (tracker.worst === 'PASSED') {
				passed++;
			} else {
				skipped++;
			}
		}
		const color = failed > 0 || code === 1 ? styles.red : skipped > 0 ? styles.yellowBright : styles.green;
		const notRun = skipped > 0 ? `, ${skipped} skipped or not run` : '';
		append(
			`${crlf}${color.open}${trackers.size} scenario${trackers.size === 1 ? '' : 's'}: ${passed} passed, ${failed} failed${notRun} (exit code ${code})${color.close}`
		);
	};

	try {
		await new Promise<void>(resolve => {
			const finish = (action: () => void) => {
				if (!done) {
					done = true;
					action();
					resolve();
				}
			};

			cancellation.onCancellationRequested(() =>
				finish(() => {
					append('Cancelling test run.');
					settleUnfinished(undefined, true);
				})
			);

			scanner.onRunnerError(err =>
				finish(() => {
					append(forceCRLF(err));
					settleUnfinished(1, false);
				})
			);

			scanner.onRunnerStdout(data => {
				if (!done) {
					onStdout(data.toString());
				}
			});
			scanner.onRunnerStderr(data => {
				if (!done) {
					onStderr(data.toString());
				}
			});

			scanner.onRunnerClose(code =>
				finish(() => {
					flush();
					if (code === 1 && !sawTestCases) {
						append(`${styles.red.open}Bad configuration or unhandled exception in test runner.${styles.red.close}`);
					}
					settleUnfinished(code, false);
					summary(code);
				})
			);
		});
	} catch (e) {
		append((e as Error).stack || (e as Error).message);
	} finally {
		scanner.dispose();
	}
};
