import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams } from 'child_process';
import styles from 'ansi-styles';

const crlf = '\r\n';
const forceCRLF = (str: string) => str.replace(/(?<!\r)\n/gm, '\r\n');

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

export const scanTestOutput = async (
	testItem: vscode.TestItem,
	task: vscode.TestRun,
	scanner: TestOutputScanner,
	cancellation: vscode.CancellationToken
): Promise<void> => {
	let errBuffer = Buffer.alloc(0);
	let buffer = Buffer.from(`\r\n${styles.blue.open}Executing Scenario: ${testItem.label}\r\n${styles.blue.close}`);
	const defaultAppend = (str: string) => task.appendOutput(str + crlf, undefined, testItem);
	try {
		await new Promise<void>(resolve => {
			cancellation.onCancellationRequested(() => {
				defaultAppend('Cancelling test.');
				task.skipped(testItem);
				resolve();
			});

			scanner.onRunnerError(err => {
				defaultAppend(forceCRLF(err));
				resolve();
			});

			scanner.onRunnerStdout(data => (buffer = Buffer.from([...buffer, ...data])));
			scanner.onRunnerStderr(data => (errBuffer = Buffer.from([...errBuffer, ...data])));

			scanner.onRunnerClose(code => {
				task.appendOutput(forceCRLF(buffer.toString()), undefined, testItem);
				const errData = errBuffer.toString();
				if (!errData.includes('Debugger attached')) {
					task.appendOutput(forceCRLF(errData), undefined, testItem);
				}
				switch (code) {
					case 0:
						defaultAppend(`${styles.green.open}${testItem.label}: Passed!${styles.green.close}`);
						task.passed(testItem);
						break;
					case 1:
						defaultAppend(
							`${styles.red.open}${testItem.label}: Bad configuration or unhandled exception in test runner.${styles.red.close}`
						);
						task.failed(testItem, new vscode.TestMessage(`${testItem.label}: Failed!`));
						break;
					case 2:
						defaultAppend(
							`${styles.yellowBright.open}${testItem.label}: Has pending, skipped or unknown tests.${styles.yellowBright.close}`
						);
						task.skipped(testItem);
						break;
					case 3:
						defaultAppend(`${styles.red.open}${testItem.label}: Failed!${styles.red.close}`);
						task.failed(testItem, new vscode.TestMessage(`${testItem.label}: Failed!`));
						break;
				}
				resolve();
			});
		});
	} catch (e) {
		defaultAppend((e as Error).stack || (e as Error).message);
	} finally {
		scanner.dispose();
	}
};
