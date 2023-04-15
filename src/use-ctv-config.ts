import CtvConfig from './ctv-config';
let config: CtvConfig | undefined = undefined;

const useCtvConfig = () => {
	const getConfig = (): CtvConfig => {
		if (!config) {
			config = new CtvConfig();
		}
		return config;
	};

	return { getConfig };
};

export default useCtvConfig;
