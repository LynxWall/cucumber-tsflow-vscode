import * as vscode from 'vscode';
import CucumberConfig from './cucumber-config';
import GherkinManager, { StepInfo, IMapFeaturesResult } from '../gherkin/gherkin-manager';
import { FeatureStepMatch, ParsedFeature } from '../types';
import { TextDocument } from 'vscode';
import { normalizePath } from '../utils';

type CucumberProject = {
	name: string;
	path: string;
	gherkin: GherkinManager;
	currentStepText?: string;
	findFeatureResults?: IMapFeaturesResult;
};

export default class StepFileManager {
	private cucumberConfig: CucumberConfig;

	private projects = new Array<CucumberProject>();

	constructor() {
		this.cucumberConfig = new CucumberConfig();
	}

	/**
	 * Get all of the steps from the step file text passed in.
	 * @param fileText
	 * @returns
	 */
	public getSteps = async (document: TextDocument): Promise<StepInfo[]> => {
		const fsPath = normalizePath(document.uri.fsPath);
		const project = this.projects.find(x => fsPath.startsWith(x.path));
		if (project) {
			const stepText = document.getText();
			if (project.currentStepText !== stepText || !project.findFeatureResults) {
				project.findFeatureResults = project.gherkin.mapFeaturesFromStepFile(stepText);
				project.currentStepText = stepText;
			}
			return project.findFeatureResults.steps;
		}
		return new Array<StepInfo>();
	};

	public getParsedFeatures = async (): Promise<ParsedFeature[]> => {
		const parsedFeatures = new Array<ParsedFeature>();
		for (let idx = 0; idx < this.projects.length; idx++) {
			parsedFeatures.push(...this.projects[idx].gherkin.parsedFeatures);
		}
		return parsedFeatures;
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
		const project = this.projects.find(x => filePath.startsWith(x.path));
		if (project && project.findFeatureResults?.features) {
			return project.findFeatureResults.features.getMatchingFeaturesAndScenarios(stepText);
		}
		return new Array<FeatureStepMatch>();
	};

	/**
	 * Update a feature that's changed. Called from extensions hooks
	 * @param filePath
	 * @param fileText
	 */
	public updateFeature = async (filePath: string, fileText?: string) => {
		const project = this.projects.find(x => filePath.startsWith(x.path));
		if (project) {
			await project.gherkin.updateFeature(filePath, fileText);
		}
	};

	public loadFeatures = async (cucumberRoot: string): Promise<void> => {
		const config = await this.cucumberConfig.loadCucumberConfig(cucumberRoot);
		let project = this.projects.find(x => x.path === cucumberRoot);
		if (!project) {
			const nameIdx = cucumberRoot.lastIndexOf('/');
			const projectName = cucumberRoot.substring(nameIdx + 1);
			project = {
				name: projectName,
				path: cucumberRoot,
				gherkin: new GherkinManager(projectName, cucumberRoot)
			} as CucumberProject;
			this.projects.push(project);
		}
		await project.gherkin.loadFeatures(config.paths);
	};
}
