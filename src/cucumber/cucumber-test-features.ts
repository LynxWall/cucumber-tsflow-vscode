import { TestItem } from 'vscode';
import { CucumberTestRunner } from './cucumber-test-runner';
import StepFileManager from './step-file-manager';
import * as vscode from 'vscode';
import { ParsedFeature, ParsedScenario, TestFeatureStep } from '../types';
import { normalizePath, toKebabCase } from '../utils';
import { scanTestOutput } from './test-output-scanner';
import { sortBy, compose, toLower, prop } from 'ramda';
import CtvConfig from '../ctv-config';
import useCtvConfig from '../use-ctv-config';

const sortByTestLabel = sortBy<vscode.TestItem>(compose(toLower, prop('label')));

type ProjectFeature = {
	projectItem: TestItem;
	featureTestItems: Array<TestItem>;
};

export default class CucumberTestFeatures {
	private scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();
	private projectFeatures = new Array<ProjectFeature>();
	private testItems = new Array<TestItem>();
	private stepFileManager: StepFileManager;
	private controller: vscode.TestController;
	private cucumberTestRunner: CucumberTestRunner;
	private ctvConfig: CtvConfig;

	constructor(stepFileManager: StepFileManager, controller: vscode.TestController) {
		this.ctvConfig = useCtvConfig().getConfig();
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

			if (this.projectFeatures.length > 1) {
				for (let idx = 0; idx < this.projectFeatures.length; idx++) {
					const projTestItem = this.projectFeatures[idx];
					const sortedFeatures = sortByTestLabel(projTestItem.featureTestItems);
					projTestItem.projectItem.children.replace(sortedFeatures);
					this.testItems.push(projTestItem.projectItem);
				}
			} else if (this.projectFeatures.length === 1) {
				const sortedFeatures = sortByTestLabel(this.projectFeatures[0].featureTestItems);
				this.testItems.push(...sortedFeatures);
			}
		}
		return this.testItems;
	};

	private async loadFeature(feature: ParsedFeature) {
		const projectId = toKebabCase(feature.options.projectName);
		let projectFeature = this.projectFeatures.find(x => x.projectItem.id === projectId);
		if (!projectFeature) {
			projectFeature = {
				projectItem: this.controller.createTestItem(projectId, feature.options.projectName, undefined),
				featureTestItems: new Array<TestItem>()
			} as ProjectFeature;
			this.projectFeatures.push(projectFeature);
		}
		const featureUri = vscode.Uri.file(normalizePath(feature.featureFile));
		const featureId = toKebabCase(feature.title);

		if (projectFeature.featureTestItems.find(x => x.id === featureId) === undefined) {
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

			projectFeature.featureTestItems?.push(item);
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
			let projectFeature = await this.getProjectFeature(parsedFeature);
			if (projectFeature) {
				const featureId = toKebabCase(parsedFeature.title);
				const featureUri = vscode.Uri.file(normalizePath(parsedFeature.featureFile));
				let testFeature = projectFeature.featureTestItems.find(x => x.id === featureId);
				if (!testFeature) {
					testFeature = this.controller.createTestItem(featureId, parsedFeature.title, featureUri);
					projectFeature.featureTestItems.push(testFeature);
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
	}

	/**
	 * Called from code lense provider when clicking
	 * on a Run command
	 * @param testFeatureSteps
	 */
	public async runCodeLenseTests(
		testFeatureSteps: Array<TestFeatureStep>,
		cancellationToken: vscode.CancellationToken,
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
			await this.runTests(request, cancellationToken, debug, true);
		}
	}

	/**
	 * Called from the test explorer to run tests
	 * @param request
	 */
	public async runTests(
		request: vscode.TestRunRequest,
		cancellationToken: vscode.CancellationToken,
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
				await Promise.all(sortedItems.map(testItem => this.runTest(testItem, request, run, cancellationToken, debug)));
			} else {
				const itemsLen = sortedItems.length;
				for (let idx = 0; idx < itemsLen; idx++) {
					await this.runTest(sortedItems[idx], request, run, cancellationToken, debug);
				}
			}
		} else if (this.testItems) {
			const sortedItems = sortByTestLabel(this.testItems);
			const itemsLen = sortedItems.length;
			for (let idx = 0; idx < itemsLen; idx++) {
				await this.runTest(sortedItems[idx], request, run, cancellationToken, debug);
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
			let projectFeature = await this.getProjectFeature(parsedFeature);
			if (projectFeature) {
				const featureId = toKebabCase(parsedFeature.title);
				testFeature = projectFeature.featureTestItems.find(x => x.id === featureId);
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
		cancellationToken: vscode.CancellationToken,
		debug: boolean
	) {
		// Users can hide or filter out tests from their run. If the request says
		// they've done that for this node, then don't run it.
		if (request.exclude?.includes(testItem)) {
			return;
		}
		await this.testRunner(testItem, run, cancellationToken, debug);
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
		debug: boolean
	) {
		if (testItem.children && testItem.children.size > 0) {
			const children = this.getChildNodes(testItem.children);
			const hasScenario = children.length > 0 && this.scenarioData.get(children[0]) !== undefined;
			const sortedChildren = sortByTestLabel(children);
			if (debug || hasScenario === false) {
				for (let idx = 0; idx < sortedChildren.length; idx++) {
					await this.testRunner(sortedChildren[idx], run, cancellationToken, debug);
				}
			} else {
				await Promise.all(sortedChildren.map(childNode => this.testRunner(childNode, run, cancellationToken, debug)));
			}
		} else {
			const scenario = this.scenarioData.get(testItem);
			if (scenario && !cancellationToken.isCancellationRequested) {
				run.started(testItem);
				await scanTestOutput(
					testItem,
					run,
					debug
						? await this.cucumberTestRunner.debug(testItem.uri!.path, scenario.lineNumber, scenario.cwd, scenario.args)
						: await this.cucumberTestRunner.run(testItem.uri!.path, scenario.lineNumber, scenario.cwd, scenario.args),
					cancellationToken
				);
			}
		}
	}

	/**
	 * Private helper used to get a projectFeature.
	 * Will load tests if not already loaded
	 * @param feature
	 */
	private async getProjectFeature(feature: ParsedFeature) {
		if (this.projectFeatures.length === 0) {
			await this.loadTests();
		}
		const projectId = toKebabCase(feature.options.projectName);
		return this.projectFeatures.find(x => x.projectItem.id === projectId);
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
