import ArgvParser, {
  ITsflowConfiguration,
} from "@lynxwall/cucumber-tsflow/lib/cli/argv-parser";
import { loadConfiguration } from "@lynxwall/cucumber-tsflow/lib/cli/load-configuration";
import ctvConfig from "../ctv-config";

class CucumberConfig {
  private tsFlowConfig?: ITsflowConfiguration;
  private currRoot: string = "";

  public get currentRoot(): string {
    return this.currRoot;
  }

  public getConfig = async (): Promise<ITsflowConfiguration> => {
    if (!this.tsFlowConfig || this.currRoot !== ctvConfig.cucumberPath) {
      await this.loadCucumberConfig();
    }
    return this.tsFlowConfig as ITsflowConfiguration;
  };

  public reset = () => {
    this.tsFlowConfig = undefined;
    this.currRoot = "";
  };

  private loadCucumberConfig = async () => {
    this.currRoot = ctvConfig.cucumberPath as string;
    const environment = {
      cwd: this.currRoot,
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      debug: false,
    };

    const args = ["node", "cucumber-tsflow", "-p", ctvConfig.profile];
    if (ctvConfig.configFilePath) {
      args.push("-c");
      args.push(ctvConfig.configFilePath);
    }

    // initialize options for the profile passed in
    const { options, configuration: argvConfiguration } =
      ArgvParser.parse(args);

    const { useConfiguration: configuration } = await loadConfiguration(
      {
        file: options.config,
        profiles: options.profile,
        provided: argvConfiguration,
      },
      environment
    );
    this.tsFlowConfig = configuration;
  };
}
// create a singleton instance
const cucumberConfig = new CucumberConfig();

export default cucumberConfig;
