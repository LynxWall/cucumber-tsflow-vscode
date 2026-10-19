---
name: package-vsix
description: Prepare a release build of this extension — check version and CHANGELOG, lint and type-check, produce the `.vsix` with `vsce package --no-dependencies`, inspect its contents, and optionally install it into the user's VS Code for a final check. Use when asked to package, build a VSIX, cut a release or "install the extension locally". Does not publish to the Marketplace.
argument-hint: [--install]
---

# Package the extension as a `.vsix`

The Marketplace artifact is a `.vsix` built by `@vscode/vsce` from the minified esbuild bundle. This repo
has no `vsce` in its devDependencies and uses Yarn 3, which `vsce`'s dependency walker does not understand,
so the invocation has to be exactly as below or packaging fails or ships the wrong files.

Arguments: `$ARGUMENTS` — `--install` also installs the produced file into the user's VS Code (ask first;
see step 5).

## Procedure

### 1. Release metadata

Before building, check and report:

- `version` in [package.json](../../../package.json) is higher than the last published tag
  (`git tag --sort=-v:refname | head -3`, or the top entry of [CHANGELOG.md](../../../CHANGELOG.md)).
- [CHANGELOG.md](../../../CHANGELOG.md) has a `## [<version>]` section at the top describing this release
  (headings in use: `### Added`, `### Update`, `### Fixed`).
- If the minimum consumer version of cucumber-tsflow changed, [README.md](../../../README.md) says so in
  both places it mentions a version (the intro paragraph and Requirements), and
  `minCucumberTsFlowVer` in [src/use-cucumber-tsflow.ts](../../../src/use-cucumber-tsflow.ts) matches.
- `git status --short` is clean apart from the release edits. Packaging an uncommitted working tree is
  fine for a local check but not for the file that gets published.

Stop and say what is missing rather than packaging a release with a stale CHANGELOG.

### 2. Gates

```sh
yarn lint
npx tsc -p ./ --noEmit
```

Both must be clean. `yarn build` alone is not a gate: esbuild does not type-check.

### 3. Package

```sh
npx --yes @vscode/vsce package --no-dependencies
```

- `--no-dependencies` is required. Without it `vsce` runs `yarn list --prod --json`, which Yarn 3 does
  not have, and fails. It is also correct: the bundle in `out/extension.js` is self-contained and
  [.vscodeignore](../../../.vscodeignore) excludes `node_modules`, `src`, maps and `.ts` files.
- `vsce` runs the `vscode:prepublish` script first, which rebuilds `out/extension.js` minified and without
  a sourcemap. After packaging, run `yarn build` again if you want a debuggable bundle for F5.
- Output: `cucumber-tsflow-vscode-<version>.vsix` in the repo root (gitignored).

If `vsce` rejects the README (it refuses SVG images and rewrites relative links to the repository URL)
or the manifest (`engines.vscode` lower than the `@types/vscode` major.minor), fix the cause; do not pass
`--allow-*` flags to silence it.

### 4. Inspect the artifact

```sh
npx --yes @vscode/vsce ls --no-dependencies
```

Expected contents (as of 3.0.0, 14 files): `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`,
`CONTRIBUTE.md`, `.eslintignore`, `images/*` (the icon and the README media), `out/extension.js`. Anything
from `src/`, `node_modules/`, `.vscode/`, `.yarn/`, `.claude/`, `CLAUDE.md`, a `.map` file or `out/test/`
means `.vscodeignore` regressed. Report the sizes; for 3.0.0 the minified bundle was 571 KB and the
`.vsix` 774 KB. `vsce` lists `readme.md`/`changelog.md` in lower case in its own tree output; that is
cosmetic.

### 5. Optional: install locally (`--install`)

This replaces the Marketplace version of the extension in the user's own VS Code until they reinstall
it, so ask before doing it and say that in the question.

```sh
code --install-extension cucumber-tsflow-vscode-<version>.vsix --force
```

Then the user reloads their window and runs the interactive checklist from the `verify-extension-host`
skill against a real project. To go back: `code --uninstall-extension lynxwall.cucumber-tsflow-vscode`
and reinstall from the Marketplace.

### 6. Report

The `.vsix` path and size, the gates that ran, what `vsce ls` showed, and whether it was installed.
Publishing (`vsce publish`, or uploading the file at
https://marketplace.visualstudio.com/manage/publishers/lynxwall) needs the publisher's personal access
token and is the user's step; do not attempt it.
