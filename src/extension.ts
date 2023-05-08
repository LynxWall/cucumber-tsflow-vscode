// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import minimatch from 'minimatch';
import StepCodeLensProvider from './step-code-lens-provider';
import useCtvConfig from './use-ctv-config';
import StepFileManager from './cucumber/step-file-manager';
import CucumberTestFeatures from './cucumber/cucumber-test-features';
import useCucumberTsFlow from './use-cucumber-tsflow';
import { TestFeatureStep } from './types';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = async (context: vscode.ExtensionContext) => {
	const ctvConfig = useCtvConfig().getConfig();
	const cucumberTsFlow = useCucumberTsFlow();
	const cucumbersettingsPath = ctvConfig.currentCucumberSettingsPath;

	if (cucumbersettingsPath && cucumberTsFlow.checkCucumberTsFlow()) {
		// create a test controller
		const testController = vscode.tests.createTestController('cucumber-tsflow-vscode', 'Cucumber TsFlow VS Code');

		// load test features
		const stepFileManager = new StepFileManager();
		await stepFileManager.loadFeatures();
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

		// Register a run command
		let runCucumber = vscode.commands.registerCommand(
			'extension.runCucumber',
			async (testFeatureSteps: Array<TestFeatureStep>, token: vscode.CancellationToken) => {
				await testFeatures.runCodeLenseTests(testFeatureSteps, token);
			}
		);

		// register a debug command
		let debugCucumber = vscode.commands.registerCommand(
			'extension.debugCucumber',
			async (testFeatureSteps: Array<TestFeatureStep>, token: vscode.CancellationToken) => {
				await testFeatures.runCodeLenseTests(testFeatureSteps, token, true);
			}
		);

		// initialize a code lense provider for step files
		const codeLensProvider = new StepCodeLensProvider(stepFileManager);
		if (!ctvConfig.disableCodeLens) {
			const docSelectors: vscode.DocumentFilter[] = [{ pattern: ctvConfig.stepsSelector }];
			const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(docSelectors, codeLensProvider);
			context.subscriptions.push(codeLensProviderDisposable);
		}

		// handle saves to a feature file. Keeps the gherkin feature data up to date
		vscode.workspace.onDidSaveTextDocument(async e => {
			if (minimatch(e.uri.path, ctvConfig.featuresSelector)) {
				await stepFileManager.updateFeature(e.uri.fsPath);
				await testFeatures.updateTests(e.uri);
			} else if (minimatch(e.uri.path, ctvConfig.stepsSelector)) {
				await testFeatures.updateTests(e.uri);
			}
		});

		context.subscriptions.push(testController);
		context.subscriptions.push(runCucumber);
		context.subscriptions.push(debugCucumber);

		// log the fact that the extension is active
		ctvConfig.cucumberOutput.appendLine('Cucumber TsFlow for VS Code is now active!');
	} else {
		ctvConfig.cucumberOutput.appendLine(`Unable to find cucumber settings with "${ctvConfig.profile}" profile`);
	}
};

// this method is called when your extension is deactivated
export const deactivate = () => {};
