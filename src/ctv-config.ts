import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { sync as globSync } from 'glob';
import { quote, normalizePath, isNodeExecuteAbleFile } from './utils';

export class CtvConfig {
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
		const fallbackRelativeTsFlowBinPath = 'node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow';
		const relativeTsFlowBin = [
			'node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow',
			'node_modules/.bin/cucumber-tsflow'
		];
		const cwd = this.projectPath ?? '';

		let tsflowPath = relativeTsFlowBin.find(relativeBin => isNodeExecuteAbleFile(path.join(cwd, relativeBin)));
		tsflowPath = tsflowPath || fallbackRelativeTsFlowBinPath;

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
	 * working file. Supports mono repo projects
	 */
	private get currentCucumberRootPath(): string | undefined {
		const configFiles = ['cucumber.json', 'cucumber.js', 'cucumber.cjs', 'cucumber.mjs'];
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			let currentFolderPath: string | undefined = path.dirname(editor.document.fileName);
			if (currentFolderPath) {
				let prevFolderPath: string = '';
				do {
					// Try to find where cucumber configuration is located relative to the current opened file.
					prevFolderPath = currentFolderPath;
					for (let idx = 0; idx < 4; idx++) {
						const pkg = path.join(currentFolderPath as string, configFiles[idx]);
						if (fs.existsSync(pkg)) {
							return currentFolderPath;
						}
					}
					// this stops changing when we hit the root
					currentFolderPath = path.join(currentFolderPath, '..');
				} while (currentFolderPath !== prevFolderPath);
			}
		} else if (vscode.workspace.workspaceFolders) {
			const cucumber = this.cucumberSettingsPath;
			const wsPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

			return wsPath;
		}

		return undefined;
	}

	private get cucumberSettingsPath(): string | undefined {
		let filePath: string | undefined = undefined;
		if (this.currentWorkspaceRootPath) {
			const cucumberFiles = globSync('**/cucumber.*', { cwd: this.currentWorkspaceRootPath });
			cucumberFiles.map(cucumberFile => {
				if (!(cucumberFile.indexOf('node_modules') > 0)) {
					const settingsPath = path.join(this.currentWorkspaceRootPath!, cucumberFile);
					fs.readFile(settingsPath, (err, data) => {
						if (err) {
							console.log(err);
						}
						if (data.includes(this.profile)) {
							const cucumberIdx = cucumberFile.indexOf('cucumber');
							filePath = cucumberFile.substring(0, cucumberIdx + 1);
						}
					});
				}
			});
		}
		console.log('cucumber settings path: ' + filePath);
		return filePath;
	}
}

const ctvConfig = new CtvConfig();
export default ctvConfig;
