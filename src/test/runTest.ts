import * as path from 'path';
import * as fs from 'fs';

import { runTests } from '@vscode/test-electron';

// Workspace opened by the test instance of VS Code. The default is the cucumber-tsflow
// library checkout: its spec workspaces each have a cucumber.json and feature files, and
// its root node_modules has @lynxwall/cucumber-tsflow installed. Override with CTV_TEST_WORKSPACE.
const defaultWorkspace = 'C:/GitHub/cucumber-js-tsflow';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// The fixture workspace the test instance opens
		const workspacePath = path.resolve(process.env.CTV_TEST_WORKSPACE ?? defaultWorkspace);
		if (!fs.existsSync(workspacePath)) {
			console.error(`Test workspace not found: ${workspacePath} (set CTV_TEST_WORKSPACE to override)`);
			process.exit(1);
		}

		// Download VS Code, unzip it and run the integration test against the fixture workspace.
		// Workspace trust is disabled because extensions do not activate in a restricted workspace.
		// CTV_VSCODE_VERSION picks the VS Code build to test against (default: latest stable); set it to the
		// engines.vscode minimum in package.json to prove the extension still activates there.
		await runTests({
			version: process.env.CTV_VSCODE_VERSION,
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [workspacePath, '--disable-extensions', '--disable-workspace-trust']
		});
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
