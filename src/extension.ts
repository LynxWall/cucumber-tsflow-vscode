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

const sortByName = sortBy<CucumberProject>(compose(toLower, prop('name')));

const getMatchPaths = (profiles: any[], propName: string): string[] => {
	return profiles.reduce((result, curr) => {
		if (result.length === 0) {
			return curr[propName];
		} else {
			return [...new Set([...result, ...curr[propName]])];
		}
	}, [] as string[]);
};

const getMatchPattern = (pattern: string, projectName: string) => {
	// check for relative paths
	if (pattern.startsWith('./') || pattern.startsWith('.\\')) {
		pattern = pattern.substring(2);
	} else if (pattern.startsWith('../') || pattern.startsWith('..\\')) {
		pattern = pattern.substring(3);
	}
	// if starting with glob strip it off since we'll add it back in
	if (pattern.startsWith('**/') || pattern.startsWith('**\\')) {
		pattern = pattern.substring(3);
	}
	return `**/${projectName}/${pattern}`;
};

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

	if (ctvConfig.projectPath && cucumberTsFlow.checkCucumberTsFlow()) {
		const projects = new Array<CucumberProject>();
		const settingsPaths = ctvConfig.allCucumberSettingsFromRoot;
		for (let setIdx = 0; setIdx < settingsPaths.length; setIdx++) {
			const config = await loadConfg(settingsPaths[setIdx]);
			const nameIdx = settingsPaths[setIdx].lastIndexOf('/');
			projects.push({
				name: settingsPaths[setIdx].substring(nameIdx + 1),
				path: settingsPaths[setIdx],
				config: config,
				gherkin: new GherkinManager(settingsPaths[setIdx].substring(nameIdx + 1), settingsPaths[setIdx])
			});
		}

		const sortedProjects = sortByName(projects);
		for (let pIdx = 0; pIdx < sortedProjects.length; pIdx++) {
			const project = sortedProjects[pIdx];

			const profileNames = Object.getOwnPropertyNames(project.config);
			const defaultProfile = getDefaultProfile(profileNames);

			const profiles = Object.values(project.config);
			const featurePaths = getMatchPaths(profiles, 'paths');
			const stepPaths = getMatchPaths(profiles, 'require');

			const featureSelectors: string[] = featurePaths.map((x: string) => getMatchPattern(x, project.name)) ?? [];
			const stepSelectors: string[] = stepPaths.map((x: string) => getMatchPattern(x, project.name)) ?? [];

			const projectName = `Cucumber - ${project.name}`;
			const controllerId = toKebabCase(projectName);
			const testController = vscode.tests.createTestController(controllerId, projectName);
			const stepFileManager = new StepFileManager(project);
			const testFeatures = new CucumberTestFeatures(stepFileManager, testController);

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

			// handle saves to a feature file. Keeps the gherkin feature data up to date
			vscode.workspace.onDidSaveTextDocument(async e => {
				if (featureSelectors.some((selector: string) => minimatch(e.uri.path, selector))) {
					await stepFileManager.updateFeature(e.uri.fsPath);
					await testFeatures.updateTests(e.uri);
				}
			});

			context.subscriptions.push(testController);
			context.subscriptions.push(runCucumber);
			context.subscriptions.push(debugCucumber);
		}
		// log the fact that the extension is active
		ctvConfig.cucumberOutput.appendLine('Cucumber TsFlow for VS Code is now active!');
	}
};

// this method is called when your extension is deactivated
export const deactivate = () => {};
