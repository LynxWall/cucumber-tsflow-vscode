# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

Please see [CONTRIBUTING.md](CONTRIBUTE.md) on how to contribute to cucumber-tsflow-vscode.

## [3.0.0]

### Added

- One cucumber-tsflow process per run instead of one per scenario. Running a feature, a selection or the whole suite now pays the support-code startup once; on a Vue project with 96 support files a nine-scenario feature went from about a minute to seven seconds. Results are read from cucumber's message stream (`--format message`), so every scenario still gets its own result and duration, and a failing step reports its error message with a link to the step in the feature file.
- Each example of a Scenario Outline is its own test item under the outline, at the line of its table row and labelled with the example's title (plus the row's values when the title has no `<placeholder>`), so the Test Explorer counts and reports examples the way the CLI does instead of folding them into one item per outline. Running the outline runs all of its examples through one `<feature>:<line>`; a single example can be run or debugged on its own. Test items now carry their line in the feature file, which enables the run and debug icons in the gutter of feature files and `Test: Run Test at Cursor`.
- A run that covers every feature of a configuration passes no paths to the CLI, so cucumber expands the profile's `paths` itself and runs the features in the same order as `cucumber-tsflow -p <profile>` from a terminal; a filtered run passes its features sorted the same way. cucumber runs explicit paths in the order given, and in an order-dependent suite a different order shows up as failures that the command line does not have.
- `cucumber-tsflow.selectiveLoad` (default `true`) passes `--selective-load`, cucumber-tsflow 8.0's selective loading, on filtered runs, so they load only the support files the selected scenarios use; a run of every feature leaves it off, since it loads everything anyway and the index work only costs time. Set it to `false` to leave the decision to the cucumber profile.

### Update

- Now depends on version 8.0.0 or higher of cucumber-tsflow, which requires Node.js 22 or later. The extension is built against @lynxwall/cucumber-tsflow 8.0.1, whose helper modules moved from `lib/cucumber` to `lib/runtime`. 8.0.1 also fixes the lowercase-drive-letter failure (`instance of Cucumber that isn't running (status: PENDING)`) in the library itself; the extension keeps passing paths with an uppercase drive letter for projects still on 8.0.0, and the minimum supported version stays 8.0.0. Projects still on cucumber-tsflow 7.x should stay on extension version 2.3.0.
- cucumber-tsflow 8.0 writes its own output (configuration lines, startup progress, notices) to stderr. That output is now shown in the Test Results view for both run and debug; only the lines the Node inspector prints when debugging are filtered out. Previously all of stderr was dropped during a debug run.
- Toolchain: TypeScript 5.9, esbuild 0.25, glob 11 and Node 22 types.

### Fixed

- Loading tests when a cucumber profile does not define `paths` or `require`. Previously a profile missing either setting threw during activation, leaving the Test Explorer empty for every project in the workspace.
- Step files listed under the `import` setting (ES Module projects) now get Code Lens support alongside `require`.
- Two scenarios in a feature whose titles map to the same test id no longer overwrite each other in the Test Explorer. The duplicate is skipped and reported in the `Cucumber TsFlow` output channel.
- Running or debugging a scenario failed with `You're calling functions (e.g. "Given") on an instance of Cucumber that isn't running (status: PENDING)` in projects whose step files are loaded through `import` (seen with pnpm), while the same command worked from a terminal. VS Code reports Windows paths with a lowercase drive letter, which made Node load a second copy of cucumber-tsflow for the step files; the extension now passes every path with an uppercase drive letter.

## [2.3.0]

### Update

- Error messages related to @lynxwall/cucumber-tsflow exit codes. Updated to support new exit codes.
- Now depends on version 2.6.0 or higher of cucumber-tsflow.

## [2.2.2]

### Fixed

- Glob pattern used to look for cucumber config files. Original pattern was finding non config files like cucumber.svg that would cause exceptions attempting to load.

## [2.2.1]

### Fixed

- Support for Isolated node_modules in pnpm monorepos. Updated the projectPath configuration parameter to work with absolute or relative paths. Fixed logic used to find the root installation of cucumber-tsflow.

## [2.2.0]

### Update

- Changed Code Lens commands to use the current Test Profile that's selected in the Test Explorer. If a Test Profile is not selected then the `default` or first profile found in the associated cucumber configuration file will be used.
- Removed the spawning of multiple scenario tests in parallel. This was causing timeout issues with tests that are time sensitive. With this change, executing all tests in a feature or project will execute them one at a time. If needed, you can cancel execution from the Test Explorer commands.
- Updated vscode engine requirement to 1.78.0 (April 2023). This version of vscode adds a command to return currently selected Test Explorer profiles, which allows the execution of code lens commands to use the selected Test Profile.

## [2.1.1]

### Fixed

- Removed unnecessary update calls when a step file is modified.
- Handle glob patterns in cucumber paths or require settings.

## [2.1.0]

### Added

- Group cucumber configurations (projects) into separate Test Run profiles.
- Support for multiple profiles in a cucumber configuration.

### Update

- Removed configuration settings that are no longer needed with refactor to load tests based on information found in cucumber configuration files.

### Fixed

- 2.0.x release did not support a workspace with different types of projects, such as dotnet and node. This update will look for node projects and associated cucumber configurations regardless of other projects in the workspace.

## [2.0.1]

### Update

- Reduce bundle size.
- Removed unused image file.

## [2.0.0]

### Added

- Test Explorer support that lists all of the features with their associated scenarios. With this update you can run and debug tests from the Test Explorer along with code lens support.
- maxFolderDepth - Used to search parent folders for closest matching Cucumber settings file for a step file.

### Update

- Changed how tests are executed. Both the code lens and test explorer use the same code to run tests inside of a spawned child process.
- Running tests will execute scenarios from a feature in parallel. Debugging tests will execute scenarios one at a time.
- Package Updates. This latest version also depends on **cucumber-tsflow** version **6.0.2** or later, which is the version where multiple exit codes were added.
- Test output is now sent to the debug terminal instead of being executed directly within a terminal.
- Changed activation event to look for .feature files in the workspace and only activate if feature files are found.

### Fixed

- Support for Scenario Outlines. Previous versions was not loading Scenario Outline information correctly to execute tests.
- Debugging step files that span multiple feature files. The previous version would only run scenarios in the first feature file found that matches. With this change the code looks for matching scenarios in all of the feature files and will execute multiple features if found.
- Allow spreading steps across multiple step files. Previous version would not recognize tests where given, when and then steps were implemented in different step files. This update fixes that issue.

## [1.0.4]

### Update

- VS Code and other package updates.

## [1.0.3]

### Fixed

- Code Lens not working when workspace opened at root. Updated to always get current project path when checking cucumber-tsflow version.

## [1.0.2]

### Fixed

- Activation wasn't working on install and could fail in other scenarios. Changed how cucumber-tsflow installation is checked to resolve this issue.

## [1.0.1]

### Changed

- Changed activation event to startup.

## [1.0.0]

- Initial release
