import fs from 'fs';
import path from 'path';

const DEFAULT_FILENAMES = [
	'cucumber.js',
	'cucumber.cjs',
	'cucumber.mjs',
	'cucumber.json',
	'cucumber.yaml',
	'cucumber.yml'
];

export function locateFile(cwd: string): string | undefined {
	return DEFAULT_FILENAMES.find(filename => fs.existsSync(path.join(cwd, filename)));
}
