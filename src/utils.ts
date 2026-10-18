import { execSync } from 'child_process';

const QUOTES: any = {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	'"': true,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	"'": true,
	// eslint-disable-next-line @typescript-eslint/naming-convention
	'`': true
};

export const isWindows = (): boolean => {
	return process.platform.includes('win32');
};

export const normalizePath = (path: string): string => {
	return isWindows() ? path.replace(/\\/g, '/') : path;
};

/**
 * VS Code lowercases the drive letter in `Uri.fsPath` and `Uri.path` (`c:\...`). Node keeps a CommonJS path as
 * given but canonicalizes an ESM path, so a bin path or working directory with a lowercase drive letter makes the
 * CLI load one copy of cucumber-tsflow (and cucumber) and the step files import another, which fails with
 * "calling functions on an instance of Cucumber that isn't running". Uppercase it, the form Node itself produces.
 *
 * cucumber-tsflow 8.0.1 fixes this in the library itself (its bin loads the library through a path spelled like the
 * working directory). The uppercasing stays to protect consumers still on 8.0.0; with 8.0.1 it is harmless.
 */
export const normalizeDriveLetter = (path: string): string => {
	return isWindows() ? path.replace(/^[a-z]:/, drive => drive.toUpperCase()) : path;
};

export const escapeRegExp = (s: string): string => {
	const escapedString = s.replace(/[.*+?^${}<>()|[\]\\]/g, '\\$&'); // $& means the whole matched string
	return escapedString.replace(/\\\(\\\.\\\*\\\?\\\)/g, '(.*?)'); // should revert the escaping of match all regex patterns.
};

export const escapeRegExpForPath = (s: string): string => {
	return s.replace(/[*+?^${}<>()|[\]]/g, '\\$&'); // $& means the whole matched string
};

export const exactRegexMatch = (s: string): string => {
	return ['^', s, '$'].join('');
};

export const escapeSingleQuotes = (s: string): string => {
	return isWindows() ? s : s.replace(/'/g, "'\\''");
};

export const quote = (s: string): string => {
	const q = isWindows() ? '"' : `'`;
	return [q, s, q].join('');
};

export const unquote = (s: string): string => {
	if (QUOTES[s[0]]) {
		s = s.substring(1);
	}

	if (QUOTES[s[s.length - 1]]) {
		s = s.substring(0, s.length - 1);
	}

	return s;
};

export const pushMany = <T>(arr: T[], items: T[]): number => {
	return Array.prototype.push.apply(arr, items);
};

export const escapePlusSign = (s: string): string => {
	return s.replace(/[+]/g, '\\$&');
};

export const isNodeExecuteAbleFile = (filepath: string): boolean => {
	try {
		execSync(`node ${filepath} --help`);
		return true;
	} catch (err) {
		return false;
	}
};

export const matchRule = (str: string, rule: string) => {
	var escapeRegex = (str: string) => str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
	return new RegExp('^' + rule.split('*').map(escapeRegex).join('.*') + '$').test(str);
};
/**
 * Helper used to convert Title text into kebab id
 * @param str
 */
export const toKebabCase = (str: string): string => {
	let result = str
		.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
		?.map(x => x.toLowerCase())
		.join('-');

	if (!result) {
		result = str;
	}
	return result;
};
