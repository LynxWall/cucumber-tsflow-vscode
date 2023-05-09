import ArgvParser, { ITsflowConfiguration } from '@lynxwall/cucumber-tsflow/lib/cli/argv-parser';
import { loadConfiguration } from '@lynxwall/cucumber-tsflow/lib/cli/load-configuration';
import CtvConfig from '../ctv-config';
import useCtvConfig from '../use-ctv-config';
import { quote } from '../utils';

export default class CucumberConfig {
	private ctvConfig: CtvConfig;

	constructor() {
		this.ctvConfig = useCtvConfig().getConfig();
	}

	public loadCucumberConfig = async (cucumberRoot: string) => {
		const environment = {
			cwd: cucumberRoot,
			stdout: process.stdout,
			stderr: process.stderr,
			debug: false
		};

		const cmd = `${quote(this.ctvConfig.cucumberBinPath)}`;
		const args = ['node', cmd, '-p', this.ctvConfig.profile];
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
		return configuration as ITsflowConfiguration;
	};
}
