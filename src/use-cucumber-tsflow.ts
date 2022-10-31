import ctvConfig from './ctv-config';
import * as path from 'path';
import * as fs from 'fs';
import { gte as semverGte } from 'semver';

const tsFlow = path.join(ctvConfig.projectPath ?? '', 'node_modules', '@lynxwall', 'cucumber-tsflow');

const isCucumberTsFlowInstalled = (): boolean => {
	return fs.existsSync(tsFlow);
};

const useCucumberTsFlow = () => {
	const minCucumberTsFlowVer = '5.1.2';

	const checkCucumberTsFlow = (): boolean => {
		if (isCucumberTsFlowInstalled()) {
			const currentVersion = require(path.join(tsFlow, 'lib/version')).version;
			if (semverGte(currentVersion, minCucumberTsFlowVer)) {
				return true;
			} else {
				console.log(`Current version of cucumber-tsflow is: \"${currentVersion}\"`);
			}
		} else {
			console.log(`Cucmber TsFlow for VS Code requires cucumber-tsflow version \"${minCucumberTsFlowVer}\" or higher.`);
		}
		return false;
	};

	return { checkCucumberTsFlow };
};

export default useCucumberTsFlow;
