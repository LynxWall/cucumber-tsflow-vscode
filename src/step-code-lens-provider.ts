import {
  CodeLens,
  CodeLensProvider,
  Position,
  Range,
  TextDocument,
} from "vscode";
import useCucumberTsFlow from "./use-cucumber-tsflow";
import stepFileManager from "./cucumber/step-file-manager";

export class StepCodeLensProvider implements CodeLensProvider {
  private cucumberTsFlow = useCucumberTsFlow();

  public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const codeLens: CodeLens[] = [];
    let text = "";
    try {
      if (this.cucumberTsFlow.checkCucumberTsFlow()) {
        const steps = await stepFileManager.getSteps(document.getText());
        steps.forEach((step) => {
          if (["given", "when", "then", "and"].find((x) => x === step.name)) {
            text = step.text;
            const { feature, scenario } = stepFileManager.getFeatureAndScenario(
              step.text
            );
            if (feature && scenario) {
              const pos = new Position(step.lineNo - 1, 0);
              const range = new Range(pos, pos);
              codeLens.push(
                new CodeLens(range, {
                  title: "run",
                  command: "extension.runCucumber",
                  arguments: [feature.featureFile, scenario.lineNumber],
                })
              );
              codeLens.push(
                new CodeLens(range, {
                  title: "debug",
                  command: "extension.debugCucumber",
                  arguments: [feature.featureFile, scenario.lineNumber],
                })
              );
            }
          }
        });
      }
    } catch (e) {
      // Ignore error and keep showing Run/Debug buttons at same position
      console.error(`step parser for text: '${text}', returned an error`, e);
    }
    return codeLens;
  }
}
