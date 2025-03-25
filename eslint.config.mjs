import { defineConfig, globalIgnores } from 'eslint/config';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default defineConfig([
	globalIgnores([
		'**/out',
		'**/dist',
		'**/*.d.ts',
		'**/node_modules',
		'**/wwwroot',
		'**/dist',
		'**/dist-ssr',
		'**/lib',
		'**/lib-ssr',
		'**/.env.local',
		'**/.env.*.local',
		'**/npm-debug.log*',
		'**/yarn-debug.log*',
		'**/yarn-error.log*',
		'**/pnpm-debug.log*',
		'**/.idea',
		'**/*.suo',
		'**/*.ntvs*',
		'**/*.njsproj',
		'**/*.sw?',
		'**/*.user',
		'**/.vs',
		'**/_ReSharper*/',
		'**/*.[Rr]e[Ss]harper',
		'**/*.DotSettings.user',
		'**/*.dotCover',
		'**/*.[Cc]ache',
		'!**/*.[Cc]ache/'
	]),
	{
		plugins: {
			'@typescript-eslint': typescriptEslint
		},

		languageOptions: {
			parser: tsParser,
			ecmaVersion: 6,
			sourceType: 'module'
		},

		rules: {
			'@typescript-eslint/naming-convention': 'warn',
			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
			semi: 'off'
		}
	}
]);

