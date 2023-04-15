import ArgvParser, { ITsflowConfiguration } from '@lynxwall/cucumber-tsflow/lib/cli/argv-parser';
import { loadConfiguration } from '@lynxwall/cucumber-tsflow/lib/cli/load-configuration';
import CtvConfig from '../ctv-config';
import useCtvConfig from '../use-ctv-config';

export default class CucumberConfig {
	private tsFlowConfig?: ITsflowConfiguration;
	private currRoot: string = '';
	private ctvConfig: CtvConfig;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
	}

	public get currentRoot(): string {
		return this.currRoot;
	}

	public getConfig = async (): Promise<ITsflowConfiguration> => {
		if (!this.tsFlowConfig || this.currRoot !== this.ctvConfig.cucumberPath) {
			await this.loadCucumberConfig();
		}
		return this.tsFlowConfig as ITsflowConfiguration;
	};

	public reset = () => {
		this.tsFlowConfig = undefined;
		this.currRoot = '';
	};

	private loadCucumberConfig = async () => {
		this.currRoot = this.ctvConfig.cucumberPath as string;
		const environment = {
			cwd: this.currRoot,
			stdout: process.stdout,
			stderr: process.stderr,
			env: process.env,
			debug: false
		};

		const args = ['node', 'cucumber-tsflow', '-p', this.ctvConfig.profile];
		if (this.ctvConfig.configFile && this.ctvConfig.configFile !== '') {
			args.push('-c');
			args.push(this.ctvConfig.configFile);
		}

		// initialize options for the profile passed in
		const { options, configuration: argvConfiguration } = ArgvParser.parse(args);

		const { useConfiguration: configuration } = await loadConfiguration(
			{
				file: options.config,
				profiles: options.profile,
				provided: argvConfiguration
			},
			environment
		);
		this.tsFlowConfig = configuration;
	};
}
