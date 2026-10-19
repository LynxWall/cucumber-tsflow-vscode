import * as path from 'path';
import { TestItem } from 'vscode';
import { CucumberTestRunner } from './cucumber-test-runner';
import StepFileManager from './step-file-manager';
import useCtvConfig from '../use-ctv-config';
import * as vscode from 'vscode';
import { CucumberProfile, ParsedFeature, ParsedScenario, ParsedScenarioOutline, TestFeatureStep } from '../types';
import { normalizePath, toKebabCase } from '../utils';
import { RequestedScenario, scanTestRun, scenarioKey } from './test-output-scanner';
import { hasMatchingTags } from '@lynxwall/cucumber-tsflow/lib/runtime/utils';

// One cucumber-tsflow process per run. When the feature paths would not fit on a
// Windows command line (8191 characters, shared with node, the bin and the options)
// the run is split into several processes.
const maxPathArgsLength = 6000;

type RunUnit = { pathArg: string; sortKey: string; scenarios: RequestedScenario[] };
// full: every feature of the project is selected, so the CLI gets no paths and
// expands the profile's own `paths`, exactly as it does from a terminal
type RunBatch = { cwd: string; units: RunUnit[]; full: boolean };
// a selected leaf of the tree: a scenario or one example of a Scenario Outline
type Selected = { item: TestItem; data: ParsedScenario };

const lineRange = (line: number) => new vscode.Range(line - 1, 0, line - 1, 0);
// the leaves under a feature item: its scenarios plus the examples of its outlines
const leafCount = (feature: TestItem): number => {
	let count = 0;
	feature.children.forEach(child => (count += child.children.size > 0 ? child.children.size : 1));
	return count;
};

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
			item.children.replace(this.createScenarioItems(feature, featureUri));
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
			testFeature.children.replace(this.createScenarioItems(parsedFeature, featureUri));
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
					// get the requested item: a scenario, or an outline (which runs all of its examples)
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

		const batches = this.collectBatches(request);
		for (const batch of batches) {
			// Suites can be order-dependent, and cucumber runs explicit paths in the
			// order given. A full run therefore passes no paths (cucumber expands the
			// profile's `paths` itself, in the same order as from a terminal) and no
			// --selective-load, which only costs time when everything is loaded anyway.
			const chunks = batch.full ? [batch.units] : this.chunkUnits(batch.units);
			for (const chunk of chunks) {
				if (cancellationToken.isCancellationRequested) {
					break;
				}
				const requested: RequestedScenario[] = [];
				chunk.forEach(unit => requested.push(...unit.scenarios));
				requested.forEach(scenario => run.enqueued(scenario.item));
				const paths = batch.full ? [] : chunk.map(unit => unit.pathArg);
				const scanner = debug
					? await this.cucumberTestRunner.debug(paths, profileName, batch.cwd, !batch.full)
					: await this.cucumberTestRunner.run(paths, profileName, batch.cwd, !batch.full);
				await scanTestRun(requested, run, scanner, cancellationToken, batch.cwd);
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
	 * Builds the children of a feature item: one item per Scenario and, for each
	 * Scenario Outline, an item at the outline's line with one child per example
	 * row, so the Test Explorer counts and reports examples the way the CLI does.
	 * @param feature
	 * @param featureUri
	 */
	private createScenarioItems(feature: ParsedFeature, featureUri: vscode.Uri): TestItem[] {
		const scenarioItems = new Array<TestItem>();
		for (const scenario of feature.scenarios) {
			const testItem = this.controller.createTestItem(toKebabCase(scenario.title), scenario.title, featureUri);
			testItem.range = lineRange(scenario.lineNumber);
			this.addScenarioItem(scenarioItems, testItem, scenario);
		}
		for (const outline of feature.scenarioOutlines) {
			if (outline.exampleScenarios.length === 0) {
				continue;
			}
			const outlineItem = this.controller.createTestItem(toKebabCase(outline.title), outline.title, featureUri);
			outlineItem.range = lineRange(outline.lineNumber);
			const exampleItems = new Array<TestItem>();
			for (const example of outline.exampleScenarios) {
				// example titles repeat unless the outline's title has a <placeholder>,
				// so the row line is part of the id and the row's values are shown
				const exampleItem = this.controller.createTestItem(
					`${toKebabCase(example.title)}-${example.lineNumber}`,
					example.title,
					featureUri
				);
				exampleItem.range = lineRange(example.lineNumber);
				exampleItem.sortText = String(example.lineNumber).padStart(6, '0');
				if (example.title === outline.title) {
					exampleItem.description = Object.values(example.exampleRow as Record<string, string>).join(' | ');
				}
				this.addScenarioItem(exampleItems, exampleItem, example);
			}
			outlineItem.children.replace(exampleItems);
			this.addScenarioItem(scenarioItems, outlineItem, this.outlineScenario(outline, outline.exampleScenarios[0].cwd));
		}
		return scenarioItems;
	}

	/**
	 * The scenario data of an outline item: the outline itself at the line of
	 * its keyword, which runs every example when passed as `<feature>:<line>`.
	 * @param outline
	 * @param cwd
	 */
	private outlineScenario(outline: ParsedScenarioOutline, cwd: string): ParsedScenario {
		return {
			title: outline.title,
			steps: outline.steps,
			tags: outline.tags,
			exampleRow: undefined,
			lineNumber: outline.lineNumber,
			skippedViaTagFilter: outline.skippedViaTagFilter,
			scenarioContext: undefined,
			args: undefined,
			cwd
		};
	}

	/**
	 * Adds a scenario TestItem to the list for a feature. TestItem ids are
	 * kebab-cased titles, so two scenarios whose titles produce the same id
	 * would collide in the Test Explorer; the duplicate is skipped and reported.
	 * @param scenarioItems
	 * @param testItem
	 * @param scenario
	 */
	private addScenarioItem(scenarioItems: Array<TestItem>, testItem: TestItem, scenario: ParsedScenario) {
		if (scenarioItems.some(x => x.id === testItem.id)) {
			useCtvConfig().getConfig().cucumberOutput.appendLine(`Duplicate scenario found: "${testItem.label}", Skipping.`);
		} else {
			this.scenarioData.set(testItem, scenario);
			scenarioItems.push(testItem);
		}
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
	 * Groups the selected leaves of a run request (scenarios and the examples of
	 * Scenario Outlines) into one batch per working directory (the folder holding
	 * the cucumber configuration). Users can hide or filter out tests from their
	 * run, so excluded items are left out. A feature whose leaves are all included
	 * is passed to the CLI as the feature file, an outline whose examples are all
	 * included as `<feature>:<outline line>`, and anything else as `<feature>:<line>`.
	 * @param request
	 */
	private collectBatches(request: vscode.TestRunRequest): RunBatch[] {
		const roots = request.include ?? this.testItems;
		const included = new Map<TestItem, Set<TestItem>>(); // feature item -> included leaf items
		const visit = (item: TestItem) => {
			if (request.exclude?.includes(item)) {
				return;
			}
			if (item.children.size > 0) {
				item.children.forEach(child => visit(child));
			} else if (item.parent) {
				let feature = item.parent;
				while (feature.parent) {
					feature = feature.parent;
				}
				const leaves = included.get(feature) ?? new Set<TestItem>();
				leaves.add(item);
				included.set(feature, leaves);
			}
		};
		roots.forEach(item => visit(item));

		const batches = new Map<string, RunBatch>();
		included.forEach((leaves, feature) => {
			const selected: Selected[] = [];
			leaves.forEach(item => {
				const data = this.scenarioData.get(item);
				if (data) {
					selected.push({ item, data });
				}
			});
			if (selected.length === 0 || !feature.uri) {
				return;
			}
			const cwd = selected[0].data.cwd;
			const featurePath = normalizePath(path.relative(cwd, feature.uri.fsPath));
			const batch = batches.get(cwd) ?? { cwd, units: [], full: false };
			batches.set(cwd, batch);
			// cucumber sorts the absolute paths a glob matched with a plain string sort;
			// the same key here gives a filtered run the order a full run would have
			const sortKey = path.normalize(feature.uri.fsPath);
			const requested = (entries: Selected[]): RequestedScenario[] =>
				entries.map(entry => ({ item: entry.item, key: scenarioKey(cwd, featurePath, entry.data.lineNumber) }));
			const lineUnit = (line: number, entries: Selected[]): RunUnit => ({
				pathArg: `${featurePath}:${line}`,
				sortKey: `${sortKey}:${String(line).padStart(6, '0')}`,
				scenarios: requested(entries)
			});
			if (selected.length === leafCount(feature)) {
				batch.units.push({ pathArg: featurePath, sortKey, scenarios: requested(selected) });
				return;
			}
			const byOutline = new Map<TestItem, Selected[]>();
			for (const entry of selected) {
				const parent = entry.item.parent ?? feature;
				if (parent === feature) {
					batch.units.push(lineUnit(entry.data.lineNumber, [entry]));
				} else {
					byOutline.set(parent, [...(byOutline.get(parent) ?? []), entry]);
				}
			}
			byOutline.forEach((examples, outline) => {
				const outlineData = this.scenarioData.get(outline);
				if (outlineData && examples.length === outline.children.size) {
					batch.units.push(lineUnit(outlineData.lineNumber, examples));
				} else {
					examples.forEach(example => batch.units.push(lineUnit(example.data.lineNumber, [example])));
				}
			});
		});
		const batchList = Array.from(batches.values());
		for (const batch of batchList) {
			batch.units.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
			// one controller is one project, so its features are all under this cwd
			batch.full = this.testItems.every(feature => (included.get(feature)?.size ?? 0) === leafCount(feature));
		}
		return batchList;
	}

	/**
	 * Splits the units of a batch so that each chunk's path arguments fit on
	 * the command line.
	 * @param units
	 */
	private chunkUnits(units: RunUnit[]): RunUnit[][] {
		const chunks: RunUnit[][] = [];
		let current: RunUnit[] = [];
		let length = 0;
		for (const unit of units) {
			if (current.length > 0 && length + unit.pathArg.length > maxPathArgsLength) {
				chunks.push(current);
				current = [];
				length = 0;
			}
			current.push(unit);
			length += unit.pathArg.length + 3;
		}
		if (current.length > 0) {
			chunks.push(current);
		}
		return chunks;
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
