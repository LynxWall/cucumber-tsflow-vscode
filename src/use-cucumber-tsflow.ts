import ctvConfig from './ctv-config';
import * as path from 'path';
import * as fs from 'fs';
import { gte as semverGte } from 'semver';
import { version as tsFlowVersion } from '@lynxwall/cucumber-tsflow/lib/version';

const isCucumberTsFlowInstalled = (): boolean => {
	const tsFlow = path.join(ctvConfig.projectPath ?? '', 'node_modules', '@lynxwall', 'cucumber-tsflow');
	return fs.existsSync(tsFlow);
};

const useCucumberTsFlow = () => {
	const minCucumberTsFlowVer = '5.1.2';

	const checkCucumberTsFlow = (): boolean => {
		if (isCucumberTsFlowInstalled() && semverGte(tsFlowVersion, minCucumberTsFlowVer)) {
			return true;
		}
		if (isCucumberTsFlowInstalled()) {
			console.log(`Current version of cucumber-tsflow is: \"${tsFlowVersion}\"`);
		}
		console.log(`Cucmber TsFlow for VS Code requires cucumber-tsflow version \"${minCucumberTsFlowVer}\" or higher.`);
		return false;
	};

	return { checkCucumberTsFlow };
};

export default useCucumberTsFlow;
