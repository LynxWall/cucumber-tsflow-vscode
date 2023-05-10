import * as path from 'path';
import * as vscode from 'vscode';
import { sync as globSync } from 'glob';
import { quote, normalizePath, isNodeExecuteAbleFile } from './utils';

export default class CtvConfig {
	private workspaceRootPath?: string;
	private outputChannel: vscode.OutputChannel;

	constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Cucumber TsFlow');
	}

	public get cucumberOutput(): vscode.OutputChannel {
		return this.outputChannel;
	}

	/**
	 * Cucumber config path (relative to cucumber-tsflow.projectPath e.g. './test/cucumber.json')
	 */
	public get configFile(): string | undefined {
		return this.getStringSetting('cucumber-tsflow.configFile');
	}

	/**
	 * Absolute path to project directory where packages.json and node_modules are found (e.g. /home/me/project/sub-folder)
	 */
	public get projectPath(): string | undefined {
		return this.getStringSetting('cucumber-tsflow.projectPath') ?? this.currentWorkspaceRootPath;
	}

	/**
	 * Add CLI Options to the Cucumber-tsflow Command e.g. https://github.com/LynxWall/cucumber-js-tsflow#new-configuration-options
	 */
	public get runOptions(): string[] | null {
		const runOptions = vscode.workspace.getConfiguration().get('cucumber-tsflow.runOptions');
		if (runOptions) {
			if (Array.isArray(runOptions)) {
				return runOptions;
			} else {
				vscode.window.showWarningMessage(
					'Please check your vscode settings. "cucumber-tsflow.runOptions" must be an Array. '
				);
			}
		}
		return null;
	}

	/**
	 * Add or overwrite vscode debug configurations (only in debug mode) (e.g. { \"args\": [\"--no-cache\"] })
	 */
	public get debugOptions(): Partial<vscode.DebugConfiguration> {
		const debugOptions = vscode.workspace.getConfiguration().get('cucumber-tsflow.debugOptions');
		if (debugOptions) {
			return debugOptions as Partial<vscode.DebugConfiguration>;
		}
		// default
		return {};
	}

	public get debugPort(): number {
		return 9777;
	}

	/**
	 * The command that runs cucumber-tsflow.
	 * Defaults to: node "node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow"
	 */
	public runCommand(debug: boolean = false): string {
		return debug
			? `node --inspect=${this.debugPort} ${quote(this.cucumberBinPath)}`
			: `node ${quote(this.cucumberBinPath)}`;
	}

	/**
	 * Disable Code Lens feature
	 */
	public get disableCodeLens(): boolean {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.disableCodeLens') || false;
	}

	/**
	 * Preserve focus on editor when running tests
	 */
	public get preserveEditorFocus(): boolean {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.preserveEditorFocus') ?? false;
	}

	/**
	 * Get runtime arguments for Cucumber execution
	 * @param options
	 * @returns
	 */
	public runtimeArgs = (options?: string[]): string[] => {
		const args: string[] = [];

		// custom config path?
		if (this.configFile && this.configFile !== '') {
			args.push('-c');
			args.push(this.configFile);
		}

		const setOptions = new Set(options);
		if (this.runOptions) {
			for (let idx = 0; idx < this.runOptions.length; idx++) {
				setOptions.add(this.runOptions[idx]);
			}
		}

		args.push(...setOptions);

		return args;
	};

	/**
	 * helper used to get a valid string setting from config.
	 * Returns undefined if the setting is not defined or has
	 * the default empty string.
	 * @param name
	 */
	private getStringSetting(name: string): string | undefined {
		const setting = vscode.workspace.getConfiguration().get<string>(name);
		if (setting && setting !== '') {
			return setting;
		}
		return undefined;
	}

	/**
	 * Absolute path to cucumber-tsflow bin file (e.g. /usr/lib/node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow)
	 */
	public get cucumberBinPath(): string {
		// default
		const defaultPath = 'node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow';
		const relativeTsFlowBin = [
			'node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow',
			'node_modules/.bin/cucumber-tsflow'
		];
		const cwd = this.projectPath ?? './';

		let tsflowPath = relativeTsFlowBin.find(relativeBin => isNodeExecuteAbleFile(path.join(cwd, relativeBin)));
		tsflowPath = tsflowPath || defaultPath;
		return normalizePath(path.join(cwd, tsflowPath));
	}

	/**
	 * Helper used find all cucumber setingss files, starting from workspace root.
	 */
	public get allCucumberSettingsFromRoot(): Array<string> {
		const settingsPaths = new Array<string>();
		if (this.projectPath) {
			const cucumberFiles = globSync('**/cucumber.*', { cwd: this.projectPath });
			for (let idx = 0; idx < cucumberFiles.length; idx++) {
				const cucumberFile = cucumberFiles[idx];
				if (cucumberFile.indexOf('node_modules') < 0) {
					const cucumberIdx = cucumberFile.lastIndexOf('cucumber');
					const cucumberPath = cucumberIdx > 0 ? cucumberFile.substring(0, cucumberIdx - 1) : '';
					settingsPaths.push(normalizePath(path.join(this.projectPath, cucumberPath)));
				}
			}
		}
		return settingsPaths;
	}

	/**
	 * Gets root workspace path where both packages.json and
	 * node_modules are found.
	 */
	private get currentWorkspaceRootPath(): string | undefined {
		if (!this.workspaceRootPath && vscode.workspace.workspaceFolders) {
			const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
			const lynxwallFiles = globSync('**/node_modules/@lynxwall/', { cwd: wsRoot });
			if (lynxwallFiles.length > 0) {
				const normPath = normalizePath(lynxwallFiles[0]);
				const nodeRoot = normPath.replace('node_modules/@lynxwall', '');
				this.workspaceRootPath = path.join(wsRoot, nodeRoot);
			}
		}
		return this.workspaceRootPath;
	}
}
