import * as vscode from 'vscode';
import { StepInfo } from '../gherkin/gherkin-manager';
import { CucumberProject, FeatureStepMatch, ParsedFeature } from '../types';
import { TextDocument } from 'vscode';

const getDefaultProfile = (profileNames: string[]): string => {
	if (profileNames.indexOf('default') >= 0) {
		return 'default';
	}
	return profileNames[0];
};

export default class StepFileManager {
	private cucumberProject: CucumberProject;

	constructor(project: CucumberProject) {
		this.cucumberProject = project;
	}

	public get hasFeatures(): boolean {
		return this.cucumberProject.gherkin.parsedFeatures.length > 0;
	}

	public get projectName(): string {
		return this.cucumberProject.name;
	}

	public get projectTagPattern(): string | undefined {
		const profileNames = Object.getOwnPropertyNames(this.cucumberProject.config);
		const defaultProfile = getDefaultProfile(profileNames);

		const profile = this.cucumberProject.config[defaultProfile];
		return profile.tags;
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
		return this.cucumberProject.gherkin.parsedFeatures.find(
			(x: { featureFile: string }) => x.featureFile === uri.fsPath
		);
	};

	/**
	 * Get the associated features and scenarios from the step text passed in
	 * @param stepText
	 * @returns
	 */
	public getFeaturesAndScenarios = (stepText: string): Array<FeatureStepMatch> => {
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
	};
}
