import { readFileSync } from "fs";
import GherkinFeature from "./gherkin-feature";
import { ParsedFeature, ParsedScenario, ParsedStep } from "./models";
import { hasStringValue } from "@lynxwall/cucumber-tsflow/lib/utils/helpers";
import {
  hasMatchingStep,
  hasMatchingTags,
} from "@lynxwall/cucumber-tsflow/lib/cucumber/utils";
import {
  StepFileFeature,
  stepFileFeatures,
} from "../cucumber/step-file-features";
import { normalizePath } from "../utils";

export class StepInfo {
  constructor(name: string) {
    this.name = name;
  }
  name: string;
  text: string = "";
  tags: string = "";
  lineNo: number = -1;
}

export interface IMapFeaturesResult {
  features?: any;
  steps: StepInfo[];
}

export default class GherkinManager {
  private features: Array<ParsedFeature> = [];
  private gherkinFeature = new GherkinFeature();

  constructor(paths: string[]) {
    for (const path of paths) {
      const features = this.gherkinFeature.loadFeatures(path);
      this.features = [...this.features, ...features];
    }
  }

  public updateFeature = (filePath: string, fileText?: string) => {
    const feature = fileText
      ? this.gherkinFeature.parseFeature(fileText, filePath)
      : this.gherkinFeature.loadFeature(filePath);

    const featureIdx = this.features.findIndex((f) =>
      this.hasSamePath(f.featureFile, filePath)
    );
    if (featureIdx >= 0) {
      this.features[featureIdx] = feature;
    } else {
      this.features = [...this.features, ...[feature]];
    }
  };

  private hasSamePath = (gherkinPath: string, vscodePath: string): boolean => {
    // vscode paths are normalized with leading slash
    // check to see if we need to normalize the path
    if (gherkinPath.indexOf("\\") >= 0) {
      gherkinPath = normalizePath(`/${gherkinPath}`);
    }
    return gherkinPath === vscodePath;
  };

  /**
   * Maps all of the features/scenarios/steps from a step file with
   * associated information in a feature file.
   * @param fileText
   * @returns
   */
  public mapFeaturesFromStepFile = (fileText: string): IMapFeaturesResult => {
    const sfFeatures = stepFileFeatures();

    const fileSteps = this.parseSteps(fileText);
    for (const feature of this.features) {
      for (const scenario of feature.scenarios) {
        for (const step of scenario.steps) {
          this.findAddStep(sfFeatures, fileSteps, feature, scenario, step);
        }
      }
      for (const scenarioOutline of feature.scenarioOutlines) {
        for (const scenario of scenarioOutline.scenarios) {
          scenario.lineNumber = scenarioOutline.lineNumber;
          for (const step of scenario.steps) {
            this.findAddStep(sfFeatures, fileSteps, feature, scenario, step);
          }
        }
      }
    }
    return { features: sfFeatures, steps: fileSteps };
  };

  /**
   * Helper used to find steps from the parsed Gherkin features
   * and add step info to a set of arrays for use when generating
   * the code lense values.
   * @param sfFeatures
   * @param fileSteps
   * @param feature
   * @param scenario
   * @param step
   */
  private findAddStep = (
    sfFeatures: StepFileFeature,
    fileSteps: StepInfo[],
    feature: ParsedFeature,
    scenario: ParsedScenario,
    step: ParsedStep
  ) => {
    if (["given", "when", "then", "and"].find((x) => x === step.keyword)) {
      const fileStep = fileSteps.find((s) =>
        hasMatchingStep(s.text.toLowerCase(), step.stepText.toLowerCase())
      );
      if (fileStep) {
        // if we have tags on the step binding check to see if it matches one in the
        // current scenario, which also includes tags associated with the feature
        if (hasStringValue(fileStep.tags)) {
          if (
            scenario.tags.length > 0 &&
            hasMatchingTags(fileStep.tags, scenario.tags)
          ) {
            sfFeatures
              .upsertFeature(feature)
              .upsertScenario(scenario)
              .upsertStep(step);
          }
        } else {
          sfFeatures
            .upsertFeature(feature)
            .upsertScenario(scenario)
            .upsertStep(step);
        }
      }
    }
  };

  /**
   * extracts 'given', 'when', 'then' step text and tags from
   * the file passed in.
   * @param stepText
   * @returns
   */
  private parseSteps = (stepText: string): StepInfo[] => {
    const stepNames = [
      "before",
      "beforestep",
      "given",
      "when",
      "then",
      "afterstep",
      "after",
    ];
    const steps = new Array<StepInfo>();
    //const stepText: string = readFileSync(filePath, 'utf8');
    // get all of the decorator strings
    const stepDecorators = stepText.match(/@\w*\(([^()]+)\)/g);
    stepDecorators?.forEach((decorator) => {
      const stepName = stepNames.find(
        (x) => decorator.toLowerCase().indexOf(x) >= 0
      );
      if (stepName) {
        const stepInfo = new StepInfo(stepName);
        // extract strings from inside decorator parens,
        // can be wrapped in single or double quotes
        const paramsDouble = decorator.match(/["]\s*([^"]+?)\s*["]/g);
        const paramsSingle = decorator.match(/[']\s*([^']+?)\s*[']/g);

        let stepParams = undefined;
        if (paramsDouble && paramsSingle) {
          stepParams =
            paramsDouble.length > paramsSingle.length
              ? paramsDouble
              : paramsSingle;
        } else {
          stepParams = paramsDouble ?? paramsSingle;
        }
        if (stepParams && stepParams.length > 0) {
          // first param in hooks is the tags parameter
          if (this.isHook(stepName)) {
            stepInfo.tags = stepParams[0].substring(
              1,
              stepParams[0].length - 1
            );
          } else {
            // steps support four parameters with last three optional
            // first is the pattern and second is a tag, which are the
            // two peices of information we need to make a match
            stepInfo.text = stepParams[0].substring(
              1,
              stepParams[0].length - 1
            );
            if (stepParams.length > 1 && hasStringValue(stepParams[1])) {
              stepInfo.tags = stepParams[1].substring(
                1,
                stepParams[1].length - 1
              );
            }
          }
        }
        stepInfo.lineNo = this.getLine(stepText, stepInfo.text);
        steps.push(stepInfo);
      }
    });

    return steps;
  };

  /**
   * Helper used to get the line number of a step in a steps file.
   * @param body
   * @param srchStr
   * @returns
   */
  private getLine = (body: string, srchStr: string): number => {
    if (!body) {
      return -1;
    }
    if (!srchStr) {
      return -1;
    }
    const char = typeof srchStr === "string" ? body.indexOf(srchStr) : srchStr;
    const subBody = body.substring(0, char);
    if (subBody === "") {
      return -1;
    }
    const match = subBody.match(/\n/gi);
    if (match) {
      return match.length + 1;
    }
    return 1;
  };

  /**
   * Test to see if a step name is a hook
   * @param stepName
   * @returns
   */
  private isHook = (stepName: string): boolean => {
    const hookNames = [
      "beforeall",
      "before",
      "beforestep",
      "afterstep",
      "after",
      "afterall",
    ];
    const match = hookNames.find((x) => stepName.toLowerCase().indexOf(x) >= 0);
    return match !== undefined;
  };
}
