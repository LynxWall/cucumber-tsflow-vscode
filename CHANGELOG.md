# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

Please see [CONTRIBUTING.md](CONTRIBUTE.md) on how to contribute to cucumber-tsflow-vscode.

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
