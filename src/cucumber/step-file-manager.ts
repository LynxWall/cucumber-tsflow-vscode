import * as vscode from 'vscode';
import CucumberConfig from './cucumber-config';
import GherkinManager, { StepInfo, IMapFeaturesResult } from '../gherkin/gherkin-manager';
import useCtvConfig from '../use-ctv-config';
import { FeatureFromStepFile, FeatureStepMatch, ParsedFeature, ScenarioFromStepFile } from '../types';
import CtvConfig from '../ctv-config';

export default class StepFileManager {
	private gherkin!: GherkinManager;
	private currentRootPath?: string;
	private currentFileText: string = '';
	private findFeatureResults?: IMapFeaturesResult;
	private ctvConfig: CtvConfig;
	private cucumberConfig: CucumberConfig;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
		this.cucumberConfig = new CucumberConfig();
	}

	/**
	 * Get all of the steps from the step file text passed in.
	 * @param fileText
	 * @returns
	 */
	public getSteps = async (fileText: string): Promise<StepInfo[]> => {
		if (!this.gherkin || this.ctvConfig.cucumberPath !== this.currentRootPath) {
			await this.loadFeatures();
			this.currentRootPath = this.ctvConfig.cucumberPath;
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

	public getParsedFeatures = async (): Promise<ParsedFeature[]> => {
		if (!this.gherkin || this.ctvConfig.cucumberPath !== this.currentRootPath) {
			await this.loadFeatures();
			this.currentRootPath = this.ctvConfig.cucumberPath;
		}
		return this.gherkin.parsedFeatures;
	};

	public getParsedFeature = async (uri: vscode.Uri): Promise<ParsedFeature | undefined> => {
		if (!this.gherkin || this.gherkin.parsedFeatures.length === 0) {
			await this.getParsedFeatures();
		}
		let parsedFeature = this.gherkin.parsedFeatures.find(x => x.featureFile === uri.fsPath);
		if (!parsedFeature) {
			// might be a new feature file... reload the features
			await this.loadFeatures();
			parsedFeature = this.gherkin.parsedFeatures.find(x => x.featureFile === uri.fsPath);
		}
		return parsedFeature;
	};

	/**
	 * Gets the main feature from the step file
	 */
	public getFeatures = (stepText: string): Array<FeatureStepMatch> => {
		if (this.findFeatureResults?.features) {
			return this.findFeatureResults?.features.getMatchingFeatures(stepText);
		}
		return new Array<FeatureStepMatch>();
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
		if (!this.gherkin) {
			await this.loadFeatures();
			this.currentRootPath = this.ctvConfig.cucumberPath;
		}
		this.gherkin.updateFeature(filePath, fileText);
	};

	private loadFeatures = async (): Promise<void> => {
		const config = await this.cucumberConfig.getConfig();
		this.gherkin = new GherkinManager(config.paths);
	};
}
