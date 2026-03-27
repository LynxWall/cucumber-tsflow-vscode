import type { TestItem } from 'vscode';
import type { CucumberProfile, CucumberProject, ParsedFeature, ParsedScenario, TestFeatureStep } from '../types';
import type { ScenarioLocation } from '../runtime/ctv-controller';
import { CucumberTestRunner } from './cucumber-test-runner';
import useCtvConfig from '../use-ctv-config';
import StepFileManager from './step-file-manager';
import * as vscode from 'vscode';
import { normalizePath, toKebabCase } from '../utils';
import { scanTestOutput } from './test-output-scanner';
import { sortBy, compose, toLower, prop } from 'ramda';
import { hasMatchingTags } from '@lynxwall/cucumber-tsflow/lib/runtime/utils';
import { CtvController } from '../runtime/ctv-controller';

const sortByTestLabel = sortBy<vscode.TestItem>(compose(toLower, prop('label')));

export default class CucumberTestFeatures {
	private scenarioData = new WeakMap<vscode.TestItem, ParsedScenario>();
	private testItems = new Array<TestItem>();
	private stepFileManager: StepFileManager;
	private controller: vscode.TestController;
	private cucumberTestRunner: CucumberTestRunner;
	private project: CucumberProject;

	constructor(stepFileManager: StepFileManager, controller: vscode.TestController, project: CucumberProject) {
		this.stepFileManager = stepFileManager;
		this.controller = controller;
		this.cucumberTestRunner = new CucumberTestRunner();
		this.project = project;
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
		const ctvConfig = useCtvConfig().getConfig();

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
					if (scenarioItems.some(x => x.id === testItem.id)) {
						ctvConfig.cucumberOutput.appendLine(`Duplicate scenario found: \"${testItem.label}\", Skipping.`);
					} else {
						this.scenarioData.set(testItem, scenario);
						scenarioItems.push(testItem);
					}
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
						if (scenarioItems.some(x => x.id === testItem.id)) {
							ctvConfig.cucumberOutput.appendLine(`Duplicate scenario found: \"${testItem.label}\", Skipping.`);
						} else {
							this.scenarioData.set(testItem, scenario);
							scenarioItems.push(testItem);
						}
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
		const ctvConfig = useCtvConfig().getConfig();
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
				if (scenarioItems.some(x => x.id === testItem.id)) {
					ctvConfig.cucumberOutput.appendLine(`Duplicate scenario found: \"${testItem.label}\", Skipping.`);
				} else {
					this.scenarioData.set(testItem, scenario);
					scenarioItems.push(testItem);
				}
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
						if (scenarioItems.some(x => x.id === testItem.id)) {
							ctvConfig.cucumberOutput.appendLine(`Duplicate scenario found: \"${testItem.label}\", Skipping.`);
						} else {
							this.scenarioData.set(testItem, scenario);
							scenarioItems.push(testItem);
						}
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
		cucumberProfiles: Array<CucumberProfile>,
		profileName: string,
		debug: boolean = false
	) {
		const include = new Array<TestItem>();

		// save the current file
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.isDirty) {
			await editor.document.save();
		}
		// make sure tests are loaded
		if (this.testItems.length === 0) {
			await this.loadTests();
		}

		// new command added in vsCode 1.78
		const selectedProfiles: [{ controllerId: string; label: string; kind: number }] =
			await vscode.commands.executeCommand('testing.getSelectedProfiles');

		let profile: string | undefined = undefined;
		for (let cpIdx = 0; cpIdx < cucumberProfiles.length; cpIdx++) {
			for (let spIdx = 0; spIdx < selectedProfiles.length; spIdx++) {
				if (
					selectedProfiles[spIdx].controllerId === cucumberProfiles[cpIdx].controllerId &&
					selectedProfiles[spIdx].label === cucumberProfiles[cpIdx].profileLabel
				) {
					profile = cucumberProfiles[cpIdx].profile;
					break;
				}
			}
			if (profile) {
				break;
			}
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
			await this.runTests(request, cancellationToken, profile ?? profileName, debug, true);
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

		// get the tests that are part of this run
		const testItems =
			request.include && request.include.length > 0
				? sortByTestLabel(request.include)
				: this.testItems.length > 0
					? sortByTestLabel(this.testItems)
					: [];

		if (testItems.length > 0) {
			if (debug) {
				// Debug mode: run sequentially so breakpoints work as expected
				for (const item of testItems) {
					await this.runTest(item, request, run, cancellationToken, profileName, debug);
				}
			} else {
				// Run mode: use a forked worker process (loads support code once)
				const { scenarioItems, scenarioLocations } = this.buildScenarioRun(testItems, request);
				if (scenarioItems.length > 0) {
					const ctvController = new CtvController(profileName, this.project);
					await ctvController.run(scenarioItems, run, scenarioLocations, cancellationToken);
				}
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
	 * Flatten feature-level TestItems down to individual scenario-level items,
	 * building the ScenarioLocation map the worker needs to target each test.
	 * Respects request.exclude so suppressed items are never queued.
	 */
	private buildScenarioRun(
		testItems: ReadonlyArray<vscode.TestItem>,
		request: vscode.TestRunRequest
	): { scenarioItems: vscode.TestItem[]; scenarioLocations: Map<string, ScenarioLocation> } {
		const scenarioItems: vscode.TestItem[] = [];
		const scenarioLocations = new Map<string, ScenarioLocation>();

		const addScenario = (item: vscode.TestItem) => {
			if (request.exclude?.includes(item)) return;
			const scenario = this.scenarioData.get(item);
			if (scenario && item.uri) {
				scenarioItems.push(item);
				scenarioLocations.set(item.id, {
					featurePath: item.uri.fsPath,
					lineNumber: scenario.lineNumber
				});
			}
		};

		for (const item of testItems) {
			if (request.exclude?.includes(item)) continue;
			if (item.children.size > 0) {
				// Feature-level item — collect all child scenarios
				this.getChildNodes(item.children).forEach(addScenario);
			} else {
				// Already a scenario-level item
				addScenario(item);
			}
		}

		return { scenarioItems, scenarioLocations };
	}

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
			const sortedChildren = sortByTestLabel(children);
			for (let idx = 0; idx < sortedChildren.length; idx++) {
				await this.testRunner(sortedChildren[idx], run, cancellationToken, profileName, debug);
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
