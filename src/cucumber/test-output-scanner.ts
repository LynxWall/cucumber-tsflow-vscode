import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams } from 'child_process';
import styles from 'ansi-styles';

const crlf = '\r\n';
const forceCRLF = (str: string) => str.replace(/(?<!\r)\n/gm, '\r\n');

export class TestOutputScanner implements vscode.Disposable {
	protected outputEventEmitter = new vscode.EventEmitter<Buffer>();
	protected onCloseEmitter = new vscode.EventEmitter<number>();
	protected onErrorEmitter = new vscode.EventEmitter<string>();

	/**
	 * Fired when output from the process comes in.
	 */
	public readonly onRunnerOutput = this.outputEventEmitter.event;

	/**
	 * Fired when the process encounters an error.
	 */
	public readonly onRunnerError = this.onErrorEmitter.event;

	/**
	 * Fired when the process closes
	 */
	public readonly onRunnerClose = this.onCloseEmitter.event;

	constructor(private readonly process: ChildProcessWithoutNullStreams) {
		process.stdout.on('data', data => this.outputEventEmitter.fire(data));
		process.stderr.on('data', data => this.outputEventEmitter.fire(data));
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
	let buffer = Buffer.from(`\r\n${styles.blue.open}Executing Scenario: ${testItem.label}\r\n${styles.blue.close}`);
	const defaultAppend = (str: string) => task.appendOutput(str + crlf, undefined, testItem);
	try {
		if (cancellation.isCancellationRequested) {
			return;
		}

		await new Promise<void>(resolve => {
			cancellation.onCancellationRequested(() => {
				resolve();
			});

			scanner.onRunnerError(err => {
				defaultAppend(forceCRLF(err));
				resolve();
			});

			scanner.onRunnerOutput(data => (buffer = Buffer.from([...buffer, ...data])));

			scanner.onRunnerClose(code => {
				task.appendOutput(forceCRLF(buffer.toString()), undefined, testItem);
				switch (code) {
					case 0:
						defaultAppend(`${styles.green.open}${testItem.label}: Passed!${styles.green.close}`);
						task.passed(testItem);
						break;
					case 1:
						defaultAppend(
							`${styles.yellowBright.open}${testItem.label}: Has pending, skipped or unknown tests.${styles.yellowBright.close}`
						);
						task.skipped(testItem);
						break;
					case 2:
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
