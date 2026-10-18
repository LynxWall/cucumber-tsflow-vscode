import * as vscode from 'vscode';
import useCtvConfig from '../use-ctv-config';
import { pushMany, quote } from '../utils';
import { spawn, SpawnOptionsWithoutStdio } from 'child_process';
import CtvConfig from '../ctv-config';
import { TestOutputScanner } from './test-output-scanner';

const DEBUG_CONFIG_NAME = 'Attach Cucumber-tsflow Debug';

export class CucumberTestRunner {
	private ctvConfig: CtvConfig;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
	}

	/**
	 * Runs one cucumber-tsflow process for the feature paths passed in
	 * (`<feature>` or `<feature>:<line>`, relative to cwd).
	 * @param paths feature paths to run
	 * @param profileName cucumber profile
	 * @param cwd folder holding the cucumber configuration
	 */
	public async run(paths: string[], profileName: string, cwd: string, selectiveLoad: boolean = true) {
		const cp = spawn(
			this.ctvConfig.runCommand(),
			this.getCommandArgs(paths, profileName, selectiveLoad),
			this.spawnOptions(cwd)
		);
		return new TestOutputScanner(cp);
	}

	/**
	 * Same as run, with the Node inspector enabled and a debug session attached.
	 */
	public async debug(paths: string[], profileName: string, cwd: string, selectiveLoad: boolean = true) {
		const cp = spawn(
			this.ctvConfig.runCommand(true),
			this.getCommandArgs(paths, profileName, selectiveLoad),
			this.spawnOptions(cwd)
		);

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

	private spawnOptions = (cwd: string): SpawnOptionsWithoutStdio => {
		// FORCE_COLOR keeps cucumber's colors in the Test Results terminal. Node warns
		// when NO_COLOR is set alongside it, so drop NO_COLOR from the child's environment.
		// eslint-disable-next-line @typescript-eslint/naming-convention
		const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '1' };
		delete env.NO_COLOR;
		return { cwd, shell: true, env };
	};

	/**
	 * Builds the CLI arguments: profile, configured options, the message
	 * formatter on stdout (which is what the scanner reads results from)
	 * and the feature paths.
	 * @param paths feature paths to run
	 * @param profileName cucumber profile
	 * @param selectiveLoad false for a run that loads everything anyway
	 */
	private getCommandArgs = (paths: string[], profileName: string, selectiveLoad: boolean): string[] => {
		const args: string[] = [];

		// add the profile
		args.push('-p');
		args.push(profileName);

		const runtimeArgs = this.ctvConfig.runtimeArgs(undefined, selectiveLoad);
		pushMany(args, runtimeArgs);
		args.push('--format');
		args.push('message');
		pushMany(
			args,
			paths.map(p => quote(p))
		);

		return args;
	};

	/**
	 * Helper used to get debug configuration
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
