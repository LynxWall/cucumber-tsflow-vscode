import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { sync as globSync } from 'glob';
import { quote, normalizePath, isNodeExecuteAbleFile } from './utils';

export class CtvConfig {
	private cucumberSettingsPath?: string;
	/**
	 * Cucumber config path (relative to cucumber-tsflow.projectPath e.g. './test/cucumber.json')
	 */
	public get configFile(): string | undefined {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.configFile');
	}

	/**
	 * Cucumber profile to use when running or debugging tests
	 */
	public get profile(): string {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.profile') ?? 'default';
	}

	/**
	 * Absolute path to project directory where packages.json and node_modules are found (e.g. /home/me/project/sub-folder)
	 */
	public get cucumberPath(): string | undefined {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.cucumberPath') || this.currentCucumberRootPath;
	}

	/**
	 * Absolute path to project directory where packages.json and node_modules are found (e.g. /home/me/project/sub-folder)
	 */
	public get projectPath(): string | undefined {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.projectPath') || this.currentWorkspaceRootPath;
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

	/**
	 * The command that runs cucumber-tsflow.
	 * Defaults to: node "node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow"
	 */
	public get runCommand(): string {
		return `node ${quote(this.cucumberBinPath)}`;
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
		const glob = vscode.workspace.getConfiguration().get('cucumber-tsflow.stepsSelector') || '';
		return normalizePath(glob as string);
	}

	/**
	 * Glob pattern used to find feature files in your workspace. The default supports multiple test projects in a workspace.
	 */
	public get featuresSelector(): string {
		const glob = vscode.workspace.getConfiguration().get('cucumber-tsflow.featuresSelector') || '';
		return normalizePath(glob as string);
	}

	/**
	 * Preserve focus on editor when running tests
	 */
	public get preserveEditorFocus(): boolean {
		return vscode.workspace.getConfiguration().get('cucumber-tsflow.preserveEditorFocus') || false;
	}

	/**
	 * Get runtime arguments for Cucumber execution
	 * @param options
	 * @returns
	 */
	public runtimeArgs = (options?: string[]): string[] => {
		const args: string[] = [];

		// custom config path?
		if (this.configFile) {
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
	 * Absolute path to cucumber-tsflow bin file (e.g. /usr/lib/node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow)
	 */
	public get cucumberBinPath(): string {
		// default
		const defaultPath = 'node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow';
		const relativeTsFlowBin = [
			'node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow',
			'node_modules/.bin/cucumber-tsflow'
		];
		const cwd = this.projectPath ?? '';

		let tsflowPath = relativeTsFlowBin.find(relativeBin => isNodeExecuteAbleFile(path.join(cwd, relativeBin)));
		tsflowPath = tsflowPath || defaultPath;
		return normalizePath(path.join(cwd, tsflowPath));
	}

	/**
	 * Gets root workspace path where both packages.json and
	 * node_modules are found.
	 */
	private get currentWorkspaceRootPath(): string | undefined {
		if (vscode.workspace.workspaceFolders) {
			return vscode.workspace.workspaceFolders[0].uri.fsPath;
		}
		return undefined;
	}

	/**
	 * Gets the path where cucumber.js is found relative to the current
	 * working file or root if no file open. Supports mono repo projects
	 */
	private get currentCucumberRootPath(): string | undefined {
		return this.cucumberSettingsPathFromFile || this.cucumberSettingsPathFromRoot;
	}

	private get cucumberSettingsPathFromRoot(): string | undefined {
		if (this.cucumberSettingsPath === undefined && this.currentWorkspaceRootPath) {
			const cucumberFiles = globSync('**/cucumber.*', { cwd: this.currentWorkspaceRootPath });
			for (const cucumberFile of cucumberFiles) {
				if (cucumberFile.indexOf('node_modules') < 0) {
					const settingsPath = path.join(this.currentWorkspaceRootPath!, cucumberFile);
					const data = fs.readFileSync(settingsPath);
					if (data.includes(this.profile)) {
						const cucumberIdx = cucumberFile.lastIndexOf('cucumber');
						const cucumberPath = cucumberIdx > 0 ? cucumberFile.substring(0, cucumberIdx - 1) : '';
						return normalizePath(path.join(this.currentWorkspaceRootPath!, cucumberPath));
					}
				}
			}
		}
		return undefined;
	}

	private get cucumberSettingsPathFromFile(): string | undefined {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			let currentFolderPath: string | undefined = path.dirname(editor.document.fileName);
			if (currentFolderPath) {
				let prevFolderPath: string = '';
				do {
					const cucumberFiles = globSync('./cucumber.*', { cwd: currentFolderPath });
					prevFolderPath = currentFolderPath;
					if (cucumberFiles.length > 0) {
						for (const cucumberFile of cucumberFiles) {
							if (cucumberFile.indexOf('node_modules') < 0) {
								const settingsPath = path.join(currentFolderPath, cucumberFile);
								const data = fs.readFileSync(settingsPath);
								if (data.includes(this.profile)) {
									return normalizePath(currentFolderPath);
								}
							}
						}
					}
					// this stops changing when we hit the root
					currentFolderPath = path.join(currentFolderPath, '..');
				} while (currentFolderPath !== prevFolderPath);
			}
		}
		return undefined;
	}
}

const ctvConfig = new CtvConfig();
export default ctvConfig;
