// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import minimatch from 'minimatch';
import StepCodeLensProvider from './step-code-lens-provider';
import useCtvConfig from './use-ctv-config';
import StepFileManager from './cucumber/step-file-manager';
import CucumberTestFeatures from './cucumber/cucumber-test-features';
import useCucumberTsFlow from './use-cucumber-tsflow';
import { CucumberProject, CucumberProfile, TestFeatureStep } from './types';
import { loadConfg } from './configuration/load-config';
import { toKebabCase } from './utils';
import GherkinManager from './gherkin/gherkin-manager';
import { sortBy, compose, toLower, prop } from 'ramda';

// sort helper that uses ramda
const sortByName = sortBy<CucumberProject>(compose(toLower, prop('name')));

/**
 * Helper used to extract individual paths from a cucumber config file
 * setting that holds an array.
 * @param profiles
 * @param propName
 * @returns
 */
const getMatchPaths = (profiles: any[], propName: string): string[] => {
	return profiles.reduce((result, curr) => {
		if (result?.length > 0) {
			if (propName in curr) {
				return [...new Set([...result, ...curr[propName]])];
			}
			return [...new Set(result)];
		} else {
			if (propName in curr) {
				return curr[propName];
			}
			return [];
		}
	}, [] as string[]);
};

/**
 * Generates a blob path used to query for files
 * under the project folder
 *
 * @param relativePath Relative path from project folder
 * @param projectName Name of the project
 * @returns
 */
const getProjectGlobPath = (relativePath: string, projectName: string) => {
	// check for relative paths
	if (relativePath.startsWith('./') || relativePath.startsWith('.\\')) {
		relativePath = relativePath.substring(2);
	} else if (relativePath.startsWith('../') || relativePath.startsWith('..\\')) {
		relativePath = relativePath.substring(3);
	}
	// if starting with glob strip it off since we'll add it back in
	if (relativePath.startsWith('**/') || relativePath.startsWith('**\\')) {
		relativePath = relativePath.substring(3);
	}
	return `**/${projectName}/${relativePath}`;
};

/**
 * Looks for a profile named default and returns that
 * or the first profile if not found
 *
 * @param profileNames list of profile names
 * @returns
 */
const getDefaultProfile = (profileNames: string[]): string => {
	if (profileNames.indexOf('default') >= 0) {
		return 'default';
	}
	return profileNames[0];
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = async (context: vscode.ExtensionContext) => {
	const ctvConfig = useCtvConfig().getConfig();
	const cucumberTsFlow = useCucumberTsFlow();

	// If we have a project path and the cucumber-tsflow check passes we can load.
	if (ctvConfig.projectPath && cucumberTsFlow.checkCucumberTsFlow()) {
		// First step is to find all folders that have a cucumber configuration
		// file under the workspace root using allCucumberSettingsFromRoot
		const projects = new Array<CucumberProject>();
		const settingsPaths = ctvConfig.allCucumberSettingsFromRoot;

		// iterate through all paths, load configuration settings along
		// with other information and save that in the projects array.
		for (let setIdx = 0; setIdx < settingsPaths.length; setIdx++) {
			const config = await loadConfg(settingsPaths[setIdx]);
			const nameIdx = settingsPaths[setIdx].lastIndexOf('/');
			// Project name is the name of the folder that contains the cucumber configuration
			projects.push({
				name: settingsPaths[setIdx].substring(nameIdx + 1),
				path: settingsPaths[setIdx],
				config: config,
				gherkin: new GherkinManager(settingsPaths[setIdx].substring(nameIdx + 1), settingsPaths[setIdx])
			});
		}

		// Project names are the names of the folders that contains cucumber configuration files.
		// In other words, each project represents a folder in the workspace.
		// iterate through the projects in sorted order
		const sortedProjects = sortByName(projects);
		for (let pIdx = 0; pIdx < sortedProjects.length; pIdx++) {
			const project = sortedProjects[pIdx];

			// get profile names from config and find the default, which
			// is either marked as default or the first profile found
			const profileNames = Object.getOwnPropertyNames(project.config);
			const defaultProfile = getDefaultProfile(profileNames);

			// load the profiles into an array and load the
			// feature and step paths from the profiles into an array
			const profiles = Object.values(project.config);
			const featurePaths = getMatchPaths(profiles, 'paths');
			const stepPaths = [...getMatchPaths(profiles, 'require'), ...getMatchPaths(profiles, 'import')];

			// get blob path used to query for files
			const featureSelectors: string[] = featurePaths.map((x: string) => getProjectGlobPath(x, project.name)) ?? [];
			const stepSelectors: string[] = stepPaths?.map((x: string) => getProjectGlobPath(x, project.name)) ?? [];

			// Create a vs code test controller for each project
			const projectName = `Cucumber - ${project.name}`;
			const controllerId = toKebabCase(projectName);
			const testController = vscode.tests.createTestController(controllerId, projectName);

			// initialize test helpers
			const stepFileManager = new StepFileManager(project);
			const testFeatures = new CucumberTestFeatures(stepFileManager, testController, project);

			// Custom handler for loading tests.
			testController.resolveHandler = async () => {
				testController.items.replace(await testFeatures.loadTests());
			};

			const cucumberProfiles = new Array<CucumberProfile>();
			for (let pnIdx = 0; pnIdx < profileNames.length; pnIdx++) {
				const profileName = profileNames[pnIdx];

				const runLabel = `Run - ${profileName}`;
				const runProfile = testController.createRunProfile(
					runLabel,
					vscode.TestRunProfileKind.Run,
					(request, token) => testFeatures.runTests(request, token, profileName),
					profileName === defaultProfile
				);
				cucumberProfiles.push({ controllerId: controllerId, profileLabel: runLabel, profile: profileName });

				const debugLabel = `Debug - ${profileName}`;
				const debugProfile = testController.createRunProfile(
					debugLabel,
					vscode.TestRunProfileKind.Debug,
					(request, token) => testFeatures.runTests(request, token, profileName, true),
					profileName === defaultProfile
				);
				cucumberProfiles.push({ controllerId: controllerId, profileLabel: debugLabel, profile: profileName });

				context.subscriptions.push(runProfile);
				context.subscriptions.push(debugProfile);
			}

			// Register a run command
			let runCucumber = vscode.commands.registerCommand(
				`cucumber.${project.name}.runCucumber`,
				async (testFeatureSteps: Array<TestFeatureStep>, token: vscode.CancellationToken) => {
					await testFeatures.runCodeLenseTests(testFeatureSteps, token, cucumberProfiles, defaultProfile);
				}
			);

			// register a debug command
			let debugCucumber = vscode.commands.registerCommand(
				`cucumber.${project.name}.debugCucumber`,
				async (testFeatureSteps: Array<TestFeatureStep>, token: vscode.CancellationToken) => {
					await testFeatures.runCodeLenseTests(testFeatureSteps, token, cucumberProfiles, defaultProfile, true);
				}
			);

			// initialize a code lense provider for step files
			const codeLensProvider = new StepCodeLensProvider(stepFileManager);
			if (!ctvConfig.disableCodeLens) {
				const docSelectors: vscode.DocumentFilter[] = stepSelectors.map((x: string) => {
					return { pattern: x } as vscode.DocumentFilter;
				});
				const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(docSelectors, codeLensProvider);
				context.subscriptions.push(codeLensProviderDisposable);
			}

			// Handle saves to a feature file — keeps gherkin data up to date
			vscode.workspace.onDidSaveTextDocument(async e => {
				if (featureSelectors.some((selector: string) => minimatch(e.uri.path, selector))) {
					await stepFileManager.updateFeature(e.uri.fsPath);
					await testFeatures.updateTests(e.uri);
				}
			});

			// Handle saves to a step file — trigger incremental support-code reload
			vscode.workspace.onDidSaveTextDocument(e => {
				if (stepSelectors.some((selector: string) => minimatch(e.uri.path, selector))) {
					testFeatures.notifyFileChanged(e.uri.fsPath);
				}
			});

			context.subscriptions.push(testController);
			context.subscriptions.push(runCucumber);
			context.subscriptions.push(debugCucumber);
			context.subscriptions.push({ dispose: () => testFeatures.dispose() });
		}
		// log the fact that the extension is active
		ctvConfig.cucumberOutput.appendLine('Cucumber TsFlow for VS Code is now active!');
	}
};

// this method is called when your extension is deactivated
export const deactivate = () => {};
