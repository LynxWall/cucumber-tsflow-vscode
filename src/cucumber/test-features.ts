import { TestItem } from 'vscode';
import cucumberRunner from './cucumber-runner';
import stepFileManager from './step-file-manager';
import * as vscode from 'vscode';
import { ParsedScenario } from '../types';

export class TestFeatures {
	scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();
	featureTestItems?: Array<TestItem>;

	public loadTests = async (controller: vscode.TestController): Promise<TestItem[]> => {
		const features = await stepFileManager.getParsedFeatures();
		this.featureTestItems = new Array<TestItem>();
		this.scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();

		features.forEach(feature => {
			const featureUri = vscode.Uri.parse(feature.featureFile);
			const item = controller.createTestItem(this.toKebabCase(feature.title), feature.title, featureUri);
			if (feature.scenarios.length > 0) {
				const scenarioItems = new Array<TestItem>();
				feature.scenarios.forEach(scenario => {
					const testItem = controller.createTestItem(this.toKebabCase(scenario.title), scenario.title, featureUri);
					this.scenarioData.set(testItem, scenario);
					scenarioItems.push(testItem);
				});
				item.children.replace(scenarioItems);
			}
			this.featureTestItems?.push(item);
		});
		return this.featureTestItems;
	};

	runTests = async (controller: vscode.TestController, request: vscode.TestRunRequest) => {
		const run = controller.createTestRun(request);

		if (request.include) {
			await Promise.all(request.include.map(t => this.runTest(t, request, run)));
		} else if (this.featureTestItems) {
			await Promise.all(this.featureTestItems.map(testItem => this.runTest(testItem, request, run)));
		}
		run.end();
	};

	runTest = async (vnode: vscode.TestItem, request: vscode.TestRunRequest, run: vscode.TestRun) => {
		const scenario = this.scenarioData.get(vnode);
		if (scenario) {
			await cucumberRunner.runCucumber(vnode.uri!.path, scenario.lineNumber);
		} else {
			await cucumberRunner.runCucumber(vnode.uri!.path);
		}
		const results = scenario?.scenarioContext;
	};

	toKebabCase = (str: string): string => {
		let result = str
			.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
			?.map(x => x.toLowerCase())
			.join('-');

		if (!result) {
			result = str;
		}
		return result;
	};
}
