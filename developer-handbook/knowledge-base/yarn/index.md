---
title: "Yarn"
description: "Yarn Classic vs Yarn Berry, Plug'n'Play, zero-installs, workspaces, constraints and protocols — and how to tell which era a project is using."
---

# Yarn

## Introduction

Yarn arrived in 2016 to fix real npm problems of the time: no lockfile,
non-deterministic installs, and poor performance. npm adopted most of those
ideas, and Yarn responded by rebuilding itself.

**The first thing to establish about any Yarn project is which era it belongs
to**, because they are effectively different tools:

|                  | Yarn 1 ("Classic") | Yarn 2+ ("Berry")                            |
| ---------------- | ------------------ | -------------------------------------------- |
| Status           | Maintenance only   | Actively developed — current line is **4.x** |
| Install location | `node_modules`     | `.yarn/cache` with Plug'n'Play by default    |
| Config           | `.yarnrc`          | `.yarnrc.yml`                                |
| Distribution     | Global install     | Per-project binary, managed by Corepack      |
| Plugins          | None               | A plugin architecture                        |

```bash
yarn --version   # 1.22.x → Classic; 4.x → Berry
ls .yarnrc.yml   # exists → Berry
```

**For new projects, use Yarn 4.** For a Yarn 1 project that works, migrating is
a real piece of work — do it deliberately, not casually.

:::note Versions
Written against **Yarn 4.11** (2026). There is no Yarn 5; the 4.x line is
current. Yarn 1 is in maintenance and receives no new features.
:::

---

## Core Concepts

### Plug'n'Play

Berry's headline idea. Instead of unpacking thousands of files into
`node_modules`, Yarn keeps dependencies as **zip archives** in `.yarn/cache` and
generates a single resolution map, `.pnp.cjs`, that tells Node exactly where
every import lives.

```text
.yarn/cache/
  react-npm-19.2.0-abc123.zip
  lodash-npm-4.17.21-def456.zip
.pnp.cjs                          ← the resolution map
```

What this buys:

- **Installs are near-instant.** No unpacking of a large file tree.
- **Resolution is O(1).** A map lookup instead of walking parent directories
  hunting for `node_modules`.
- **Strictness.** Like pnpm, a package can only import what it declared —
  phantom dependencies fail immediately.
- **Zero-installs become possible** (see below).

What it costs: **compatibility**. Any tool that reads `node_modules` directly
from disk — rather than using Node's resolution API — will not work. That
population has shrunk a lot, but it is not zero. Yarn provides patches for
common offenders via `yarn dlx @yarnpkg/sdks`.

If PnP causes more friction than it saves, switch the linker and keep everything
else Berry gives you:

```yaml title=".yarnrc.yml"
nodeLinker: node-modules
```

This is a completely legitimate configuration, and many large Yarn 4 projects
use it.

### Zero-installs

Because the cache is a handful of zip archives rather than a huge directory
tree, you can commit it:

```gitignore title=".gitignore for zero-installs"
.yarn/*
!.yarn/cache
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/sdks
.pnp.*
```

Cloning then gives a repository that runs with no install step at all — CI has
no install phase, and branch switching never requires a reinstall.

The trade-off is repository size and noisy diffs on every dependency change.
Worth it for a monorepo where install time dominates CI; usually not worth it
for a small project.

---

## Installation & Setup

Berry is **per project**, not global. Corepack, which ships with Node, manages
the version:

```bash
corepack enable

# In a new project
yarn init -2                 # creates .yarnrc.yml and sets packageManager
yarn set version stable      # or a specific version: yarn set version 4.11.0
```

```json title="package.json"
{
  "packageManager": "yarn@4.11.0"
}
```

That field is authoritative: Corepack downloads and uses exactly that version,
so the whole team and CI are identical without anyone installing anything
globally.

```yaml title=".yarnrc.yml"
nodeLinker: pnp # or node-modules
enableGlobalCache: true
compressionLevel: mixed
npmRegistryServer: 'https://registry.npmjs.org'

packageExtensions:
  # Fix a dependency that forgot to declare a peer.
  'some-package@*':
    peerDependencies:
      react: '*'
```

`packageExtensions` is Berry's answer to broken package metadata: patch the
declaration locally instead of disabling strictness globally.

### Editor support with PnP

Because dependencies live in zip files, your editor cannot find TypeScript or
ESLint by walking `node_modules`:

```bash
yarn dlx @yarnpkg/sdks vscode
```

This generates SDK shims so VS Code's TypeScript server resolves through PnP.
Skipping it is the most common reason people conclude "PnP is broken" — the
build works and only the editor is confused.

---

## Basic Usage

```bash
yarn                          # install (equivalent to yarn install)
yarn install --immutable      # CI: fail if the lockfile would change
yarn install --immutable --check-cache   # also verify cache integrity

yarn add zod                  # dependencies
yarn add -D vitest            # devDependencies
yarn add -P react             # peerDependencies
yarn add zod@4.1.8

yarn remove zod
yarn up zod                   # upgrade one package
yarn up '*'                   # upgrade everything within ranges
yarn up -R zod                # also upgrade transitive copies

yarn run build                # run a script
yarn build                    # `run` optional for non-conflicting names
yarn node script.js           # run Node *with* PnP resolution active
yarn dlx create-vite          # download, run, discard (npx equivalent)

yarn why zod                  # who depends on this
yarn info zod                 # registry metadata
yarn npm audit                # advisories
yarn workspaces list
yarn constraints              # enforce repository-wide rules
```

**`yarn install --immutable` is the CI command.** It is the equivalent of
`npm ci`: the install fails if the lockfile would change, so CI can never
silently resolve something different from what you committed.

**`yarn node`** matters under PnP: plain `node script.js` has no PnP resolution
loaded and will fail to find dependencies. Anything invoked through `yarn` gets
it automatically.

---

## Workspaces

```json title="package.json (root)"
{
  "private": true,
  "workspaces": ["packages/*", "apps/*"]
}
```

```bash
yarn workspaces list --tree
yarn workspace @acme/api add zod        # add a dep to one workspace
yarn workspaces foreach -A run build    # run in every workspace
yarn workspaces foreach -Apt run build  # parallel, topological, with progress
yarn workspaces foreach --since run test  # only workspaces changed since main
```

The flags on `foreach` are worth knowing: `-A` all workspaces, `-p` parallel,
`-t` topological (dependency order), `-i` interlaced output. `--since` limits to
what changed, which is how you keep monorepo CI proportional to the diff.

### The workspace protocol

```json
{
  "dependencies": {
    "@acme/utils": "workspace:^"
  }
}
```

Guarantees the local package is used rather than a registry package of the same
name, and is rewritten to a real version on publish.

### Constraints

Yarn's genuinely distinctive monorepo feature: declarative rules enforced across
every workspace.

```prolog title="yarn.config.cjs"
module.exports = {
  constraints({Yarn}) {
    // Every workspace must use the same React version.
    for (const dep of Yarn.dependencies({ident: 'react'})) {
      dep.update('^19.2.0');
    }
    // Every workspace must declare a licence.
    for (const workspace of Yarn.workspaces()) {
      workspace.set('license', 'MIT');
    }
  },
};
```

```bash
yarn constraints          # report violations
yarn constraints --fix    # fix them automatically
```

This solves version drift structurally rather than by review discipline. pnpm's
catalogs address the same problem more simply; Yarn's constraints are more
general.

---

## Protocols and Patching

Yarn's resolution protocols cover cases that otherwise need workarounds:

```json
{
  "dependencies": {
    "@acme/utils": "workspace:^",
    "lodash": "npm:^4.17.21",
    "left-pad": "patch:left-pad@1.3.0#./.yarn/patches/left-pad.patch",
    "my-fork": "github:acme/my-fork#v1.2.0",
    "local-lib": "portal:../local-lib"
  }
}
```

The `patch:` protocol is the one to remember. Fixing a bug in a dependency
without waiting for upstream:

```bash
yarn patch lodash                 # extracts a temporary copy to edit
# … make the change …
yarn patch-commit -s /tmp/xfs-abc/user   # writes .yarn/patches/… and updates package.json
```

The patch is committed to your repository and reapplied on every install. This
is far better than the alternatives — forking, or a `postinstall` script that
edits `node_modules`.

`resolutions` forces a version across the whole tree, equivalent to npm's
`overrides`:

```json
{
  "resolutions": {
    "semver": "^7.5.4",
    "some-package/nested-dep": "1.2.3"
  }
}
```

---

## Migrating

### Yarn 1 to Yarn 4

```bash
corepack enable
yarn set version stable
yarn config set nodeLinker node-modules   # start here — one change at a time
yarn install
```

Migrate in stages. Move to Berry with the `node-modules` linker first, confirm
everything works, and only then consider switching to PnP. Attempting both at
once makes it impossible to tell which change broke what.

Things that will need attention:

- `.yarnrc` → `.yarnrc.yml` (different format, not just a rename).
- The lockfile format changes; `yarn install` converts it.
- `yarn global add` is gone — use `yarn dlx` or a project dependency.
- Some Yarn 1 CLI flags were renamed or removed.

### To or from npm/pnpm

Delete the other lockfile and install; each tool derives its own tree. Expect
the same phantom-dependency failures moving to Yarn PnP as moving to pnpm — and
for the same reason.

---

## Do's and Don'ts

### Do

- Set `packageManager` in `package.json` and use Corepack.
- Use `yarn install --immutable` in CI.
- Run `yarn dlx @yarnpkg/sdks` after enabling PnP, or your editor will lie to
  you.
- Use `yarn node` rather than bare `node` under PnP.
- Use `packageExtensions` to fix broken peer declarations.
- Use `patch:` instead of forking for a small dependency fix.
- Use `constraints` to prevent monorepo version drift.

### Don't

- Don't mix Yarn 1 and Berry commands or documentation.
- Don't commit `.yarn/cache` unless you have chosen zero-installs deliberately.
- Don't switch to PnP and to Berry in the same change.
- Don't use `yarn global add` — it does not exist in Berry.
- Don't have both `yarn.lock` and `package-lock.json` in a repository.
- Don't disable strictness globally for one misbehaving package.

---

## Debugging

| Symptom                                         | Cause and fix                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Editor cannot resolve TypeScript under PnP      | SDKs not generated. `yarn dlx @yarnpkg/sdks vscode`.                                                  |
| A tool fails with "cannot find module"          | It reads `node_modules` directly. Add a `packageExtensions` entry, or set `nodeLinker: node-modules`. |
| `node script.js` fails, `yarn node` works       | PnP resolution is not loaded for a bare `node` invocation. Use `yarn node`.                           |
| `YN0028: The lockfile would have been modified` | `--immutable` in CI with an out-of-date lockfile. Install locally and commit it.                      |
| A peer dependency warning that is not real      | The package's metadata is wrong. Fix it with `packageExtensions`.                                     |
| `yarn` is the wrong version                     | Corepack is not enabled, or `packageManager` is unset. `corepack enable`.                             |
| Repository is very large                        | `.yarn/cache` is committed. Intentional for zero-installs; otherwise gitignore it.                    |
| Yarn 1 commands fail                            | The project is Berry. Check `.yarnrc.yml` and `yarn --version`.                                       |

---

## FAQ

**Yarn, npm or pnpm?**
npm if you want zero setup. pnpm for most monorepos — simpler mental model and
stronger supply-chain defaults. Yarn 4 when you want PnP's speed and strictness,
zero-installs, constraints or the patch protocol.

**Is PnP required to use Yarn 4?**
No. `nodeLinker: node-modules` gives you Berry's tooling with a conventional
layout, and it is a very common configuration.

**Should we adopt zero-installs?**
Only if CI install time is a real problem. It trades repository size and diff
noise for eliminating installs.

**Is Yarn 1 safe to keep using?**
It works, and it receives no new features and only critical fixes. Fine for a
stable project; not a good choice for new work.

**How do I patch a dependency?**
`yarn patch <pkg>`, edit, then `yarn patch-commit -s <dir>`. The patch is
committed and reapplied on every install.

**What replaced `yarn global add`?**
`yarn dlx` for one-off execution, or a project dev dependency. Berry removed
global installs on purpose — they are not reproducible.

---

## Check your understanding

<Quiz
question="A colleague reports that Yarn commands from a tutorial do not work in your project. What should you check first?"
options={[
{
text: 'Which Yarn era the project uses — yarn --version and the presence of .yarnrc.yml',
correct: true,
why: 'Yarn 1 and Yarn Berry differ in configuration format, CLI flags and available commands. Most Yarn confusion is documentation from the wrong era.',
},
{text: 'Whether node_modules needs deleting', why: 'A reasonable reflex generally, but it does not explain commands that do not exist.'},
{text: 'Whether the registry is reachable', why: 'A network problem produces network errors, not unrecognised commands.'},
{text: 'Whether Corepack is enabled', why: 'Worth checking, and it controls which version runs — but the first question is still which era that version belongs to.'},
]}
explanation={<><code>yarn global add</code> is the classic tell: it exists in Yarn 1 and was removed in Berry. Search results are full of Yarn 1 answers.</>}
reference={{label: 'Introduction', href: '/knowledge-base/yarn#introduction'}}
/>

<Quiz
question="After enabling Plug'n'Play, the build passes but VS Code shows 'cannot find module' errors everywhere. What is wrong?"
options={[
{
text: 'The editor SDKs have not been generated, so the TypeScript server cannot resolve through PnP',
correct: true,
why: 'PnP keeps dependencies in zip archives, so an editor that walks node_modules finds nothing. yarn dlx @yarnpkg/sdks vscode installs shims that resolve through PnP.',
},
{text: 'PnP is incompatible with TypeScript', why: 'TypeScript works well under PnP; it is the editor integration that needs the SDK shims.'},
{text: 'node_modules must be regenerated', why: 'Under PnP there is deliberately no node_modules. That is the design.'},
{text: 'The lockfile is corrupt', why: 'A corrupt lockfile would break the build too, and the build is passing.'},
]}
explanation={<>This is the single most common reason teams conclude PnP does not work. The build is fine; only the editor is unaware of how resolution happens.</>}
reference={{label: 'Editor support with PnP', href: '/knowledge-base/yarn#editor-support-with-pnp'}}
/>

<Quiz
question="You need a one-line bug fix in a dependency, and upstream has not responded for months. What is the best approach in Yarn 4?"
options={[
{
text: 'yarn patch the package, make the change, and yarn patch-commit so the patch is stored in the repository and reapplied on install',
correct: true,
why: 'The patch is version-controlled, reviewable, applied deterministically on every install, and trivially removed once upstream fixes the bug.',
},
{
text: 'Fork the package, publish it under a new name and depend on that',
why: 'Works, but you now own a package, its releases and its ongoing merges from upstream — for a one-line change.',
},
{
text: 'Edit the file inside node_modules and add a postinstall script that reapplies the edit',
why: 'Fragile, invisible to review, and it breaks whenever the dependency’s internal file layout changes.',
},
{
text: 'Pin to the last version without the bug',
why: 'Only viable if the bug is a regression, and it blocks every other fix and security patch in later versions.',
},
]}
explanation={<>npm and pnpm users can achieve the same with <code>patch-package</code>. Yarn's version is built in and integrates with the resolution protocols.</>}
reference={{label: 'Protocols and patching', href: '/knowledge-base/yarn#protocols-and-patching'}}
/>

<Quiz
question="Which are genuine trade-offs of adopting zero-installs?"
type="multiple"
options={[
{text: 'CI needs no install step at all', correct: true, why: 'The cache is committed, so a clone is immediately runnable — usually the main motivation.'},
{text: 'Switching branches never requires a reinstall', correct: true, why: 'The correct cache for each branch is part of that branch’s tree.'},
{text: 'Repository size grows substantially', correct: true, why: 'Every dependency archive is committed, and every version ever used stays in history.'},
{text: 'Dependency changes produce large binary diffs', correct: true, why: 'Adding or upgrading a package adds zip files to the diff, which makes review noisier.'},
{text: 'Dependencies no longer need to be declared in package.json', why: 'Declaration is still required — and PnP enforces it more strictly, not less.'},
]}
explanation={<>Zero-installs is a size-for-time trade. It pays off when CI install time dominates, and is usually not worth it for a small project.</>}
reference={{label: 'Zero-installs', href: '/knowledge-base/yarn#zero-installs'}}
/>

<Quiz
question="Your CI pipeline runs `yarn install` and occasionally produces a different dependency tree than developers have locally. What is the fix?"
options={[
{
text: 'Use yarn install --immutable so the install fails rather than modifying the lockfile',
correct: true,
why: 'Equivalent to npm ci. Without it, an install may resolve and rewrite the lockfile, so CI tests a tree nobody committed.',
},
{text: 'Delete yarn.lock before installing in CI', why: 'That guarantees a freshly resolved, unreviewed tree on every run — the opposite of what is wanted.'},
{text: 'Commit .yarn/cache', why: 'Zero-installs does make CI reproducible, but it is a much larger commitment than adding one flag.'},
{text: 'Pin every dependency to an exact version in package.json', why: 'Redundant — the lockfile already pins exactly — and it makes every patch bump a manual edit.'},
]}
explanation={<>Pair it with <code>packageManager</code> in <code>package.json</code> so CI and developers also run the same Yarn version; version differences are the other common source of lockfile churn.</>}
reference={{label: 'Basic usage', href: '/knowledge-base/yarn#basic-usage'}}
/>

---

## References

- [Yarn documentation](https://yarnpkg.com/) — CLI, configuration and features.
- [Plug'n'Play](https://yarnpkg.com/features/pnp) — how resolution works and
  what it is incompatible with.
- [Yarn workspaces](https://yarnpkg.com/features/workspaces) — `foreach`,
  filtering and the workspace protocol.
- [Yarn constraints](https://yarnpkg.com/features/constraints) — enforcing rules
  across a monorepo.
- [Migrating to Yarn Berry](https://yarnpkg.com/migration/guide) — the official
  step-by-step upgrade.
- [npm](/knowledge-base/npm) and [pnpm](/knowledge-base/pnpm) — the
  alternatives, and the shared concepts.
