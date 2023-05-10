import { TestItem } from 'vscode';
import { CucumberTestRunner } from './cucumber-test-runner';
import StepFileManager from './step-file-manager';
import * as vscode from 'vscode';
import { ParsedFeature, ParsedScenario, TestFeatureStep } from '../types';
import { normalizePath, toKebabCase } from '../utils';
import { scanTestOutput } from './test-output-scanner';
import { sortBy, compose, toLower, prop } from 'ramda';
import { hasMatchingTags } from '@lynxwall/cucumber-tsflow/lib/cucumber/utils';

const sortByTestLabel = sortBy<vscode.TestItem>(compose(toLower, prop('label')));

export default class CucumberTestFeatures {
	private scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();
	private testItems = new Array<TestItem>();
	private stepFileManager: StepFileManager;
	private controller: vscode.TestController;
	private cucumberTestRunner: CucumberTestRunner;

	constructor(stepFileManager: StepFileManager, controller: vscode.TestController) {
		this.stepFileManager = stepFileManager;
		this.controller = controller;
		this.cucumberTestRunner = new CucumberTestRunner();
	}

	/**
	 * Load all tests from feature files
	 */
	public loadTests = async (): Promise<Array<TestItem>> => {
		if (this.testItems.length === 0) {
			if (!this.stepFileManager.hasFeatures) {
				await this.stepFileManager.loadFeatures();
			}
			const features = await this.stepFileManager.getParsedFeatures();
			this.scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();
			await Promise.all(features.map(feature => this.loadFeature(feature)));
		}
		return this.testItems;
	};

	private async loadFeature(feature: ParsedFeature) {
		const featureUri = vscode.Uri.file(normalizePath(feature.featureFile));
		const featureId = toKebabCase(feature.title);

		// Check to see if we should bypass this feature. Uses
		// Tags setting from the default profile if found
		const tagPattern = this.stepFileManager.projectTagPattern;
		if (tagPattern && !hasMatchingTags(tagPattern, feature.tags)) {
			return;
		}
		// feature is valid for this profile ... see if we already processed it
		if (this.testItems.find(x => x.id === featureId) === undefined) {
			const item = this.controller.createTestItem(featureId, feature.title, featureUri);
			const scenarioItems = new Array<TestItem>();
			if (feature.scenarios.length > 0) {
				for (let sIdx = 0; sIdx < feature.scenarios.length; sIdx++) {
					const scenario = feature.scenarios[sIdx];
					const testItem = this.controller.createTestItem(toKebabCase(scenario.title), scenario.title, featureUri);
					this.scenarioData.set(testItem, scenario);
					scenarioItems.push(testItem);
				}
			}
			if (feature.scenarioOutlines.length > 0) {
				for (let soIdx = 0; soIdx < feature.scenarioOutlines.length; soIdx++) {
					const scenarioOutline = feature.scenarioOutlines[soIdx];
					if (scenarioOutline.exampleScenarios.length > 0) {
						const scenario = scenarioOutline.exampleScenarios[0];
						scenario.lineNumber = scenarioOutline.lineNumber;
						const testItem = this.controller.createTestItem(
							toKebabCase(scenarioOutline.title),
							scenarioOutline.title,
							featureUri
						);
						this.scenarioData.set(testItem, scenario);
						scenarioItems.push(testItem);
					}
				}
			}
			item.children.replace(scenarioItems);

			this.testItems.push(item);
		}
	}

	/**
	 * Called to update feature test data when a feature
	 * file is modified or added.
	 * @param uri
	 */
	public async updateTests(uri: vscode.Uri): Promise<void> {
		const parsedFeature = await this.stepFileManager.getParsedFeature(uri);
		if (parsedFeature && (parsedFeature.scenarios.length > 0 || parsedFeature.scenarioOutlines.length > 0)) {
			const featureId = toKebabCase(parsedFeature.title);
			const featureUri = vscode.Uri.file(normalizePath(parsedFeature.featureFile));
			let testFeature = this.testItems.find(x => x.id === featureId);
			if (!testFeature) {
				testFeature = this.controller.createTestItem(featureId, parsedFeature.title, featureUri);
				this.testItems.push(testFeature);
			}
			const scenarioItems = new Array<TestItem>();
			for (let sIdx = 0; sIdx < parsedFeature.scenarios.length; sIdx++) {
				const scenario = parsedFeature.scenarios[sIdx];
				const testItem = this.controller.createTestItem(toKebabCase(scenario.title), scenario.title, featureUri);
				this.scenarioData.set(testItem, scenario);
				scenarioItems.push(testItem);
			}
			if (parsedFeature.scenarioOutlines.length > 0) {
				for (let soIdx = 0; soIdx < parsedFeature.scenarioOutlines.length; soIdx++) {
					const scenarioOutline = parsedFeature.scenarioOutlines[soIdx];
					if (scenarioOutline.exampleScenarios.length > 0) {
						const scenario = scenarioOutline.exampleScenarios[0];
						scenario.lineNumber = scenarioOutline.lineNumber;
						const testItem = this.controller.createTestItem(
							toKebabCase(scenarioOutline.title),
							scenarioOutline.title,
							featureUri
						);
						this.scenarioData.set(testItem, scenario);
						scenarioItems.push(testItem);
					}
				}
			}
			testFeature.children.replace(scenarioItems);
		}
	}

	/**
	 * Called from code lense provider when clicking
	 * on a Run command
	 * @param testFeatureSteps
	 */
	public async runCodeLenseTests(
		testFeatureSteps: Array<TestFeatureStep>,
		cancellationToken: vscode.CancellationToken,
		profileName: string,
		debug: boolean = false
	) {
		const include = new Array<TestItem>();

		// save the current file
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			await editor.document.save();
		}
		// now we can execute
		await Promise.all(
			testFeatureSteps.map(async testFeatureStep => {
				const testFeature = await this.findFeatureTestItem(testFeatureStep.featureFile);
				if (testFeature) {
					// get the requested items
					if (testFeatureStep.lineNumber) {
						const children = this.getChildNodes(testFeature.children);
						for (let idx = 0; idx < children.length; idx++) {
							const child = children[idx];
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
			})
		);
		if (include.length > 0) {
			const request = new vscode.TestRunRequest(include);
			await this.runTests(request, cancellationToken, profileName, debug, true);
		}
	}

	/**
	 * Called from the test explorer to run tests
	 * @param request
	 */
	public async runTests(
		request: vscode.TestRunRequest,
		cancellationToken: vscode.CancellationToken,
		profileName: string,
		debug: boolean = false,
		codeLense: boolean = false
	) {
		const run = this.controller.createTestRun(request);

		// show the test output terminal and clear it from previous test runs
		await vscode.commands.executeCommand('testing.showMostRecentOutput');
		await vscode.commands.executeCommand('workbench.action.terminal.clear');

		if (request.include) {
			const sortedItems = sortByTestLabel(request.include);
			if (!debug && codeLense) {
				await Promise.all(
					sortedItems.map(testItem => this.runTest(testItem, request, run, cancellationToken, profileName, debug))
				);
			} else {
				const itemsLen = sortedItems.length;
				for (let idx = 0; idx < itemsLen; idx++) {
					await this.runTest(sortedItems[idx], request, run, cancellationToken, profileName, debug);
				}
			}
		} else if (this.testItems) {
			const sortedItems = sortByTestLabel(this.testItems);
			const itemsLen = sortedItems.length;
			for (let idx = 0; idx < itemsLen; idx++) {
				await this.runTest(sortedItems[idx], request, run, cancellationToken, profileName, debug);
			}
		}
		run.end();
		// switch back to testing output and make sure the test explorer is showing
		// if executed from code lense
		await vscode.commands.executeCommand('testing.showMostRecentOutput');
		if (!codeLense) {
			await vscode.commands.executeCommand('workbench.view.extension.test');
		}
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
		let testFeature: TestItem | undefined = undefined;
		const featureUri = vscode.Uri.file(normalizePath(filePath));
		const parsedFeature = await this.stepFileManager.getParsedFeature(featureUri);
		if (parsedFeature && (parsedFeature.scenarios.length > 0 || parsedFeature.scenarioOutlines.length > 0)) {
			const featureId = toKebabCase(parsedFeature.title);
			testFeature = this.testItems.find(x => x.id === featureId);
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
		cancellationToken: vscode.CancellationToken,
		profileName: string,
		debug: boolean
	) {
		// Users can hide or filter out tests from their run. If the request says
		// they've done that for this node, then don't run it.
		if (request.exclude?.includes(testItem)) {
			return;
		}
		await this.testRunner(testItem, run, cancellationToken, profileName, debug);
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
		cancellationToken: vscode.CancellationToken,
		profileName: string,
		debug: boolean
	) {
		if (testItem.children && testItem.children.size > 0) {
			const children = this.getChildNodes(testItem.children);
			const hasScenario = children.length > 0 && this.scenarioData.get(children[0]) !== undefined;
			const sortedChildren = sortByTestLabel(children);
			if (debug || hasScenario === false) {
				for (let idx = 0; idx < sortedChildren.length; idx++) {
					await this.testRunner(sortedChildren[idx], run, cancellationToken, profileName, debug);
				}
			} else {
				await Promise.all(
					sortedChildren.map(childNode => this.testRunner(childNode, run, cancellationToken, profileName, debug))
				);
			}
		} else {
			const scenario = this.scenarioData.get(testItem);
			if (scenario && !cancellationToken.isCancellationRequested) {
				run.started(testItem);
				await scanTestOutput(
					testItem,
					run,
					debug
						? await this.cucumberTestRunner.debug(testItem.uri!.path, scenario.lineNumber, profileName, scenario)
						: await this.cucumberTestRunner.run(testItem.uri!.path, scenario.lineNumber, profileName, scenario),
					cancellationToken
				);
			}
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
}
