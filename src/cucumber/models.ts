export type StepFromStepFile = {
  keyword: string;
  stepText: string;
  lineNumber: number;
};

export type ScenarioFromStepFile = {
  title: string;
  lineNumber: number;
  steps: StepFromStepFile[];
};

export type FeatureFromStepFile = {
  title: string;
  featureFile: string;
  scenarios: ScenarioFromStepFile[];
};
