import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { locateFile } from './locate-file';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { importer } = require('./importer');

export const loadConfg = async (cwd: string) => {
	const fileName = locateFile(cwd);
	const filePath: string = path.join(cwd, fileName!);
	const extension = path.extname(filePath);
	let definitions;
	switch (extension) {
		case '.json':
			definitions = JSON.parse(await promisify(fs.readFile)(filePath, { encoding: 'utf-8' }));
			break;
		case '.yaml':
		case '.yml':
			definitions = YAML.parse(await promisify(fs.readFile)(filePath, { encoding: 'utf-8' }));
			break;
		default:
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				definitions = require(filePath);
			} catch (error: any) {
				if (error.code === 'ERR_REQUIRE_ESM') {
					definitions = await importer(pathToFileURL(filePath));
				} else {
					throw error;
				}
			}
	}
	if (typeof definitions !== 'object') {
		throw new Error(`Configuration file ${filePath} does not export an object`);
	}
	return definitions;
};
