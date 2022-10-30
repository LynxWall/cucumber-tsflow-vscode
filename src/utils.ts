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
