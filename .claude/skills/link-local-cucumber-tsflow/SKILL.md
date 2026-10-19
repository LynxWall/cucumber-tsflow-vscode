---
name: link-local-cucumber-tsflow
description: Point this extension's `@lynxwall/cucumber-tsflow` devDependency at the local library checkout in `C:\GitHub\cucumber-js-tsflow` (a Yarn `portal:` protocol entry) so the bundle is built from an unreleased library, verify the link resolves and the bundle builds, and undo it afterwards. Use when a library change is not published yet, when asked to "link" or "use the local" cucumber-tsflow, or to remove such a link.
argument-hint: [library-repo-path] [--undo]
---

# Build the extension against the local cucumber-tsflow

The extension bundles three helpers and one type from `@lynxwall/cucumber-tsflow/lib/...` at build time
(see `CLAUDE.md`, "Two cucumber-tsflow version numbers"). When those modules move or change before a
release, the only way to build and type-check against them is to resolve the devDependency to the local
checkout. This skill does that with Yarn 3's `portal:` protocol and undoes it cleanly.

Arguments: `$ARGUMENTS` — the library repo root. Default to `C:\GitHub\cucumber-js-tsflow` and say so. The
package itself is the `cucumber-tsflow/` workspace inside it. `--undo` restores the registry dependency.

## Two sides of "testing against the local library"

| Side | What resolves the library | Covered by |
|---|---|---|
| Build time (what esbuild bundles, what `tsc` type-checks) | This repo's `node_modules/@lynxwall/cucumber-tsflow` | this skill |
| Run time (the CLI the extension spawns per scenario) | The **opened workspace's** `node_modules/@lynxwall/cucumber-tsflow` | the workspace you open in `verify-extension-host`; the library monorepo already symlinks its own build, a pnpm consumer needs the library's `pnpm-link-consumer` skill |

Linking here changes nothing about which CLI a consumer runs.

## Why `portal:` and not `link:` (verified)

- `portal:` makes `node_modules/@lynxwall/cucumber-tsflow` a symlink to `<repo>/cucumber-tsflow` **and**
  installs that package's declared dependencies into this repo's `node_modules`.
- `link:` symlinks too but ignores the target's dependencies. That breaks here, because this extension
  imports `@cucumber/gherkin` and `@cucumber/messages` directly ([src/gherkin/gherkin-feature.ts](../../../src/gherkin/gherkin-feature.ts))
  without declaring them; they are only present because Yarn hoists them from cucumber-tsflow's
  dependency tree. With `link:` they vanish and both `yarn build` and `tsc` fail with
  `Cannot find module '@cucumber/messages'`. Tried on 2026-10-17; `portal:` built and type-checked clean.
- The hoisting has a side effect worth knowing: with `portal:` the library's own `typescript`, `esbuild`
  and `glob` ranges compete with this repo's for the top-level slot. The two repos are kept on the same
  majors (TypeScript 5.9, esbuild 0.25, glob 11) so that nothing changes; if one repo moves ahead, check
  `node -e "console.log(require('typescript/package.json').version)"` after linking.
- The linked build is a **build and type-check test, not a packaging test**: `vsce package` would still
  bundle from the symlink, which is fine for a local `.vsix` but never for a release. Release from a
  published version.

## Procedure

### 1. Inspect before touching anything

From this repo:

- `git status --short package.json yarn.lock` — if either already has uncommitted edits, note it; the undo
  step must not blindly check them out. Save copies to the scratchpad when they do:
  `cp package.json <scratch>/package.json.bak; cp yarn.lock <scratch>/yarn.lock.bak`.
- `grep -n 'cucumber-tsflow"' package.json` — the current range (a registry range like `^8.0.0`, or an
  existing `portal:`).
- From the library repo: `git -C <repo> status --short | head` and
  `node -e "console.log(require('<repo>/cucumber-tsflow/package.json').version)"` so the report can say
  what was linked.

### 2. Build the library

`yarn build` in the library repo root (never bare `tsc` there; its `CLAUDE.md` explains why). `lib/` must
exist with `lib/runtime/utils.js`, `lib/utils/helpers.js`, `lib/runtime/managed-scenario-context.d.ts`
and `lib/version.js`, which are what this repo imports.

### 3. Add the portal

Compute the relative path from this repo root to `<repo>/cucumber-tsflow` with forward slashes (for the
default location it is `../cucumber-js-tsflow/cucumber-tsflow`), then:

```sh
yarn add -D "@lynxwall/cucumber-tsflow@portal:../cucumber-js-tsflow/cucumber-tsflow"
```

Yarn 3 rewrites `package.json` and `yarn.lock` and prints `YN0072: The application uses portals and
that's why --preserve-symlinks Node option is required`. Ignore it: esbuild and `tsc` resolve the symlink
to its real path, which is what we want. Both files are now modified and **must not be committed**.

### 4. Verify

All four, and report them:

```sh
grep -n 'cucumber-tsflow"' package.json                                  # portal: with forward slashes
ls -la node_modules/@lynxwall/                                           # symlink -> the library checkout
node -e "console.log(require('./node_modules/@lynxwall/cucumber-tsflow/package.json').version)"
yarn build && npx tsc -p ./ --noEmit                                     # bundle and type-check against it
```

The version printed must equal the one built in step 2. If `tsc` fails on a `.d.ts` inside the library,
that is a real incompatibility between the library's types and this repo's TypeScript version; report it
rather than loosening `strict`.

### 5. Report and remind

Tell the user the exact `portal:` line, the verified version and commit of the library, that
`package.json` and `yarn.lock` are modified and must not be committed, and that from now on the loop is
`yarn build` in the library, then `yarn build` here.

## Undo (`--undo`)

1. `git diff package.json yarn.lock` — inspect. If `package.json` carries unrelated local edits, restore
   the copies saved in step 1 (or put the original range back by hand on the `@lynxwall/cucumber-tsflow`
   line only) instead of checking the file out.
2. Otherwise `git checkout -- package.json yarn.lock`.
3. `yarn install`.
4. Verify `node_modules/@lynxwall/cucumber-tsflow` is a real directory again (`ls -la node_modules/@lynxwall/`)
   and prints the registry version, then `yarn build` so `out/` is from the registry package again.

## Known facts

- This repo pins Yarn 3.2.0 through `.yarnrc.yml` (`yarnPath`), so `yarn` here is Yarn 3 regardless of the
  global install; `yarn add` syntax is Yarn 3's.
- A library change that adds a new runtime import to one of the three bundled modules works here because
  `portal:` installs the library's dependencies. The same import in a published version is a dependency of
  the library, so nothing changes for consumers.
- Keep the path relative and forward-slashed; Yarn on Windows misbehaves with spaces or backslashes in
  protocol paths.
