import { CodeLens, CodeLensProvider, Position, Range, TextDocument } from 'vscode';
import stepFileManager from './cucumber/step-file-manager';

export class StepCodeLensProvider implements CodeLensProvider {
	public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
		const codeLens: CodeLens[] = [];
		let text = '';
		try {
			const steps = await stepFileManager.getSteps(document.getText());
			steps.forEach(step => {
				if (['given', 'when', 'then', 'and'].find(x => x === step.name)) {
					text = step.text;
					const { feature, scenario } = stepFileManager.getFeatureAndScenario(step.text);
					if (feature && scenario) {
						const pos = new Position(step.lineNo - 1, 0);
						const range = new Range(pos, pos);
						codeLens.push(
							new CodeLens(range, {
								title: 'Run',
								command: 'extension.runCucumber',
								arguments: [feature.featureFile, scenario.lineNumber]
							})
						);
						codeLens.push(
							new CodeLens(range, {
								title: 'Debug',
								command: 'extension.debugCucumber',
								arguments: [feature.featureFile, scenario.lineNumber]
							})
						);
					}
				}
			});
			// Add runAll | debugAll to the binding
			const primaryFeature = stepFileManager.getFeature();
			const bindingStep = steps.find(x => x.name === 'binding');
			if (primaryFeature && bindingStep) {
				const pos = new Position(bindingStep.lineNo - 1, 0);
				const range = new Range(pos, pos);
				codeLens.push(
					new CodeLens(range, {
						title: 'RunAll',
						command: 'extension.runCucumber',
						arguments: [primaryFeature.featureFile, undefined]
					})
				);
				codeLens.push(
					new CodeLens(range, {
						title: 'DebugAll',
						command: 'extension.debugCucumber',
						arguments: [primaryFeature.featureFile, undefined]
					})
				);
			}
		} catch (e) {
			// Ignore error and keep showing Run/Debug buttons at same position
			console.error(`step parser for text: '${text}', returned an error`, e);
		}
		return codeLens;
	}
}
