import cucumberConfig from './cucumber-config';
import GherkinManager, { StepInfo, IMapFeaturesResult } from '../gherkin/gherkin-manager';
import ctvConfig from '../ctv-config';
import { FeatureFromStepFile, ScenarioFromStepFile } from '../types';

class StepFileManager {
	private gherkin!: GherkinManager;
	private currentRootPath?: string;
	private currentFileText: string = '';
	private findFeatureResults?: IMapFeaturesResult;

	/**
	 * Get all of the steps from the step file text passed in.
	 * @param fileText
	 * @returns
	 */
	public getSteps = async (fileText: string): Promise<StepInfo[]> => {
		if (!this.gherkin || ctvConfig.cucumberPath !== this.currentRootPath) {
			await this.loadFeatures();
			this.currentRootPath = ctvConfig.cucumberPath;
		}

		if (fileText !== this.currentFileText || !this.findFeatureResults) {
			this.findFeatureResults = this.gherkin.mapFeaturesFromStepFile(fileText);
			this.currentFileText = fileText;
		}
		return this.findFeatureResults.steps;
	};

	/**
	 * Gets the main feature from the step file
	 */
	public getFeature = (): FeatureFromStepFile | undefined => {
		if (this.findFeatureResults?.features) {
			return this.findFeatureResults?.features.getPrimaryFeature();
		}
	};

	/**
	 * Get the associated feature and scenario from the step text passed in
	 * @param stepText
	 * @returns
	 */
	public getFeatureAndScenario = (
		stepText: string
	): {
		feature?: FeatureFromStepFile;
		scenario?: ScenarioFromStepFile;
	} => {
		if (this.findFeatureResults?.features) {
			return this.findFeatureResults?.features.getMatchingFeatureAndScenario(stepText);
		}
		return { feature: undefined, scenario: undefined };
	};

	/**
	 * Update a feature that's changed. Called from extensions hooks
	 * @param filePath
	 * @param fileText
	 */
	public updateFeature = async (filePath: string, fileText?: string) => {
		if (!this.gherkin) {
			await this.loadFeatures();
			this.currentRootPath = ctvConfig.cucumberPath;
		}
		this.gherkin.updateFeature(filePath, fileText);
	};

	private loadFeatures = async (): Promise<void> => {
		const config = await cucumberConfig.getConfig();
		this.gherkin = new GherkinManager(config.paths);
	};
}

const stepFileManager = new StepFileManager();
export default stepFileManager;
