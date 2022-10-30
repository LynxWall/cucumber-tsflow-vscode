// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import minimatch from 'minimatch';
import { StepCodeLensProvider } from './step-code-lens-provider';
import ctvConfig from './ctv-config';
import cucumberRunner from './cucumber/cucumber-runner';
import stepFileManager from './cucumber/step-file-manager';
import useCucumberTsFlow from './use-cucumber-tsflow';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = async (context: vscode.ExtensionContext) => {
	const cucumberTsFlow = useCucumberTsFlow();
	if (cucumberTsFlow.checkCucumberTsFlow()) {
		// Register a run command
		let runCucumber = vscode.commands.registerCommand(
			'extension.runCucumber',
			async (filePath: string, lineNumber: number) => {
				await cucumberRunner.runCucumber(filePath, lineNumber);
			}
		);

		// register a debug command
		let debugCucumber = vscode.commands.registerCommand(
			'extension.debugCucumber',
			async (filePath: string, lineNumber: number) => {
				await cucumberRunner.debugCucumber(filePath, lineNumber);
			}
		);

		// initialize a code lense provider for step files
		const codeLensProvider = new StepCodeLensProvider();
		if (!ctvConfig.disableCodeLens) {
			const docSelectors: vscode.DocumentFilter[] = [{ pattern: ctvConfig.stepsSelector }];
			const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(docSelectors, codeLensProvider);
			context.subscriptions.push(codeLensProviderDisposable);
		}

		// handle feature file edits. Keeps the gherkin feature data up to date
		vscode.workspace.onDidChangeTextDocument(function (e) {
			if (minimatch(e.document.uri.path, ctvConfig.featuresSelector)) {
				stepFileManager.updateFeature(e.document.uri.path, e.document.getText());
			}
		});

		// handle saves to a feature file. Keeps the gherkin feature data up to date
		vscode.workspace.onDidSaveTextDocument(function (e) {
			if (minimatch(e.uri.path, ctvConfig.featuresSelector)) {
				stepFileManager.updateFeature(e.uri.path);
			}
		});

		context.subscriptions.push(runCucumber);
		context.subscriptions.push(debugCucumber);

		// log the fact that the extension is active
		console.log('Cucumber TsFlow for VS Code is now active!');
	}
};

// this method is called when your extension is deactivated
export const deactivate = () => {};
