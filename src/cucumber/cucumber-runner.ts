import * as vscode from 'vscode';
import useCtvConfig from '../use-ctv-config';
import { isWindows, pushMany } from '../utils';
import { spawn } from 'child_process';
import CtvConfig from '../ctv-config';
import { TestCallback } from './test-features';

const executeNodeCommand = (
	command: string,
	args: string[],
	cwd: string
): Promise<{ data: string; code: number | null }> => {
	const cmdPromise = new Promise<{ data: string; code: number | null }>((resolve, reject) => {
		let buffer = '';
		const nodeShell = spawn(command, args, {
			cwd: cwd,
			shell: true,
			stdio: ['pipe', 'pipe', 'ignore']
		});

		nodeShell.stdout?.on('data', (data: any) => {
			buffer += `${data}`;
		});
		nodeShell.on('close', code => {
			resolve({ data: buffer, code: code });
		});

		nodeShell.on('error', data => {
			console.log(`child process closed with error ${data}`);
			reject(data);
		});
	});
	return cmdPromise;
};

export class CucumberRunner {
	private ctvConfig: CtvConfig;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
	}

	/**
	 * Run a cucumber scenario
	 * @param filePath Path to feature file
	 * @param lineNumber Line number of the scenario in the feature file
	 * @returns
	 */
	public runCucumber = async (filePath: string, lineNumber?: number, callback?: TestCallback) => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			await editor.document.save();
		}

		// if we're running on windows and the path starts
		// with a leading slash (/c:/) we need to strip
		// off the leading slash
		if (isWindows() && filePath.startsWith('/')) {
			filePath = filePath.substring(1);
		}
		const args = this.ctvConfig.runtimeArgs();
		let scenario = `${filePath}`;
		if (lineNumber) {
			scenario = `${filePath}:${lineNumber}`;
		}
		args.push(scenario);

		this.ctvConfig.cucumberOutput.show(this.ctvConfig.preserveEditorFocus);

		const runCommand = this.ctvConfig.runCommand;
		const cucumberPath = this.ctvConfig.cucumberPath;

		if (cucumberPath) {
			const resp = await executeNodeCommand(runCommand, args, cucumberPath);
			this.ctvConfig.cucumberOutput.append(resp.data);
			if (callback) {
				switch (resp.code) {
					case 0:
						callback('passed');
						break;
					case 1:
						callback('pending');
						break;
					case 2:
						callback('failed');
				}
			}
		}

		this.runNodeCommand(args);
	};

	/**
	 * Debug a cucumber scenario
	 * @param filePath Path to feature file
	 * @param lineNumber Line number of the scenario in the feature file
	 * @returns
	 */
	public debugCucumber = async (filePath: string, lineNumber?: number) => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			await editor.document.save();
		}

		// if we're running on windows and the path starts
		// with a leading slash (/c:/) we need to strip
		// off the leading slash
		if (isWindows() && filePath.startsWith('/')) {
			filePath = filePath.substring(1);
		}

		let scenario = `${filePath}`;
		if (lineNumber) {
			scenario = `${filePath}:${lineNumber}`;
		}
		const debugConfig = this.getDebugConfig(scenario);

		vscode.debug.startDebugging(undefined, debugConfig);

		vscode.debug.onDidTerminateDebugSession(e => console.log('Debug done: ' + e.name));
	};

	/**
	 * Helper used to get debug configuration
	 * @param scenario scenario to debug
	 * @returns
	 */
	private getDebugConfig = (scenario: string): vscode.DebugConfiguration => {
		const config: vscode.DebugConfiguration = {
			console: 'integratedTerminal',
			internalConsoleOptions: 'neverOpen',
			name: 'Debug Cucumber Tests',
			program: this.ctvConfig.cucumberBinPath,
			request: 'launch',
			type: 'node',
			cwd: this.ctvConfig.cucumberPath,
			...this.ctvConfig.debugOptions
		};

		config.args = config.args ? config.args.slice() : [];

		const standardArgs = this.ctvConfig.runtimeArgs();
		pushMany(config.args, standardArgs);
		config.args.push(scenario.trim());

		return config;
	};

	private async runNodeCommand(args: string[]) {
		this.ctvConfig.cucumberOutput.show(this.ctvConfig.preserveEditorFocus);

		const runCommand = this.ctvConfig.runCommand;
		const cucumberPath = this.ctvConfig.cucumberPath;

		if (cucumberPath) {
			const resp = await executeNodeCommand(runCommand, args, cucumberPath);
			this.ctvConfig.cucumberOutput.append(resp.data);
			this.ctvConfig.cucumberOutput.appendLine('');
			this.ctvConfig.cucumberOutput.appendLine(`${resp.code}`);
		}
	}
}

const cucumberRunner = new CucumberRunner();
export default cucumberRunner;
