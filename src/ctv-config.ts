import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { sync as globSync } from 'glob';
import { quote, normalizePath, isNodeExecuteAbleFile } from './utils';
import minimatch from 'minimatch';

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
	 * Cucumber profile to use when running or debugging tests
	 */
	public get profile(): string {
		return this.getStringSetting('cucumber-tsflow.profile') ?? 'default';
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
	 * Glob pattern used to find step files in your workspace. The default supports multiple test projects in a workspace.
	 */
	public get stepsSelector(): string {
		const glob = this.getStringSetting('cucumber-tsflow.stepsSelector') ?? '**/{steps,step_definitions}/**/*.ts';
		return normalizePath(glob as string);
	}

	/**
	 * Glob pattern used to find feature files in your workspace. The default supports multiple test projects in a workspace.
	 */
	public get featuresSelector(): string {
		const glob = this.getStringSetting('cucumber-tsflow.featuresSelector') ?? '**/features/**/*.feature';
		return normalizePath(glob as string);
	}

	/**
	 * Max folder depth for your workspace.
	 * Used to search parent folders for closest matching Cucumber settings file for a step file
	 */
	public get maxFolderDepth(): number {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.maxFolderDepth') ?? 10;
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
		// add the profile
		args.push('-p');
		args.push(this.profile);

		const setOptions = new Set(options);
		if (this.runOptions) {
			this.runOptions.forEach(option => setOptions.add(option));
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

	/**
	 * Gets the path where cucumber.js is found relative to the current
	 * working file or root if no file open. Supports mono repo projects
	 */
	// public get currentCucumberSettingsPath(): string | undefined {
	// 	if (this.cucumberSettingsPathFromFile) {
	// 		return this.cucumberSettingsPathFromFile;
	// 	}
	// 	return this.cucumberSettingsPathFromRoot;
	// }

	/**
	 * Helper used find the first settings file, starting from workspace root, that contains the
	 * Profile specified in 'cucumber-tsflow.profile', which equals "default" by default.
	 */
	// private get cucumberSettingsPathFromRoot(): string | undefined {
	// 	if (this.currentWorkspaceRootPath) {
	// 		if (!this.cucumberSettingsFromRoot) {
	// 			const cucumberFiles = globSync('**/cucumber.*', { cwd: this.currentWorkspaceRootPath });
	// 			for (let idx = 0; idx < cucumberFiles.length; idx++) {
	// 				const cucumberFile = cucumberFiles[idx];
	// 				if (cucumberFile.indexOf('node_modules') < 0) {
	// 					const settingsPath = path.join(this.currentWorkspaceRootPath!, cucumberFile);
	// 					const data = fs.readFileSync(settingsPath);
	// 					if (data.includes(this.profile)) {
	// 						const cucumberIdx = cucumberFile.lastIndexOf('cucumber');
	// 						const cucumberPath = cucumberIdx > 0 ? cucumberFile.substring(0, cucumberIdx - 1) : '';
	// 						this.cucumberSettingsFromRoot = normalizePath(path.join(this.currentWorkspaceRootPath!, cucumberPath));
	// 					}
	// 				}
	// 			}
	// 		}
	// 		return this.cucumberSettingsFromRoot;
	// 	}
	// 	return undefined;
	// }

	/**
	 * Helper used to get the closest matching cumber settings file that contains the
	 * Profile specified in 'cucumber-tsflow.profile', which equals "default" by default.
	 * This will check to see if you have a step file open by checking against the
	 * 'cucumber-tsflow.stepsSelector' glob pattern.
	 *
	 * If a step file is open this will search up the file hirerachy to find a closest
	 * settings file. This will also return the previous match if checking the same folder.
	 *
	 * If a step file is not open this will return undefined.
	 */
	// private get cucumberSettingsPathFromFile(): string | undefined {
	// 	const editor = vscode.window.activeTextEditor;
	// 	if (editor) {
	// 		let currentFolderPath: string | undefined = path.dirname(editor.document.fileName);
	// 		if (
	// 			currentFolderPath &&
	// 			currentFolderPath !== this.currentStepFilePath &&
	// 			minimatch(`${currentFolderPath}/test.ts`, this.stepsSelector)
	// 		) {
	// 			const stepFilepath = currentFolderPath;
	// 			const maxDepth = this.maxFolderDepth;
	// 			for (let x = 0; x < maxDepth; x++) {
	// 				const cucumberFiles = globSync('./cucumber.*', { cwd: currentFolderPath });
	// 				if (cucumberFiles.length > 0) {
	// 					for (let idx = 0; idx < cucumberFiles.length; idx++) {
	// 						const cucumberFile = cucumberFiles[idx];
	// 						if (cucumberFile.indexOf('node_modules') < 0) {
	// 							const settingsPath = path.join(currentFolderPath, cucumberFile);
	// 							const data = fs.readFileSync(settingsPath);
	// 							if (data.includes(this.profile)) {
	// 								this.currentStepFilePath = stepFilepath;
	// 								this.cucumberSettingsFromFile = normalizePath(currentFolderPath);
	// 								return this.cucumberSettingsFromFile;
	// 							}
	// 						}
	// 					}
	// 				}
	// 				currentFolderPath = path.join(currentFolderPath, '..');
	// 			}
	// 		} else if (
	// 			currentFolderPath &&
	// 			currentFolderPath === this.currentStepFilePath &&
	// 			minimatch(`${currentFolderPath}/test.ts`, this.stepsSelector)
	// 		) {
	// 			return this.cucumberSettingsFromFile;
	// 		}
	// 	}
	// 	return undefined;
	// }
}
