import { ParsedFeature, ParsedScenario, ParsedStep } from '../types';
import {
	FeatureStepMatch,
	FeatureFromStepFile,
	ScenarioFromStepFile,
	StepFromStepFile,
	UseStepFileFeature,
	UseStepFileScenario
} from '../types';
import { hasMatchingStep } from '@lynxwall/cucumber-tsflow/lib/cucumber/utils';

/**
 * Capture parsed features
 * @returns upsertFeature, getMatchingFeatureAndScenario
 */
const stepFileFeatures = () => {
	const features = new Array<FeatureFromStepFile>();

	const upsertFeature = (feature: ParsedFeature): UseStepFileFeature => {
		let sfFeature = features.find(f => f.title === feature.title);
		if (!sfFeature) {
			sfFeature = {
				title: feature.title,
				featureFile: feature.featureFile,
				scenarios: new Array<ScenarioFromStepFile>()
			};
			features.push(sfFeature);
		}
		return useStepFileFeature(sfFeature);
	};

	const getPrimaryFeature = (): FeatureFromStepFile | undefined => {
		let primaryFeature = undefined;
		for (let feature of features) {
			for (const scenario of feature.scenarios) {
				if (useStepFileScenario(scenario).hasGivenWhenThen()) {
					primaryFeature = feature;
					break;
				}
			}
			if (primaryFeature) {
				break;
			}
		}
		return primaryFeature;
	};

	const getMatchingFeatures = (stepText: string): Array<FeatureStepMatch> => {
		const matchingFeatures = new Array<FeatureStepMatch>();
		for (let idx = 0; idx < features.length; idx++) {
			const featureScenario = useStepFileFeature(features[idx]);
			const scenarioStep = featureScenario.getMatchingScenario(stepText);
			if (scenarioStep) {
				matchingFeatures.push({ feature: featureScenario.feature, scenario: undefined });
				continue;
			}
		}
		return matchingFeatures;
	};

	const getMatchingFeaturesAndScenarios = (stepText: string): Array<FeatureStepMatch> => {
		const matchingFeatures = new Array<FeatureStepMatch>();
		for (let idx = 0; idx < features.length; idx++) {
			const featureScenario = useStepFileFeature(features[idx]);
			const scenarioStep = featureScenario.getMatchingScenario(stepText);
			if (scenarioStep) {
				matchingFeatures.push({ feature: featureScenario.feature, scenario: scenarioStep.scenario });
			}
		}
		return matchingFeatures;
	};

	return { upsertFeature, getPrimaryFeature, getMatchingFeaturesAndScenarios };
};

/**
 *
 * @param feature
 * @returns
 */
const useStepFileFeature = (feature: FeatureFromStepFile) => {
	const upsertScenario = (scenario: ParsedScenario): UseStepFileScenario => {
		let sfScenario = feature.scenarios.find(s => s.title === scenario.title);
		if (!sfScenario) {
			sfScenario = {
				title: scenario.title,
				lineNumber: scenario.lineNumber,
				steps: new Array<StepFromStepFile>()
			};
			feature.scenarios.push(sfScenario);
		}
		return useStepFileScenario(sfScenario);
	};

	const getMatchingScenario = (stepText: string): UseStepFileScenario | undefined => {
		for (let idx = 0; idx < feature.scenarios.length; idx++) {
			const scenario = useStepFileScenario(feature.scenarios[idx]);
			if (scenario.hasStepText(stepText) && scenario.hasGivenWhenThen()) {
				return scenario;
			}
		}
		return undefined;
	};

	return { feature, upsertScenario, getMatchingScenario };
};

/**
 *
 * @param scenario
 * @returns
 */
const useStepFileScenario = (scenario: ScenarioFromStepFile) => {
	const upsertStep = (step: ParsedStep) => {
		let sfStep = scenario.steps.find(s => s.keyword === step.keyword && s.stepText === step.stepText);
		if (!sfStep) {
			sfStep = {
				keyword: step.keyword,
				stepText: step.stepText,
				lineNumber: step.lineNumber
			};
			scenario.steps.push(sfStep);
		}
	};

	const hasStepText = (stepText: string): boolean => {
		const match =
			scenario.steps.find(s => hasMatchingStep(stepText.toLowerCase(), s.stepText.toLowerCase())) !== undefined;
		return match;
	};

	const hasGivenWhenThen = (): boolean => {
		const allMatch = ['given', 'when', 'then'].every(step => {
			return scenario.steps.find(s => s.keyword === step) !== undefined;
		});
		if (!allMatch) {
			// check for just given/then
			return ['given', 'then'].every(step => {
				return scenario.steps.find(s => s.keyword === step) !== undefined;
			});
		}
		return allMatch;
	};

	return { scenario, upsertStep, hasStepText, hasGivenWhenThen };
};

export { stepFileFeatures };
