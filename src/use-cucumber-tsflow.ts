import useCtvConfig from './use-ctv-config';
import * as path from 'path';
import * as fs from 'fs';
import { gte as semverGte } from 'semver';
import CtvConfig from './ctv-config';

const isCucumberTsFlowInstalled = (ctvConfig: CtvConfig): boolean => {
	const tsFlow = path.join(ctvConfig.projectPath ?? '', 'node_modules', '@lynxwall', 'cucumber-tsflow');
	return fs.existsSync(tsFlow);
};

const useCucumberTsFlow = () => {
	const minCucumberTsFlowVer = '6.0.2';

	const checkCucumberTsFlow = (): boolean => {
		const ctvConfig = useCtvConfig().getConfig();
		if (isCucumberTsFlowInstalled(ctvConfig)) {
			const currentVersion = require(path.join(
				ctvConfig.projectPath ?? '',
				'node_modules',
				'@lynxwall',
				'cucumber-tsflow',
				'lib/version'
			)).version;
			if (semverGte(currentVersion, minCucumberTsFlowVer)) {
				ctvConfig.cucumberOutput.appendLine(`Using cucumber-tsflow version: ${currentVersion}`);
				return true;
			} else {
				ctvConfig.cucumberOutput.appendLine(`Current version of cucumber-tsflow is: \"${currentVersion}\"`);
			}
		} else {
			ctvConfig.cucumberOutput.appendLine(
				`Cucmber TsFlow for VS Code requires cucumber-tsflow version \"${minCucumberTsFlowVer}\" or higher.`
			);
		}
		return false;
	};

	return { checkCucumberTsFlow };
};

export default useCucumberTsFlow;
