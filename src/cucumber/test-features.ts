import { TestItem } from 'vscode';
import cucumberRunner from './cucumber-runner';
import StepFileManager from './step-file-manager';
import * as vscode from 'vscode';
import { ParsedScenario } from '../types';

type CallbackStatus = 'start' | 'end' | 'passed' | 'pending' | 'failed';
type TestCallback = (status: CallbackStatus) => void;

export default class TestFeatures {
	scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();
	featureTestItems?: Array<TestItem>;
	stepFileManager: StepFileManager;

	constructor(stepFileManager: StepFileManager) {
		this.stepFileManager = stepFileManager;
	}

	public loadTests = async (controller: vscode.TestController): Promise<TestItem[]> => {
		const features = await this.stepFileManager.getParsedFeatures();
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
		// Users can hide or filter out tests from their run. If the request says
		// they've done that for this node, then don't run it.
		if (request.exclude?.includes(vnode)) {
			return;
		}
		await this.testRunner(vnode, run);
		run.end();
	};

	testRunner = async (vnode: vscode.TestItem, run: vscode.TestRun) => {
		if (vnode.children && vnode.children.size > 0) {
			const children = this.getChildNodes(vnode.children);
			for (const childNode of children) {
				await this.testRunner(childNode, run);
			}
		} else {
			const scenario = this.scenarioData.get(vnode);
			if (scenario) {
				run.started(vnode);
				await cucumberRunner.runCucumber(vnode.uri!.path, scenario.lineNumber, (status: CallbackStatus) => {
					this.setRunStatus(status, vnode, run);
				});
			}
		}
	};

	getChildNodes = (collection: vscode.TestItemCollection): Array<TestItem> => {
		const items = new Array<TestItem>();
		collection.forEach(item => {
			items.push(item);
		});
		return items;
	};

	setRunStatus = (status: CallbackStatus, vnode: vscode.TestItem, run: vscode.TestRun) => {
		switch (status) {
			case 'passed':
				run.passed(vnode);
				break;
			case 'pending':
				run.skipped(vnode);
				break;
			case 'failed':
				run.failed(vnode, new vscode.TestMessage('Fail'));
				break;
		}
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
export { CallbackStatus, TestCallback };
