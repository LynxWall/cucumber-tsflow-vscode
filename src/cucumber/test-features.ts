import { TestItem } from 'vscode';
import { CucumberTestRunner } from './cucumber-test-runner';
import StepFileManager from './step-file-manager';
import * as vscode from 'vscode';
import { ParsedScenario, TestFeatureStep } from '../types';
import { normalizePath } from '../utils';
import { scanTestOutput } from './test-output-scanner';
import useCtvConfig from '../use-ctv-config';
import CtvConfig from '../ctv-config';

type CallbackStatus = 'start' | 'end' | 'passed' | 'pending' | 'failed';
type TestCallback = (status: CallbackStatus) => void;

export default class TestFeatures {
	scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();
	featureTestItems?: Array<TestItem>;
	stepFileManager: StepFileManager;
	runProfile: vscode.TestRunProfile;
	controller: vscode.TestController;
	cucumberTestRunner: CucumberTestRunner;
	private ctvConfig: CtvConfig;

	constructor(stepFileManager: StepFileManager, runProfile: vscode.TestRunProfile, controller: vscode.TestController) {
		this.stepFileManager = stepFileManager;
		this.runProfile = runProfile;
		this.controller = controller;
		this.cucumberTestRunner = new CucumberTestRunner();
		this.ctvConfig = useCtvConfig().getConfig();
	}

	/**
	 * Load all tests from feature files
	 */
	public loadTests = async (): Promise<Array<TestItem>> => {
		const features = await this.stepFileManager.getParsedFeatures();
		this.featureTestItems = new Array<TestItem>();
		this.scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();

		for (const feature of features) {
			const featureUri = vscode.Uri.file(normalizePath(feature.featureFile));
			const item = this.controller.createTestItem(this.toKebabCase(feature.title), feature.title, featureUri);
			if (feature.scenarios.length > 0) {
				const scenarioItems = new Array<TestItem>();
				for (const scenario of feature.scenarios) {
					const testItem = this.controller.createTestItem(this.toKebabCase(scenario.title), scenario.title, featureUri);
					this.scenarioData.set(testItem, scenario);
					scenarioItems.push(testItem);
				}
				item.children.replace(scenarioItems);
			}
			this.featureTestItems?.push(item);
		}
		return this.featureTestItems;
	};

	/**
	 * Called to update feature test data when a feature
	 * file is modified or added.
	 * @param uri
	 */
	public async updateTests(uri: vscode.Uri): Promise<void> {
		// no need to worry about updates if test items haven't been loaded
		if (this.featureTestItems) {
			const parsedFeature = await this.stepFileManager.getParsedFeature(uri);
			if (parsedFeature && parsedFeature.scenarios.length > 0) {
				const featureId = this.toKebabCase(parsedFeature.title);
				const featureUri = vscode.Uri.file(normalizePath(parsedFeature.featureFile));
				let testFeature = this.featureTestItems.find(x => x.id === featureId);
				if (!testFeature) {
					testFeature = this.controller.createTestItem(featureId, parsedFeature.title, featureUri);
					this.featureTestItems.push(testFeature);
				}
				const scenarioItems = new Array<TestItem>();
				for (const scenario of parsedFeature.scenarios) {
					const testItem = this.controller.createTestItem(this.toKebabCase(scenario.title), scenario.title, featureUri);
					this.scenarioData.set(testItem, scenario);
					scenarioItems.push(testItem);
				}
				testFeature.children.replace(scenarioItems);
			}
		}
	}

	/**
	 * Called from code lense provider when clicking
	 * on a Run command
	 * @param testFeatureSteps
	 */
	public async runCodeLenseTests(
		testFeatureSteps: Array<TestFeatureStep>,
		cancellationToken: vscode.CancellationToken
	) {
		const include = new Array<TestItem>();
		for (const testFeatureStep of testFeatureSteps) {
			const testFeature = await this.findFeatureTestItem(testFeatureStep.featureFile);
			if (testFeature) {
				// get the requested items
				if (testFeatureStep.lineNumber) {
					const children = this.getChildNodes(testFeature.children);
					for (const child of children) {
						const scenario = this.scenarioData.get(child);
						if (scenario?.lineNumber === testFeatureStep.lineNumber) {
							include.push(child);
							break;
						}
					}
				} else {
					include.push(testFeature);
				}
			}
		}
		if (include.length > 0) {
			const request = new vscode.TestRunRequest(include);
			await this.runTests(request, cancellationToken);
		}
	}

	/**
	 * Called from the test explorer to run tests
	 * @param request
	 */
	public async runTests(request: vscode.TestRunRequest, cancellationToken: vscode.CancellationToken) {
		const run = this.controller.createTestRun(request);

		// show the test output terminal and clear it from previous test runs
		await vscode.commands.executeCommand('testing.showMostRecentOutput');
		await vscode.commands.executeCommand('workbench.action.terminal.clear');

		if (request.include) {
			await Promise.all(request.include.map(testItem => this.runTest(testItem, request, run, cancellationToken)));
		} else if (this.featureTestItems) {
			await Promise.all(this.featureTestItems.map(testItem => this.runTest(testItem, request, run, cancellationToken)));
		}
		run.end();
	}

	/**
	 *
	 * Implementation functions
	 *
	 */

	/**
	 * Find a feature TestItem that matches the filePath passed in
	 * @param filePath
	 */
	private async findFeatureTestItem(filePath: string): Promise<TestItem | undefined> {
		// no need to worry about updates if test items haven't been loaded
		let testFeature: TestItem | undefined = undefined;
		if (this.featureTestItems) {
			const featureUri = vscode.Uri.file(normalizePath(filePath));
			const parsedFeature = await this.stepFileManager.getParsedFeature(featureUri);
			if (parsedFeature && parsedFeature.scenarios.length > 0) {
				const featureId = this.toKebabCase(parsedFeature.title);
				testFeature = this.featureTestItems.find(x => x.id === featureId);
			}
		}
		return testFeature;
	}

	/**
	 * Run a test on the testItem passed in. This is an entry function that
	 * calls the recursive testRunner below.
	 * @param testItem
	 * @param request
	 * @param run
	 */
	private async runTest(
		testItem: vscode.TestItem,
		request: vscode.TestRunRequest,
		run: vscode.TestRun,
		cancellationToken: vscode.CancellationToken
	) {
		// Users can hide or filter out tests from their run. If the request says
		// they've done that for this node, then don't run it.
		if (request.exclude?.includes(testItem)) {
			return;
		}
		await this.testRunner(testItem, run, cancellationToken);
	}

	/**
	 * Recursive function that runs a testItem and all
	 * children under that testItem, if any.
	 * @param testItem
	 * @param run
	 */
	private async testRunner(
		testItem: vscode.TestItem,
		run: vscode.TestRun,
		cancellationToken: vscode.CancellationToken
	) {
		if (testItem.children && testItem.children.size > 0) {
			const children = this.getChildNodes(testItem.children);
			await Promise.all(children.map(childNode => this.testRunner(childNode, run, cancellationToken)));
		} else {
			const scenario = this.scenarioData.get(testItem);
			if (scenario) {
				run.started(testItem);
				await scanTestOutput(
					testItem,
					run,
					await this.cucumberTestRunner.run(testItem.uri!.path, scenario.lineNumber),
					cancellationToken
				);

				// await cucumberRunner.runCucumber(testItem.uri!.path, scenario.lineNumber, (status: CallbackStatus) => {
				// 	this.setRunStatus(status, testItem, run);
				// });
			}
		}
	}

	/**
	 * Helper used to set the run status of a test run
	 * @param status
	 * @param testItem
	 * @param run
	 */
	private setRunStatus(status: CallbackStatus, testItem: vscode.TestItem, run: vscode.TestRun) {
		switch (status) {
			case 'passed':
				run.passed(testItem);
				break;
			case 'pending':
				run.skipped(testItem);
				break;
			case 'failed':
				run.failed(testItem, new vscode.TestMessage(`${testItem.label}: Failed!`));
				break;
		}
	}

	/**
	 * private helper used to get child nodes from
	 * a testItem Collection.
	 * @param collection
	 */
	private getChildNodes(collection: vscode.TestItemCollection): Array<TestItem> {
		const items = new Array<TestItem>();
		collection.forEach(item => {
			items.push(item);
		});
		return items;
	}

	/**
	 * Helper used to convert Title text into kebab id
	 * @param str
	 */
	private toKebabCase(str: string): string {
		let result = str
			.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
			?.map(x => x.toLowerCase())
			.join('-');

		if (!result) {
			result = str;
		}
		return result;
	}
}
export { CallbackStatus, TestCallback };
