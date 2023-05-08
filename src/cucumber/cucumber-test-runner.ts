import * as vscode from 'vscode';
import useCtvConfig from '../use-ctv-config';
import { isWindows, pushMany } from '../utils';
import { spawn } from 'child_process';
import CtvConfig from '../ctv-config';
import { TestOutputScanner } from './test-output-scanner';

const DEBUG_CONFIG_NAME = 'Attach Cucumber-tsflow Debug';

export class CucumberTestRunner {
	private ctvConfig: CtvConfig;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
	}

	public async run(filePath: string, lineNumber: number, testArgs: string[] | undefined) {
		// if we're running on windows and the path starts
		// with a leading slash we need to strip
		// off the leading slash
		if (isWindows() && filePath.startsWith('/')) {
			filePath = filePath.substring(1);
		}
		const args = this.getCommandArgs(`${filePath}:${lineNumber}`);
		if (testArgs) {
			args.push(...testArgs);
		}
		const cucumberPath = this.ctvConfig.cucumberPath;
		const cp = spawn(this.ctvConfig.runCommand(), args, {
			cwd: cucumberPath,
			shell: true,
			stdio: 'pipe',
			// eslint-disable-next-line @typescript-eslint/naming-convention
			env: { ...process.env, FORCE_COLOR: '1' }
		});
		return new TestOutputScanner(cp);
	}

	public async debug(filePath: string, lineNumber: number, testArgs: string[] | undefined) {
		// if we're running on windows and the path starts
		// with a leading slash we need to strip
		// off the leading slash
		if (isWindows() && filePath.startsWith('/')) {
			filePath = filePath.substring(1);
		}
		const args = this.getCommandArgs(`${filePath}:${lineNumber}`);
		if (testArgs) {
			args.push(...testArgs);
		}
		const cucumberPath = this.ctvConfig.cucumberPath;
		const cp = spawn(this.ctvConfig.runCommand(true), args, {
			cwd: cucumberPath,
			shell: true,
			stdio: 'pipe',
			// eslint-disable-next-line @typescript-eslint/naming-convention
			env: { ...process.env, FORCE_COLOR: '1' }
		});

		vscode.debug.startDebugging(undefined, this.getDebugConfig());

		let exited = false;
		let rootSession: vscode.DebugSession | undefined;
		cp.once('exit', () => {
			exited = true;
			listener.dispose();

			if (rootSession) {
				vscode.debug.stopDebugging(rootSession);
			}
		});

		const listener = vscode.debug.onDidStartDebugSession(s => {
			if (s.name === DEBUG_CONFIG_NAME && !rootSession) {
				if (exited) {
					vscode.debug.stopDebugging(rootSession);
				} else {
					rootSession = s;
				}
			}
		});

		return new TestOutputScanner(cp);
	}

	/**
	 * Helper used to get commang arguments
	 * @param scenario scenario to debug
	 * @returns
	 */
	private getCommandArgs = (scenario: string): string[] => {
		const args: string[] = [];

		const runtimeArgs = this.ctvConfig.runtimeArgs();
		pushMany(args, runtimeArgs);
		args.push(scenario.trim());

		return args;
	};

	/**
	 * Helper used to get debug configuration
	 * @param scenario scenario to debug
	 * @returns
	 */
	private getDebugConfig = (): vscode.DebugConfiguration => {
		const config: vscode.DebugConfiguration = {
			name: DEBUG_CONFIG_NAME,
			stopOnEntry: false,
			request: 'attach',
			type: 'node',
			port: this.ctvConfig.debugPort,
			...this.ctvConfig.debugOptions
		};
		return config;
	};
}
