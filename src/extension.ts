// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import minimatch from "minimatch";
import { StepCodeLensProvider } from "./step-code-lens-provider";
import ctvConfig from "./ctv-config";
import cucumberRunner from "./cucumber/cucumber-runner";
import stepFileManager from "./cucumber/step-file-manager";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = async (context: vscode.ExtensionContext) => {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("Cucumber TsFlow for VSCode is now active!");

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let runCucumber = vscode.commands.registerCommand(
    "extension.runCucumber",
    async (filePath: string, lineNumber: number) => {
      await cucumberRunner.runCucumber(filePath, lineNumber);
    }
  );

  let debugCucumber = vscode.commands.registerCommand(
    "extension.debugCucumber",
    async (filePath: string, lineNumber: number) => {
      await cucumberRunner.debugCucumber(filePath, lineNumber);
    }
  );

  const codeLensProvider = new StepCodeLensProvider();
  if (!ctvConfig.disableCodeLens) {
    const docSelectors: vscode.DocumentFilter[] = [
      { pattern: ctvConfig.stepFileSelector },
    ];
    const codeLensProviderDisposable =
      vscode.languages.registerCodeLensProvider(docSelectors, codeLensProvider);
    context.subscriptions.push(codeLensProviderDisposable);
  }

  // handle feature file edits. Keeps the gherkin feature data up to date
  vscode.workspace.onDidChangeTextDocument(function (e) {
    if (minimatch(e.document.uri.path, ctvConfig.featureFileSelector)) {
      stepFileManager.updateFeature(e.document.uri.path, e.document.getText());
    }
  });

  // handle saves to a feature file. Keeps the gherkin feature data up to date
  vscode.workspace.onDidSaveTextDocument(function (e) {
    if (minimatch(e.uri.path, ctvConfig.featureFileSelector)) {
      stepFileManager.updateFeature(e.uri.path);
    }
  });

  context.subscriptions.push(runCucumber);
  context.subscriptions.push(debugCucumber);
};

// this method is called when your extension is deactivated
export const deactivate = () => {};
