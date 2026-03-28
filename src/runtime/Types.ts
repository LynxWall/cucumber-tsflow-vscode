import type { Envelope } from '@cucumber/messages';
import type { IRunEnvironment } from '@cucumber/cucumber/lib/environment/index';
import type {
	ILoadConfigurationOptions,
	ILoadSupportOptions,
	IRunResult,
	ISupportCodeLibrary
} from '@cucumber/cucumber/lib/api/types';
import type { ITsflowResolvedConfiguration, ITsFlowRunOptions } from '@lynxwall/cucumber-tsflow/api';

/**
 * Programmatic API surface exposed by @lynxwall/cucumber-tsflow.
 * Typed separately so the worker can require() it at runtime from the project's node_modules.
 */
export type TsflowApi = {
	loadConfiguration: (
		options?: ILoadConfigurationOptions,
		environment?: IRunEnvironment
	) => Promise<ITsflowResolvedConfiguration>;
	/** cucumber-tsflow accepts the resolved run configuration directly (not wrapped in { provided }). */
	loadSupport: (options: ITsFlowRunOptions, environment?: IRunEnvironment) => Promise<ISupportCodeLibrary>;
	/** Incrementally reload support code, evicting only changed modules from Node's require cache. */
	reloadSupport: (
		options: ILoadSupportOptions,
		changedPaths: string[],
		environment?: IRunEnvironment
	) => Promise<ISupportCodeLibrary>;
	runCucumber(
		options: ITsFlowRunOptions & { support: ISupportCodeLibrary },
		environment?: IRunEnvironment,
		onMessage?: (message: Envelope) => void
	): Promise<IRunResult>;
};
