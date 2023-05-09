import * as vscode from 'vscode';
import { CodeLens, CodeLensProvider, Position, Range, TextDocument } from 'vscode';
import CtvConfig from './ctv-config';
import StepFileManager from './cucumber/step-file-manager';
import { TestFeatureStep } from './types';
import useCtvConfig from './use-ctv-config';

export default class StepCodeLensProvider implements CodeLensProvider {
	private stepFileManager: StepFileManager;
	private ctvConfig: CtvConfig;

	constructor(stepFileManager: StepFileManager) {
		this.ctvConfig = useCtvConfig().getConfig();
		this.stepFileManager = stepFileManager;
	}

	public async provideCodeLenses(document: TextDocument, token: vscode.CancellationToken): Promise<CodeLens[]> {
		const codeLens: CodeLens[] = [];

		const featureArgs = new Array<TestFeatureStep>();
		try {
			if (!this.stepFileManager.hasFeatures) {
				await this.stepFileManager.loadFeatures();
			}

			const steps = await this.stepFileManager.getSteps(document);
			for (let sIdx = 0; sIdx < steps.length; sIdx++) {
				const step = steps[sIdx];
				if (['given', 'when', 'then', 'and'].find(x => x === step.name)) {
					const featureStepArgs = new Array<TestFeatureStep>();
					const matchingFeatures = this.stepFileManager.getFeaturesAndScenarios(document.uri.fsPath, step.text);

					for (let fIdx = 0; fIdx < matchingFeatures.length; fIdx++) {
						const match = matchingFeatures[fIdx];
						featureStepArgs.push({ featureFile: match.feature.featureFile, lineNumber: match.scenario?.lineNumber });
						if (
							featureArgs.findIndex(
								x => x.featureFile === match.feature.featureFile && x.lineNumber === match.scenario?.lineNumber
							) < 0
						) {
							featureArgs.push({ featureFile: match.feature.featureFile, lineNumber: match.scenario?.lineNumber });
						}
					}
					if (featureStepArgs.length > 0) {
						const pos = new Position(step.lineNo - 1, 0);
						const range = new Range(pos, pos);
						codeLens.push(
							new CodeLens(range, {
								title: 'Run',
								command: 'extension.runCucumber',
								arguments: [featureStepArgs, token]
							})
						);
						codeLens.push(
							new CodeLens(range, {
								title: 'Debug',
								command: 'extension.debugCucumber',
								arguments: [featureStepArgs, token]
							})
						);
					}
				}
			}
			// Add runAll | debugAll to the binding
			const bindingStep = steps.find(x => x.name === 'binding');
			if (bindingStep) {
				const pos = new Position(bindingStep.lineNo - 1, 0);
				const range = new Range(pos, pos);
				codeLens.push(
					new CodeLens(range, {
						title: 'RunAll',
						command: 'extension.runCucumber',
						arguments: [featureArgs, token]
					})
				);
				codeLens.push(
					new CodeLens(range, {
						title: 'DebugAll',
						command: 'extension.debugCucumber',
						arguments: [featureArgs, token]
					})
				);
			}
		} catch (e) {
			// Ignore error and keep showing Run/Debug buttons at same position
			console.error(`step parser returned an error`, e);
		}
		return codeLens;
	}
}
