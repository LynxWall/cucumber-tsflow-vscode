import * as assert from 'assert';
import * as vscode from 'vscode';

const extensionId = 'lynxwall.cucumber-tsflow-vscode';

// The folder under the fixture workspace whose cucumber.json must be discovered as a project.
// Commands are registered per project folder name, so this proves discovery and loading ran.
const fixtureProject = 'node';

suite('Extension Test Suite', function () {
	// Activation globs the fixture workspace, loads every cucumber config it finds
	// and spawns node to validate the cucumber-tsflow bin, so allow it some time.
	this.timeout(60000);

	let extension: vscode.Extension<unknown> | undefined;

	suiteSetup(async () => {
		extension = vscode.extensions.getExtension(extensionId);
		await extension?.activate();
	});

	test('reports the host versions', () => {
		console.log(`VS Code ${vscode.version}, extension host Node ${process.versions.node}`);
	});

	test('opens the fixture workspace', () => {
		const folders = vscode.workspace.workspaceFolders ?? [];
		assert.ok(folders.length > 0, 'no workspace folder is open');
	});

	test('activates the extension', () => {
		assert.ok(extension, `extension ${extensionId} was not found`);
		assert.strictEqual(extension.isActive, true);
	});

	test(`registers run and debug commands for the ${fixtureProject} project`, async () => {
		const commands = await vscode.commands.getCommands(true);
		const runCommand = `cucumber.${fixtureProject}.runCucumber`;
		const debugCommand = `cucumber.${fixtureProject}.debugCucumber`;
		assert.ok(commands.includes(runCommand), `${runCommand} is not registered`);
		assert.ok(commands.includes(debugCommand), `${debugCommand} is not registered`);
	});
});
