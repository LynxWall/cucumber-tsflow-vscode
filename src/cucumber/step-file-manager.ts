import * as vscode from 'vscode';
import CucumberConfig from './cucumber-config';
import GherkinManager, { StepInfo, IMapFeaturesResult } from '../gherkin/gherkin-manager';
import useCtvConfig from '../use-ctv-config';
import { FeatureStepMatch, ParsedFeature } from '../types';
import CtvConfig from '../ctv-config';

export default class StepFileManager {
	private gherkin: GherkinManager;
	private currentRootPath?: string;
	private currentFileText: string = '';
	private findFeatureResults?: IMapFeaturesResult;
	private ctvConfig: CtvConfig;
	private cucumberConfig: CucumberConfig;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
		this.cucumberConfig = new CucumberConfig();
		this.gherkin = new GherkinManager();
	}

	/**
	 * Get all of the steps from the step file text passed in.
	 * @param fileText
	 * @returns
	 */
	public getSteps = async (fileText: string): Promise<StepInfo[]> => {
		if (this.ctvConfig.cucumberPath !== this.currentRootPath) {
			await this.loadFeatures();
		}
		if (fileText !== this.currentFileText || !this.findFeatureResults) {
			this.findFeatureResults = this.gherkin.mapFeaturesFromStepFile(fileText);
			this.currentFileText = fileText;
		}
		return this.findFeatureResults.steps;
	};

	public getParsedFeatures = async (): Promise<ParsedFeature[]> => {
		if (this.ctvConfig.cucumberPath !== this.currentRootPath) {
			await this.loadFeatures();
		}
		return this.gherkin.parsedFeatures;
	};

	public getParsedFeature = async (uri: vscode.Uri): Promise<ParsedFeature | undefined> => {
		let parsedFeature = this.gherkin.parsedFeatures.find((x: { featureFile: string }) => x.featureFile === uri.fsPath);
		if (!parsedFeature) {
			// might be a new feature file... reload the features
			await this.loadFeatures();
			parsedFeature = this.gherkin.parsedFeatures.find((x: { featureFile: string }) => x.featureFile === uri.fsPath);
		}
		return parsedFeature;
	};

	/**
	 * Get the associated features and scenarios from the step text passed in
	 * @param stepText
	 * @returns
	 */
	public getFeaturesAndScenarios = (stepText: string): Array<FeatureStepMatch> => {
		if (this.findFeatureResults?.features) {
			return this.findFeatureResults.features.getMatchingFeaturesAndScenarios(stepText);
		}
		return new Array<FeatureStepMatch>();
	};

	/**
	 * Update a feature that's changed. Called from extensions hooks
	 * @param filePath
	 * @param fileText
	 */
	public updateFeature = async (filePath: string, fileText?: string) => {
		await this.gherkin.updateFeature(filePath, fileText);
	};

	public loadFeatures = async (): Promise<void> => {
		const config = await this.cucumberConfig.getConfig();
		await this.gherkin.loadFeatures(config.paths);
		this.currentRootPath = this.ctvConfig.cucumberPath;
	};
}
