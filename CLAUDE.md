# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`cucumber-tsflow-vscode` is the VS Code extension for [`@lynxwall/cucumber-tsflow`](https://github.com/LynxWall/cucumber-js-tsflow), published to the Marketplace as `lynxwall.cucumber-tsflow-vscode`. It adds Test Explorer and Code Lens support for running and debugging cucumber-tsflow scenarios: one test controller per cucumber configuration file found in the workspace, one Run and one Debug profile per cucumber profile in that file, and Run/Debug/RunAll/DebugAll lenses on `@given`/`@when`/`@then` steps and `@binding` classes in step files.

The extension does **not** run cucumber in-process. For every run request it spawns the consumer project's own `node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow` once per cucumber configuration as a child process (`node <bin> -p <profile> [-c <config>] [--selective-load] --format message <feature>[:<line>]...`), reads cucumber's message stream from stdout to give every selected scenario its result, and pipes stderr into the Test Explorer. Debugging spawns the same command with `--inspect=9777` and attaches a `node` debug session named `Attach Cucumber-tsflow Debug`. What the extension bundles from cucumber-tsflow at build time is only a handful of pure helpers (`hasMatchingStep`, `hasMatchingTags`, `hasStringValue`) and one type.

The library itself lives in a sibling checkout at `C:\GitHub\cucumber-js-tsflow`; read its `CLAUDE.md` and `Architecture.md` when a change here depends on CLI flags, exit codes or output behavior.

## Repository layout

Single package, Yarn 3 (`.yarn/releases/yarn-3.2.0.cjs`, `nodeLinker: node-modules`). Source is under [src/](src/); the shipped bundle is `out/extension.js`.

| Path | Role |
|---|---|
| [src/extension.ts](src/extension.ts) | `activate()`: finds projects, builds controllers, profiles, commands, code lens providers and save hooks |
| [src/ctv-config.ts](src/ctv-config.ts), [src/use-ctv-config.ts](src/use-ctv-config.ts) | Singleton wrapper over the `cucumber-tsflow.*` settings, the output channel, project-path and bin-path discovery, CLI argument building |
| [src/use-cucumber-tsflow.ts](src/use-cucumber-tsflow.ts) | The version gate: reads `lib/version` from the consumer's installed cucumber-tsflow and refuses to activate below `minCucumberTsFlowVer` |
| [src/configuration/](src/configuration/) | Locates and loads `cucumber.{js,cjs,mjs,json,yaml,yml}` (a trimmed copy of cucumber-js's config loader) |
| [src/gherkin/](src/gherkin/) | Parses feature files with `@cucumber/gherkin` into `ParsedFeature`s and maps step-file decorators back to scenarios for Code Lens |
| [src/cucumber/cucumber-test-features.ts](src/cucumber/cucumber-test-features.ts) | Builds `TestItem`s from parsed features, handles Test Explorer and Code Lens run requests |
| [src/cucumber/cucumber-test-runner.ts](src/cucumber/cucumber-test-runner.ts), [src/cucumber/test-output-scanner.ts](src/cucumber/test-output-scanner.ts) | Spawns the CLI, streams output into the run, maps exit codes to passed/failed/skipped |
| [src/cucumber/step-file-manager.ts](src/cucumber/step-file-manager.ts), [src/step-code-lens-provider.ts](src/step-code-lens-provider.ts) | Per-project step-file parsing and the Code Lens provider |
| [src/types.ts](src/types.ts), [src/utils.ts](src/utils.ts) | Shared types and path/string helpers |
| [src/test/](src/test/) | `@vscode/test-electron` + mocha integration harness: opens the fixture workspace in a downloaded VS Code and checks activation and command registration |
| [.claude/skills/](.claude/skills/) | Contributor skills for this repo (see below); not shipped |

`out/`, `.vscode-test/` and `*.vsix` are build output and gitignored. The `images/` folder holds the icon and README media.

## Commands

| Task | Command |
|---|---|
| Install | `yarn` |
| Bundle the extension with esbuild (sourcemap, to `out/extension.js`) | `yarn build` |
| Bundle in watch mode (what the `Run Extension` launch config uses) | `yarn watch` |
| Type-check and emit with `tsc` (to `out/`, needed by the test harness) | `yarn build:test` |
| Type-check only | `npx tsc -p ./ --noEmit` |
| Lint (ESLint 8, `.eslintrc.json`; reports, does not fix) | `yarn lint` |
| Format | `yarn format` |
| Integration tests against `C:\GitHub\cucumber-js-tsflow` (override with `CTV_TEST_WORKSPACE`; downloads VS Code into `.vscode-test/` on first run) | `yarn test` |
| Minified bundle, run by `vsce` before packaging | `yarn vscode:prepublish` |

`yarn build` is **esbuild only and does not type-check**. A change can bundle fine and still be broken for `tsc`, so run `npx tsc -p ./ --noEmit` (or `yarn build:test`) and `yarn lint` before calling a change done. `yarn build` and `yarn build:test` both `rimraf out`, so they overwrite each other's output.

### Trying the extension

Press F5 (`Run Extension` in [.vscode/launch.json](.vscode/launch.json)) or use the `verify-extension-host` skill ([.claude/skills/verify-extension-host/SKILL.md](.claude/skills/verify-extension-host/SKILL.md)), which opens an Extension Development Host window in the user's installed VS Code from the command line and reads the extension's output channel back from VS Code's log folder. Always use the installed, configured VS Code: never launch with `--user-data-dir`, a new profile or a separate extensions directory, which produces a first-run instance the user does not want. The workspace must contain `.feature` files (the activation event) and a `node_modules/@lynxwall/cucumber-tsflow` install at or below the workspace root. `C:\GitHub\cucumber-js-tsflow` works as a fixture workspace once it has been built: its eight spec workspaces each have a `cucumber.json`.

## Contributor skills

| Skill | Use it when |
|---|---|
| [verify-extension-host](.claude/skills/verify-extension-host/SKILL.md) | You changed anything in `src/` and need evidence it works in a real VS Code window: launches the Extension Development Host against a workspace and reads the `Cucumber TsFlow` output channel back |
| [link-local-cucumber-tsflow](.claude/skills/link-local-cucumber-tsflow/SKILL.md) | You need to build against an unreleased cucumber-tsflow from `C:\GitHub\cucumber-js-tsflow` (a `portal:` devDependency), or undo that |
| [package-vsix](.claude/skills/package-vsix/SKILL.md) | You are preparing a release: version and CHANGELOG, `vsce package`, install the `.vsix` locally and re-verify |

## How activation works

1. `useCtvConfig().getConfig().projectPath`: the `cucumber-tsflow.projectPath` setting, or else the shallowest `**/node_modules/@lynxwall/` under the first workspace folder.
2. `useCucumberTsFlow().checkCucumberTsFlow()`: `require(<projectPath>/node_modules/@lynxwall/cucumber-tsflow/lib/version)` and compare with `minCucumberTsFlowVer`. Below it, nothing is registered and the reason is written to the `Cucumber TsFlow` output channel.
3. `allCucumberSettingsFromRoot`: glob `**/cucumber.{js,cjs,mjs,json,yaml,yml}` under the project path (excluding `node_modules`). Each folder with a config is a **project**, named after that folder.
4. Per project: load the config, collect `paths` from all profiles (feature globs) and `require` plus `import` from all profiles (step globs), create a `TestController` named `Cucumber - <folder>`, one Run and one Debug profile per cucumber profile (the `default` profile, or the first one, is marked default), the `cucumber.<folder>.runCucumber` / `debugCucumber` commands, a Code Lens provider over the step globs, and an `onDidSaveTextDocument` hook that re-parses a saved feature file.
5. Test items are created lazily in `resolveHandler` from the features matched by the `default` profile's `paths`, filtered by that profile's `tags`.

## Code style

Enforced by [.prettierrc](.prettierrc) and [.eslintrc.json](.eslintrc.json): **tabs** (width 2), single quotes, semicolons, **no trailing commas**, 120-char print width, `arrowParens: avoid`, CRLF line endings. `@typescript-eslint/naming-convention` is on, so object keys like `FORCE_COLOR` need an `eslint-disable-next-line` comment. Prefer `type` aliases as the existing code does; avoid `any` in new code.

Working preferences shared with the library repo: don't refactor code you weren't asked to change; don't add error handling, validation, or logging unless requested; don't add dependencies without asking; don't write tests that merely validate third-party APIs.

Markdown: ATX headings, blank line around every heading, list, table and code block, fenced blocks language-tagged.

## Things that bite

- **Two "cucumber-tsflow version" numbers exist and mean different things.** The `devDependency` in [package.json](package.json) is what esbuild bundles helpers and types from; `minCucumberTsFlowVer` in [src/use-cucumber-tsflow.ts](src/use-cucumber-tsflow.ts) is what the *consumer* must have installed. Bump the first when the imports change (`lib/cucumber/*` became `lib/runtime/*` in 8.0); bump the second only when the CLI contract the extension relies on changes (flags, exit codes, output streams), and update the README's intro and Requirements sections and the CHANGELOG with it.
- **Deep imports go through the `./lib/*` wildcard export** of cucumber-tsflow, which carries only a `require` condition. esbuild resolves `import` statements with the `import` condition and would refuse those paths, so the `esbuild-base` script passes `--conditions=require`; don't drop that flag. The library has noted it may close that wildcard in a later major; if it does, the three helper imports need a public entry point instead. `tsc` is unaffected (node10 resolution ignores `exports`).
- **`@cucumber/gherkin` and `@cucumber/messages` are imported directly but not declared** ([src/gherkin/gherkin-feature.ts](src/gherkin/gherkin-feature.ts)); they resolve only because Yarn hoists them from cucumber-tsflow's dependency tree, so their versions follow whatever cucumber-tsflow pins (38.0.0 and 32.0.1 for 8.0.0). This is why the link skill uses `portal:` and not `link:`. Declaring them as devDependencies would be the proper fix; ask before adding them.
- **No `postDebugTask` on the F5 config.** The old `Terminate All Tasks` post-task (a shell task echoing an `${input}` whose command was `workbench.action.tasks.terminate` with `terminateAll`) made the Extension Development Host's extension host crash with exit code 134 about a second after start, on VS Code 1.142, whenever F5 ran with the `npm: watch` pre-task; without the post-task, or without the pre-task, the host is fine. Bisected on 2026-10-18 by launching the same host from the command line (fine with and without `--inspect-brk-extensions`, fine with watch running) and by toggling the two tasks. The watch task now keeps running between sessions and the next F5 reuses it. `autoAttachChildProcesses` is also off: the extension attaches its own `Attach Cucumber-tsflow Debug` session, so js-debug has no reason to inject its bootloader into every cucumber-tsflow process the host spawns.
- **`yarn watch` must use `--watch=forever`.** esbuild 0.25 ends watch mode as soon as stdin closes; the F5 `npm: watch` task normally keeps stdin open, but any wrapper that doesn't (a captured shell, a CI step) would get one build and then silence.
- **`yarn build` bundles whatever `node_modules/@lynxwall/cucumber-tsflow` resolves to.** `vsce package` excludes `node_modules`, so the three helpers travel inside `out/extension.js`; nothing from the library is loaded at run time except the consumer's CLI.
- **Results come from cucumber's message stream, not the exit code.** [src/cucumber/test-output-scanner.ts](src/cucumber/test-output-scanner.ts) parses the ndjson that `--format message` writes to stdout: `testCase` envelopes say which scenarios will run, `testStepFinished` carries each step's status and error, `testCaseFinished` closes a scenario (unless `willBeRetried`). A test case is matched to its `TestItem` by feature file (relative to the spawn `cwd`) plus `pickle.location.line`: the line of the `Scenario` keyword for a scenario, the line of the table row for an example of a Scenario Outline. Each example is its own child item under the outline item (VS Code derives the outline's state from its children); the `Scenario` line from the `gherkinDocument` envelope (via `pickle.astNodeIds[0]`) is only the fallback. `FAILED`/`AMBIGUOUS`/`UNDEFINED` fail the item, `PENDING`/`SKIPPED` skip it. The exit code only matters when no `testCase` arrived at all: `1` then marks every requested item errored with the stderr tail (configuration error, unhandled exception, a throwing `BeforeAll`/`AfterAll`). Any stdout line that is not JSON (a `console.log` in support code) is shown as is. A run request becomes one process per cucumber configuration. When every feature of the project is selected no paths are passed (and no `--selective-load`), so cucumber expands the profile's `paths` itself; otherwise a feature whose leaves are all selected is passed as the file, an outline whose examples are all selected as `<feature>:<outline line>`, the rest as `<feature>:<line>`, sorted by absolute path with a plain string sort, which is how cucumber orders a glob's matches. **Order matters**: cucumber runs explicit paths in the order given (it sorts only within one glob's matches), and the SSWF Vue suite has order-dependent features (`pal/supervisor/student-summary`, `context-store`) that fail when run in another order; the tree's `glob` order is not cucumber's. The list is split into several processes if it would exceed the Windows command-line limit. cucumber-js's `@file` path lists are resolved relative to `cwd`, not absolute, so they are not used.
- **Since cucumber-tsflow 8.0 its own output (configuration lines, startup progress, notices) goes to stderr**; stdout carries only formatter output. The scanner streams stderr into the run as it arrives (stdout is the message stream); in debug runs it drops only the Node inspector's `Debugger attached` / `Debugger listening` lines from stderr, not the whole stream. The child gets `FORCE_COLOR=1` and no `NO_COLOR` (Node warns when both are set).
- **Paths come in three flavors.** `vscode.Uri.path` has a leading `/` on Windows (`/c:/...`) and must be stripped before being passed to the CLI (the `isWindows()` checks in the runner); `Uri.fsPath` uses backslashes; glob matching with `minimatch` works on forward-slash paths, so `normalizePath()` is applied to everything that is compared or globbed, and two paths are compared with `isSamePath()` (case-insensitive on Windows), never `===`: the project path carries an uppercase drive letter and `Uri.fsPath` a lowercase one, and a strict comparison silently breaks the Code Lens run (`findFeatureTestItem`) and the save hook. Keep that discipline when touching anything path-related.
- **VS Code lowercases the drive letter** in `Uri.fsPath` and `Uri.path` (`c:...`). Node keeps a CommonJS path as given but canonicalizes the drive letter of an ESM path, so a lowercase drive letter in the bin path or the spawn `cwd` makes the CLI load one copy of cucumber-tsflow and the step files import another: the `calling functions on an instance of Cucumber that isn't running (status: PENDING)` error, seen with a pnpm consumer whose steps are `import`ed, while the same command works from a terminal. Every path taken from VS Code goes through `normalizeDriveLetter()` before it reaches the CLI; keep that when adding a new one. Running the extension's command from a shell with an uppercase drive letter is the quickest way to tell this apart from a real installation problem.
- **`TestItem` ids are kebab-cased titles**, so two scenarios whose titles kebab to the same string collide; the loader logs `Duplicate scenario found` to the output channel and keeps the first. Feature ids collide the same way across files. Example items under an outline use `<kebab-title>-<row line>`, since their titles repeat whenever the outline's title has no `<placeholder>`.
- **`testing.getSelectedProfiles`** (used so Code Lens runs honor the profile picked in the Test Explorer) exists only from VS Code 1.78. The pin is higher, `^1.90.0`, because the bundle carries `glob` 11 and `minimatch` 10, which need Node 20, and 1.90 is the first VS Code whose extension host runs Node 20. `@types/vscode` matches the pin so `tsc` catches newer API use. `CTV_VSCODE_VERSION=1.90.0 yarn test` runs the activation test against that build (downloaded into `.vscode-test/`) and prints the host's Node version; do that before raising or lowering the pin.
- **Consumers may use pnpm with isolated `node_modules`.** The bin lookup tries `node_modules/@lynxwall/cucumber-tsflow/bin/cucumber-tsflow` and `node_modules/.bin/cucumber-tsflow` under `projectPath`, and `isNodeExecuteAbleFile` actually spawns `node <bin> --help` to validate it, so a wrong project path costs a process spawn per lookup.
- **cucumber-tsflow 8.x requires Node 22 or later** in the consumer project; the extension spawns whatever `node` is on the Extension Host's `PATH`.
- **`yarn test` proves activation and discovery, not running or debugging.** [src/test/runTest.ts](src/test/runTest.ts) opens the fixture workspace (`C:\GitHub\cucumber-js-tsflow`, or `CTV_TEST_WORKSPACE`) in a VS Code that `@vscode/test-electron` downloads, with `--disable-workspace-trust` because extensions do not activate in a restricted workspace, and the suite asserts the extension is active and that `cucumber.node.runCucumber`/`debugCucumber` are registered. It fails if the fixture has not been built (`yarn build` there, so `cucumber-tsflow/lib/version.js` exists) or if cucumber-tsflow is below `minCucumberTsFlowVer`. The harness runs the `tsc` output, not the esbuild bundle, and `tsc` does not emit the plain-JS `src/configuration/importer.js`, so `build:test` copies it into `out/` after compiling; drop that step and activation fails with `Cannot find module './importer'`. TestController items of another extension are not reachable from the API, so running a scenario is still verified in the Extension Development Host; see the skill.
- **A sibling folder `C:\GitHub\cucumber-tsflow-vscode - Copy`** holds an abandoned branch that tried to keep warm worker processes (a `src/runtime/` folder, a `workerCount` setting, `reloadSupport`). That design was dropped: cucumber-tsflow 8.0 made startup fast enough that spawning the CLI once per run is acceptable (the run batches every selected scenario into that process; the opt-in `selectiveLoad` setting can trim what a filtered run loads, but it is off by default because cucumber-tsflow's index skips support files that only set up state at import time, which made `email-profile.feature` fail on its own in the SSWF Vue suite), and 8.0's `loadSupport()`/`reloadSupport()` no longer support being called inside a running suite. Only its test-loading fixes were ported here; don't resurrect the worker pool without a new design.

## Release checklist

1. Bump `version` in [package.json](package.json) and add a section to [CHANGELOG.md](CHANGELOG.md) (headings used so far: Added / Update / Fixed).
2. If the consumer-facing minimum changed, update the two version mentions in [README.md](README.md) (intro and Requirements) and `minCucumberTsFlowVer`.
3. `yarn lint`, `npx tsc -p ./ --noEmit`, then the `verify-extension-host` skill against a real workspace: tests load, a scenario runs, a scenario debugs.
4. `package-vsix` skill: `vsce package --no-dependencies` (the bundle is self-contained; `node_modules` is excluded by [.vscodeignore](.vscodeignore)), install the `.vsix` locally and re-check.
5. Branches are named `dev-MMDD`; PRs target `main`.
