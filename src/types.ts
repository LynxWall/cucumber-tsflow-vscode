import { ManagedScenarioContext } from '@lynxwall/cucumber-tsflow/lib/cucumber/managed-scenario-context';
import { Options } from './gherkin/configuration';

export type StepFromStepDefinitions = {
	stepMatcher: string | RegExp;
	stepFunction(stepArguments?: any): void | PromiseLike<any>;
};

export type ScenarioFromStepDefinitions = {
	title: string;
	steps: StepFromStepDefinitions[];
};

export type FeatureFromStepDefinitions = {
	title: string;
	scenarios: ScenarioFromStepDefinitions[];
};

export type ParsedStep = {
	keyword: string;
	stepText: string;
	stepArgument: string | {};
	lineNumber: number;
};

export type ParsedScenario = {
	title: string;
	steps: ParsedStep[];
	tags: string[];
	lineNumber: number;
	skippedViaTagFilter: boolean;
	scenarioContext: ManagedScenarioContext | undefined;
};

export type ParsedScenarioOutline = {
	title: string;
	tags: string[];
	scenarios: ParsedScenario[];
	steps: ParsedStep[];
	lineNumber: number;
	skippedViaTagFilter: boolean;
	scenarioContext: ManagedScenarioContext | undefined;
};

export type ParsedFeature = {
	title: string;
	featureFile: string;
	scenarios: ParsedScenario[];
	scenarioOutlines: ParsedScenarioOutline[];
	options: Options;
	tags: string[];
};

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

export type FeatureStepMatch = {
	feature: FeatureFromStepFile;
	scenario?: ScenarioFromStepFile;
};

export type TestFeatureStep = {
	featureFile: string;
	lineNumber?: Number;
};

export type StepFileFeature = {
	upsertFeature: (feature: ParsedFeature) => UseStepFileFeature;
	getPrimaryFeature: () => FeatureFromStepFile | undefined;
	getMatchingFeatures: (stepText: string) => Array<FeatureStepMatch>;
	getMatchingFeaturesAndScenarios: (stepText: string) => Array<FeatureStepMatch>;
};

export type UseStepFileFeature = {
	feature: FeatureFromStepFile;
	upsertScenario: (scenario: ParsedScenario) => UseStepFileScenario;
	getMatchingScenario: (stepText: string) => UseStepFileScenario | undefined;
};

export type UseStepFileScenario = {
	scenario: ScenarioFromStepFile;
	upsertStep: (step: ParsedStep) => void;
	hasStepText: (stepText: string) => boolean;
	hasGivenWhenThen: () => boolean;
};
