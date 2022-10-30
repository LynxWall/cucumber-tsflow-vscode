import * as vscode from 'vscode';
import ctvConfig from '../ctv-config';
import { isWindows, pushMany, quote } from '../utils';

export class CucumberRunner {
	private terminal!: vscode.Terminal | null;

	constructor() {
		this.setup();
	}

	/**
	 * Run a cucumber scenario
	 * @param filePath Path to feature file
	 * @param lineNumber Line number of the scenario in the feature file
	 * @returns
	 */
	public runCucumber = async (filePath: string, lineNumber?: number) => {
		const runCommand = ctvConfig.runCommand;

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		await editor.document.save();

		// if we're running on windows and the path starts
		// with a leading slash (/c:/) we need to strip
		// off the leading slash
		if (isWindows() && filePath.startsWith('/')) {
			filePath = filePath.substring(1);
		}
		const args = ctvConfig.runtimeArgs();
		let scenario = `${filePath}`;
		if (lineNumber) {
			scenario = `${filePath}:${lineNumber}`;
		}
		const command = `${runCommand} ${args.join(' ')} ${quote(scenario)}`;

		await this.goToCwd();
		await this.runTerminalCommand(command);
	};

	/**
	 * Debug a cucumber scenario
	 * @param filePath Path to feature file
	 * @param lineNumber Line number of the scenario in the feature file
	 * @returns
	 */
	public debugCucumber = async (filePath: string, lineNumber?: number) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		await editor.document.save();

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
			program: ctvConfig.cucumberBinPath,
			request: 'launch',
			type: 'node',
			cwd: ctvConfig.cucumberPath,
			...ctvConfig.debugOptions
		};

		config.args = config.args ? config.args.slice() : [];

		const standardArgs = ctvConfig.runtimeArgs();
		pushMany(config.args, standardArgs);
		config.args.push(scenario.trim());

		return config;
	};

	/**
	 * Goto working directory, used to run cucumber scenarios
	 */
	private async goToCwd() {
		const command = `cd ${quote(ctvConfig.cucumberPath as string)}`;
		await this.runTerminalCommand(command);
	}

	/**
	 * Execute commands in a terminal
	 * @param command command to execute
	 */
	private async runTerminalCommand(command: string) {
		if (!this.terminal) {
			this.terminal = vscode.window.createTerminal('cucumber-tsflow');
		}
		this.terminal.show(ctvConfig.preserveEditorFocus);
		await vscode.commands.executeCommand('workbench.action.terminal.clear');
		this.terminal.sendText(command);
	}

	/**
	 * Handler to clear the terminal when it closes
	 */
	private setup = () => {
		vscode.window.onDidCloseTerminal(() => {
			this.terminal = null;
		});
	};
}

const cucumberRunner = new CucumberRunner();
export default cucumberRunner;
