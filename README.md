# Cucumber TsFlow for VS Code

This extension provides Run and Debug support for [cucumber-tsflow ![](images/external-link-16.png)](https://www.npmjs.com/package/@lynxwall/cucumber-tsflow) **v6.0.2** or greater in VS Code.

## Features

The latest release of this extension provides both Test Explorer and Code Lens support in VS Code to support running and debugging Scenarios using cucumber-tsflow.

Support for multiple cucumber-tsflow test projects. This extension will look for all cucumber configuration files and create separate run/debug profiles for each configuration that it finds. When a configuration has multiple profiles the Test Explorer will choose the "default" profile as the default. If a "default" profile is not found the first profile found will become the default. 

The test explorer lists all features, grouped by project (configuration), along with associated scenarios with support to run or debug all scenarios in a feature or specific scenarios.

Code Lens support adds Run and Debug commands to each Given, When, Then step found in a Cucumber step file. In addition, RunAll and DebugAll commands are added to classes in a step file that are annotated with a @binding decorator.

The following animation shows multiple projects with multiple profiles in each project (cucumber configuration). In addition, the animation demonstrates debugging one of the steps from the Test Explorer.

![Run or Debug cucumber-tsflow](images/CucumberVscode.gif)

The execution of Cucumber tests is accomplished by referencing a feature or a scenario within a Cucumber Feature file.  When a step definition file is opened in VS Code, this extension will map the steps it finds with features and scenarios that you have defined. 

### Hooks (beforeAll, before, beforeStep, afterAll, after, afterStep)

This extension **does not** add Code Lens actions to cucumber-tsflow hooks. However, you can add ***breakpoints*** to code in a hook step and then ***Debug*** a scenario that should invoke the hook.

### Additional Features

- Support for "multi-root" or "monorepo" projects. When  a workspace with .feature files is loaded this extension will search for the first node_modules folder that contains cucumter-tsflow. From there, it will look for all cucumber configuration files and initialize a new test profile in the Test Explorer for each configuration found.
- Uses [cucumber configuration ![](images/external-link-16.png)](https://github.com/cucumber/cucumber-js/blob/v8.0.0/docs/configuration.md) profiles to execute tests in cucumber-tsflow. You can specify the profile to use in your tests through VS Code settings. The default configuration uses the `default` profile, or first one found if `default` isn't defined, in your cucumber configuration.

## Future Releases

This first release focuses on providing run/debug support in step files using Code Lens in VS Code. Planned future releases will include the following:

- Code snippet generation - Currently cucumber-tsflow will generate code snippets in the terminal output when not able to find matching code for a step. This update will provide the ability to generate complete step definition files for a feature or snippets for scenarios and steps.

## Requirements

This extension requires [cucumber-tsflow ![](images/external-link-16.png)](https://www.npmjs.com/package/@lynxwall/cucumber-tsflow) version **6.0.2** or higher.

## Extension Settings

This extension should support most projects with it's default configuration. However, several configuration settings have been provided to support different project structures and cucumber configurations.

Settings for this extension all start with `cucumber-tsflow` and would normally be added to a ***settings.json*** file in your workspace under the `.vscode` folder. You can also add cucumber-tsflow settings to your global user settings.

For example, if you wanted to disable the CodeLens feature you would add the following to ***settings.json***:

`"cucumber-tsflow.disableCodeLens": true`

This extension contributes the following settings:

| Setting                   | Type    | Default                               | Description                                                  |
| ------------------------- | ------- | ------------------------------------- | ------------------------------------------------------------ |
| `configFile`              | string  |                                       | Cucumber config file (relative to cucumber-tsflow.projectPath e.g. './test/cucumber.json') |
| `projectPath`             | string  |                                       | Absolute path to project directory where packages.json and node_modules are found (e.g. /home/me/project/sub-folder) |
| `runOptions`              | array   |                                       | Add [CLI Options ![](images/external-link-16.png)](https://github.com/LynxWall/cucumber-js-tsflow#new-configuration-options) to the Cucumber-tsflow Command. (e.g. ['--backtrace', 'true']) |
| `debugOptions`            | object  |                                       | Add or overwrite vscode debug configurations (only in debug mode) (e.g. { \"args\": [\"--no-cache\"] }) |
| `disableCodeLens` | boolean | false | Disable Code Lens feature |
| `preserveEditorFocus`     | boolean | false                                 | Preserve focus on editor when running tests                  |

## Change Log

See the Change Log [here ![](images/external-link-16.png)](CHANGELOG.md)

## Issues

Submit [issues ![](images/external-link-16.png)](https://github.com/LynxWall/cucumber-tsflow-vscode/issues) if you find any bug or have any suggestions.

## Enjoy!
