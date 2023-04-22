import { debug } from 'console';

import * as vscode from 'vscode';
import useCtvConfig from '../use-ctv-config';
import { isWindows } from '../utils';
import { spawn } from 'child_process';
import CtvConfig from '../ctv-config';
import { TestOutputScanner } from './test-output-scanner';

export class CucumberTestRunner {
	private ctvConfig: CtvConfig;
	private runCommand: string;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
		this.runCommand = this.ctvConfig.runCommand;
	}

	public async run(filePath: string, lineNumber: number) {
		// if we're running on windows and the path starts
		// with a leading slash we need to strip
		// off the leading slash
		if (isWindows() && filePath.startsWith('/')) {
			filePath = filePath.substring(1);
		}
		const args = this.ctvConfig.runtimeArgs();
		args.push(`${filePath}:${lineNumber}`);

		const cucumberPath = this.ctvConfig.cucumberPath;

		const cp = spawn(this.runCommand, args, {
			cwd: cucumberPath,
			shell: true,
			stdio: 'pipe'
		});
		return new TestOutputScanner(cp);
	}

	public async debug(filePath: string, lineNumber: number) {}
}
