// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import minimatch from 'minimatch';
import StepCodeLensProvider from './step-code-lens-provider';
import useCtvConfig from './use-ctv-config';
import StepFileManager from './cucumber/step-file-manager';
import CucumberTestFeatures from './cucumber/cucumber-test-features';
import useCucumberTsFlow from './use-cucumber-tsflow';
import { CucumberProject, TestFeatureStep } from './types';
import { loadConfg } from './configuration/load-config';
import path from 'path';
import { toKebabCase } from './utils';
import GherkinManager from './gherkin/gherkin-manager';

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

		for (let pIdx = 0; pIdx < projects.length; pIdx++) {
			const project = projects[pIdx];

			let profile = project.config.default;
			if (!profile) {
				profile = Object.values(project.config)[0];
			}

			const featureSelectors = profile.paths?.map((x: string) => path.join(project.path, x)) ?? [];
			const stepSelectors = profile.require?.map((x: string) => path.join(project.path, x)) ?? [];

			const projectName = `Cucumber - ${project.name}`;
			const testController = vscode.tests.createTestController(toKebabCase(projectName), projectName);
			const stepFileManager = new StepFileManager(project);
			const testFeatures = new CucumberTestFeatures(stepFileManager, testController);

			// We'll create the "run" type profile here, and give it the function to call.
			// You can also create debug and coverage profile types. The last `true` argument
			// indicates that this should by the default "run" profile, in case there were
			// multiple run profiles.
			testController.createRunProfile(
				'Run',
				vscode.TestRunProfileKind.Run,
				(request, token) => testFeatures.runTests(request, token),
				true
			);

			// e2eController.createRunProfile(
			// 	'Run',
			// 	vscode.TestRunProfileKind.Run,
			// 	(request, token) => testFeatures.runTests(request, token),
			// 	true
			// );
			testController.createRunProfile(
				'Debug',
				vscode.TestRunProfileKind.Debug,
				(request, token) => testFeatures.runTests(request, token, true),
				true
			);

			// Custom handler for loading tests. The "test" argument here is undefined,
			// but if we supported lazy-loading child test then this could be called with
			// the test whose children VS Code wanted to load.
			testController.resolveHandler = async test => {
				testController.items.replace(await testFeatures.loadTests());
			};
			// e2eController.resolveHandler = async test => {
			// 	e2eController.items.replace(await testFeatures.loadTests());
			// };

			// Register a run command
			let runCucumber = vscode.commands.registerCommand(
				`extension.${project.name}.runCucumber`,
				async (testFeatureSteps: Array<TestFeatureStep>, token: vscode.CancellationToken) => {
					await testFeatures.runCodeLenseTests(testFeatureSteps, token);
				}
			);

			// register a debug command
			let debugCucumber = vscode.commands.registerCommand(
				`extension.${project.name}.debugCucumber`,
				async (testFeatureSteps: Array<TestFeatureStep>, token: vscode.CancellationToken) => {
					await testFeatures.runCodeLenseTests(testFeatureSteps, token, true);
				}
			);

			// initialize a code lense provider for step files
			const codeLensProvider = new StepCodeLensProvider(stepFileManager);
			if (!ctvConfig.disableCodeLens) {
				const docSelectors: vscode.DocumentFilter[] = stepSelectors.map((x: string) => {
					return { pattern: x } as vscode.DocumentFilter;
				}); // [{ pattern: ctvConfig.stepsSelector }];
				const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(docSelectors, codeLensProvider);
				context.subscriptions.push(codeLensProviderDisposable);
			}

			// handle saves to a feature file. Keeps the gherkin feature data up to date
			vscode.workspace.onDidSaveTextDocument(async e => {
				if (featureSelectors.map((selector: string) => minimatch(e.uri.path, selector))) {
					await stepFileManager.updateFeature(e.uri.fsPath);
					await testFeatures.updateTests(e.uri);
				} else if (stepSelectors.map((selector: string) => minimatch(e.uri.path, selector))) {
					await testFeatures.updateTests(e.uri);
				}
			});

			context.subscriptions.push(testController);
			context.subscriptions.push(runCucumber);
			context.subscriptions.push(debugCucumber);
		}

		// // Initialize testFeatures instance
		// const e2eController = vscode.tests.createTestController('cucumber-tsflow-e2e', 'Cucumber e2e');
		// const testController = vscode.tests.createTestController('cucumber-tsflow-vscode', 'Cucumber test');

		// const stepFileManager = new StepFileManager();
		// const testFeatures = new CucumberTestFeatures(stepFileManager, testController);

		// log the fact that the extension is active
		ctvConfig.cucumberOutput.appendLine('Cucumber TsFlow for VS Code is now active!');
	} else {
		ctvConfig.cucumberOutput.appendLine(`Unable to find cucumber settings with "${ctvConfig.profile}" profile`);
	}
};

// this method is called when your extension is deactivated
export const deactivate = () => {};
