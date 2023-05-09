import * as vscode from 'vscode';
import CucumberConfig from './cucumber-config';
import GherkinManager, { StepInfo, IMapFeaturesResult } from '../gherkin/gherkin-manager';
import { CucumberProject, FeatureStepMatch, ParsedFeature } from '../types';
import { TextDocument } from 'vscode';
import { normalizePath } from '../utils';
import { project } from 'types-ramda';

type CucumberProjectLocal = {
	name: string;
	path: string;
	gherkin: GherkinManager;
	currentStepText?: string;
	findFeatureResults?: IMapFeaturesResult;
};

export default class StepFileManager {
	private cucumberConfig: CucumberConfig;
	private cucumberProject: CucumberProject;

	private projects = new Array<CucumberProjectLocal>();

	constructor(project: CucumberProject) {
		this.cucumberConfig = new CucumberConfig();
		this.cucumberProject = project;
	}

	public get hasFeatures(): boolean {
		return this.cucumberProject.gherkin.parsedFeatures.length > 0;
	}

	/**
	 * Get all of the steps from the step file text passed in.
	 * @param fileText
	 * @returns
	 */
	public getSteps = async (document: TextDocument): Promise<StepInfo[]> => {
		const stepText = document.getText();
		if (this.cucumberProject.currentStepText !== stepText || !this.cucumberProject.findFeatureResults) {
			this.cucumberProject.findFeatureResults = this.cucumberProject.gherkin.mapFeaturesFromStepFile(stepText);
			this.cucumberProject.currentStepText = stepText;
		}
		return this.cucumberProject.findFeatureResults.steps;
	};

	public getParsedFeatures = async (): Promise<ParsedFeature[]> => {
		return this.cucumberProject.gherkin.parsedFeatures;
	};

	public getParsedFeature = async (uri: vscode.Uri): Promise<ParsedFeature | undefined> => {
		return (await this.getParsedFeatures()).find((x: { featureFile: string }) => x.featureFile === uri.fsPath);
	};

	/**
	 * Get the associated features and scenarios from the step text passed in
	 * @param stepText
	 * @returns
	 */
	public getFeaturesAndScenarios = (filePath: string, stepText: string): Array<FeatureStepMatch> => {
		if (this.cucumberProject.findFeatureResults?.features) {
			return this.cucumberProject.findFeatureResults.features.getMatchingFeaturesAndScenarios(stepText);
		}
		return new Array<FeatureStepMatch>();
	};

	/**
	 * Update a feature that's changed. Called from extensions hooks
	 * @param filePath
	 * @param fileText
	 */
	public updateFeature = async (filePath: string, fileText?: string) => {
		await this.cucumberProject.gherkin.updateFeature(filePath, fileText);
	};

	public loadFeatures = async (): Promise<void> => {
		let profile = this.cucumberProject.config.default;
		if (!profile) {
			profile = Object.values(this.cucumberProject.config)[0];
		}
		await this.cucumberProject.gherkin.loadFeatures(profile.paths);

		// let project = this.projects.find(x => x.path === cucumberRoot);
		// if (!project) {
		// 	const nameIdx = cucumberRoot.lastIndexOf('/');
		// 	const projectName = cucumberRoot.substring(nameIdx + 1);
		// 	project = {
		// 		name: projectName,
		// 		path: cucumberRoot,
		// 		gherkin: new GherkinManager(projectName, cucumberRoot)
		// 	} as CucumberProjectLocal;
		// 	const config = await this.cucumberConfig.loadCucumberConfig(cucumberRoot);
		// 	await project.gherkin.loadFeatures(config.paths);
		// 	this.projects.push(project);
		// }
	};
}
