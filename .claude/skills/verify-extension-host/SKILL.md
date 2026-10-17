---
name: verify-extension-host
description: Launch this extension in an Extension Development Host window of the user's installed VS Code against a real workspace from the command line, then read the extension's `Cucumber TsFlow` output channel and the extension-host log back from VS Code's log folder to prove it activated, passed the cucumber-tsflow version gate and found the projects. Use after any change under `src/`, before saying the extension "works", and whenever a user reports the Test Explorer is empty or Code Lens is missing.
argument-hint: [workspace-path]
---

# Verify the extension in an Extension Development Host

`yarn test` runs a placeholder suite and `yarn build` only bundles; neither tells you whether the extension
activates, passes the version gate, discovers projects or shows tests in a real window. The only evidence
is a running Extension Development Host. This skill opens one as a new window of the **user's own,
already configured VS Code** (the same thing F5 does, minus the debugger), points it at a workspace, and
reads the result back from VS Code's log files so the activation side can be checked from the shell.
Running or debugging a scenario still needs a person to click, so the skill ends with a short checklist
to hand to the user.

**Never pass `--user-data-dir`, `--profile` or `--extensions-dir`.** A separate user-data directory makes
VS Code behave like a fresh install: welcome pages, sign-in and Copilot prompts, none of the user's
settings or extensions. The user does not want that. The Extension Development Host must run inside
their normal installation, with their settings.

Arguments: `$ARGUMENTS` — the workspace folder to open. Default to the library repo
`C:\GitHub\cucumber-js-tsflow` and say so: after `yarn build` there, its eight spec workspaces under
`cucumber-tsflow-specs/` each have a `cucumber.json` and feature files, and the repo root has a
`node_modules/@lynxwall/cucumber-tsflow` symlink to the local build, so the extension finds everything it
needs. A real consumer (e.g. `C:\Git\Azure\uis-tools\Tools.Web\VueApp`) is the better test for pnpm
layouts and large suites.

## What the workspace needs

- At least one `*.feature` file anywhere under it (the activation event is `workspaceContains:**/*.feature`).
- `node_modules/@lynxwall/cucumber-tsflow` at the workspace root or below it, built (`lib/version.js` must
  exist), at or above the `minCucumberTsFlowVer` in [src/use-cucumber-tsflow.ts](../../../src/use-cucumber-tsflow.ts).
- At least one `cucumber.{js,cjs,mjs,json,yaml,yml}` outside `node_modules`.
- `node` on `PATH` that satisfies the installed cucumber-tsflow (8.x needs Node 22 or later), because runs
  spawn `node <bin>` with the Extension Host's environment.

Check these with `ls` and `node -e "console.log(require('<ws>/node_modules/@lynxwall/cucumber-tsflow/lib/version').version)"`
before launching. A missing piece produces an empty Test Explorer with no error, which is the symptom this
skill exists to explain.

## Procedure

### 1. Build the bundle

From this repo: `yarn build`. It must succeed and produce `out/extension.js`. Do not use `yarn build:test`
for this; it replaces `out/` with unbundled `tsc` output.

### 2. Tell the user, then launch

Say that a new VS Code window (an Extension Development Host) is about to open in their VS Code, on which
workspace. Then:

```powershell
$launch = Get-Date
code --extensionDevelopmentPath=C:\GitHub\cucumber-tsflow-vscode --new-window <workspace>
```

`code` hands the request to the running VS Code instance (or starts it) and returns at once; the window
appears a few seconds later with the orange "Extension Development Host" title. `--new-window` keeps it
from reusing a window that already has the folder open. Do not add `--disable-extensions` unless the user
asks: the F5 launch config does not, and their other extensions are part of the environment the extension
ships into.

### 3. Wait for activation and read the logs

The installed VS Code writes logs under `$env:APPDATA\Code\logs\<session>\window<N>\exthost\`. The new
window gets the next `window<N>` folder of the current session (or a new session folder if VS Code was not
running). Pick the output channel file written **after** the launch time so you never read a stale run:

```powershell
$logs = "$env:APPDATA\Code\logs"
$log = $null
foreach ($i in 1..30) {
  $log = Get-ChildItem $logs -Recurse -Filter "*Cucumber TsFlow.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $launch } | Sort-Object LastWriteTime | Select-Object -Last 1
  if ($log -and (Get-Content $log.FullName | Select-String "now active|requires cucumber-tsflow")) { break }
  Start-Sleep -Seconds 2
}
if ($log) { $log.FullName; Get-Content $log.FullName } else { "no Cucumber TsFlow output channel written since $launch" }
$exthost = if ($log) { Join-Path $log.Directory.Parent.FullName "exthost.log" }
if ($exthost -and (Test-Path $exthost)) { Get-Content $exthost | Select-String "cucumber-tsflow-vscode|rror" | Select-Object -First 30 }
```

Read the files in this order:

| File | What it tells you |
|---|---|
| `output_logging_<ts>\<n>-Cucumber TsFlow.log` | The extension's own output channel. A healthy activation has exactly two lines: `Using cucumber-tsflow version: <v>` and `Cucumber TsFlow for VS Code is now active!`. A version-gate refusal prints `requires cucumber-tsflow version "<min>" or higher` instead, and nothing is registered. `Duplicate scenario found` lines appear when the Test Explorer tree is built. |
| `exthost.log` in the same `window<N>\exthost\` folder | Activation itself: `ExtensionService#_doActivateExtension lynxwall.cucumber-tsflow-vscode` and, on failure, `Activating extension 'lynxwall.cucumber-tsflow-vscode' failed` with the stack. An exception thrown from `activate()` (a bad config file, an import that no longer exists in the bundled cucumber-tsflow) shows up here and nowhere in the UI. |
| `window<N>\renderer.log` | Only when the host itself misbehaves (a crash, a failed workspace load). |

No `Cucumber TsFlow.log` newer than the launch after 60 seconds means the extension never activated:
either no `.feature` file is in the workspace or the newest `exthost.log` holds the error. Say which.

### 4. Hand the user the interactive checks

The Test Explorer and Code Lens cannot be driven from the shell. Ask the user, in the window that opened:

1. Testing view: one `Cucumber - <folder>` controller per config file, features under each, scenarios under
   each feature. Note any controller that is missing or empty.
2. Profile picker (the `...` menu, Select Default Profile): one `Run - <profile>` and one
   `Debug - <profile>` per profile in that config.
3. Run one scenario: the Test Results terminal shows `Executing Scenario: <title>`, the cucumber output, and
   a `Passed!`/`Failed!` line; the item gets its icon.
4. Debug one scenario with a breakpoint in a step: the breakpoint hits, the debug session is named
   `Attach Cucumber-tsflow Debug`, and the item still gets a result when the session ends.
5. Open a step file: Run and Debug lenses above each `@given`/`@when`/`@then`, RunAll/DebugAll above the
   `@binding` class; clicking Run executes the scenarios that use that step.
6. Save a feature file after editing a scenario title: the tree updates without reload.

Report which of these the user confirmed and which were not exercised. Only steps 1 and 2 can be inferred
from the logs, and only partially (activation and version, not the tree).

### 5. Leave the window to the user

The host is a window of the user's own VS Code. Do not kill `Code.exe` processes to close it; ask the user
to close the window when they are done with the checklist, or leave it open for the next rebuild.

## Known facts

- The host runs the bundle in `out/extension.js`. After a code change, `yarn build`, then
  `Developer: Reload Window` in the host window picks up the new bundle; a relaunch is not needed.
- The extension resolves `projectPath` to the shallowest `node_modules/@lynxwall/` under the first workspace
  folder. In the library monorepo that is the repo root (a symlink to `cucumber-tsflow/`), which is why
  `lib/` must be built there first.
- Spec workspaces in the library repo have profiles that intentionally fail (`broken`, `missing-import`,
  `before-all-throws`, `syntax-error`); pick `esnode`/`tsnode`/`basic` for a green run.
- The output channel file is created lazily on the first `appendLine`, so it does not exist until the
  version gate has run. Its number prefix (`1-`, `2-`) is the channel creation order in that host window.
- Measured on the library fixture (8 spec workspaces): the `now active` line is on disk about 10 seconds
  after `code` returns.
- `exthost.log` prints `Extension 'lynxwall.cucumber-tsflow-vscode' uses a document selector without scheme`
  on every activation. That is the Code Lens `DocumentFilter` built from bare glob patterns and is
  informational, not a failure.
