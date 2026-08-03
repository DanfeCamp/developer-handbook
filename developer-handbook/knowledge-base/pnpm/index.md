---
title: "pnpm"
description: "A fast, disk-efficient package manager for Node.js — the content-addressable store, the strict node_modules layout, workspaces, and pnpm 11's new supply-chain defaults."
---

# pnpm

## Introduction

pnpm installs every version of every package **once** into a global
content-addressable store and hard-links it into projects, instead of copying
it. That is where the name comes from — _performant npm_.

Two things follow from that design, and the second matters more than the first.

**Disk and speed.** Ten projects using the same React version share one copy on
disk. Installs are largely link operations rather than downloads and extractions,
so a warm install is dramatically faster than npm's.

**Strictness.** pnpm's `node_modules` is _not_ flat. A package can only import
what it declared. npm hoists everything to the top level, which means your code
can `import` a package you never listed and it works — until a dependency drops
it and your build breaks with no change on your side. pnpm makes that fail
immediately. For most teams this correctness property is the real reason to
switch.

:::note Versions
Written against **pnpm 11** (April 2026), which requires Node 22+, ships as pure
ESM, moved most configuration out of `.npmrc`, and turned on two significant
supply-chain defaults. If you are upgrading from pnpm 10, read
[Migrating to pnpm 11](#migrating-to-pnpm-11) before anything else.
:::

---

## Core Concepts

### The content-addressable store

```text
~/.local/share/pnpm/store/          ← one copy of every package version, ever

project-a/node_modules/
  .pnpm/
    react@19.2.0/node_modules/react/   ← hard-linked from the store
    lodash@4.17.21/node_modules/lodash/
  react -> .pnpm/react@19.2.0/node_modules/react   ← symlink
```

Only packages listed in your `package.json` get a symlink at the top level of
`node_modules`. Everything else lives inside `.pnpm/`, reachable only by the
packages that declared it.

Because store entries are hard links, a second project using the same version
costs approximately zero additional disk.

pnpm 11 replaced the store's millions of small JSON index files with a **single
SQLite database** (store v11), which noticeably speeds up store operations on
machines with a lot of cached packages.

### Strict resolution, and phantom dependencies

```js
// package.json declares only "express"
import express from 'express'; // ✅ works everywhere
import chalk from 'chalk'; // ❌ fails under pnpm, works under npm
```

Under npm, `chalk` may be hoisted to the top of `node_modules` because something
else depends on it, so the import resolves. That is a **phantom dependency** —
an undeclared import that works by accident. pnpm's layout makes it fail at
once, which is the point.

When a dependency itself has phantom-dependency bugs, you can relax the rule
rather than abandon the model:

```yaml title="pnpm-workspace.yaml"
publicHoistPattern:
  - '@types/*' # hoist all type packages
  - 'eslint-plugin-*' # legacy plugin resolution
```

`shamefully-hoist: true` reproduces npm's flat layout entirely. The name is
deliberate. Use it only as a temporary bridge during migration.

---

## Installation & Setup

```bash
# Standalone installer — the recommended route
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Or via Corepack, which ships with Node
corepack enable pnpm

# Or via npm
npm install -g pnpm

pnpm --version   # 11.x
node --version   # must be >= 22
```

Pin it for the team so everyone resolves identically:

```json title="package.json"
{
  "packageManager": "pnpm@11.2.0",
  "engines": {"node": ">=22"}
}
```

### Configuration moved in pnpm 11

This is the change most likely to catch you out. **`.npmrc` is now for
authentication and registry settings only.** Every pnpm-specific setting moved:

```yaml title="pnpm-workspace.yaml — project settings"
packages:
  - 'packages/*'
  - 'apps/*'

# Settings that used to live in .npmrc
publicHoistPattern:
  - '@types/*'
minimumReleaseAge: 1440
allowBuilds:
  esbuild: true
  sharp: true
```

```ini title=".npmrc — auth and registry only"
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
@acme:registry=https://npm.pkg.github.com
```

Global settings now live in `~/.config/pnpm/config.yaml`, and environment
variables use the `pnpm_config_*` prefix rather than `npm_config_*`.

---

## Basic Usage

The CLI is close enough to npm that most commands transfer directly.

```bash
pnpm install                  # install everything (alias: pnpm i)
pnpm install --frozen-lockfile  # CI: fail if the lockfile is out of date
pnpm ci                       # pnpm 11: clean install, like npm ci

pnpm add zod                  # dependencies
pnpm add -D vitest            # devDependencies
pnpm add -O sharp             # optionalDependencies
pnpm add -g some-cli          # global
pnpm add zod@4.1.8            # a specific version

pnpm remove zod
pnpm update                   # within declared ranges
pnpm update --latest          # cross major boundaries
pnpm outdated

pnpm run build                # run a script
pnpm build                    # `run` is optional for non-conflicting names
pnpm exec tsc --noEmit        # run a binary from node_modules/.bin
pnpm dlx create-vite@latest   # download, run, discard (npx equivalent)

pnpm why zod                  # who depends on this
pnpm licenses list
pnpm audit
pnpm sbom                     # pnpm 11: software bill of materials
pnpm store status             # is the store consistent
pnpm store prune              # remove unreferenced packages
pnpm clean                    # pnpm 11: remove node_modules and caches
```

**`--frozen-lockfile` is the default in CI** when pnpm detects a CI environment,
but state it explicitly anyway — a pipeline that silently updates the lockfile
defeats the point of having one.

---

## Workspaces

pnpm's monorepo support is its second major advantage over npm, and the reason
many teams adopt it.

```yaml title="pnpm-workspace.yaml"
packages:
  - 'packages/*'
  - 'apps/*'
  - '!**/test/**'
```

```bash
pnpm install                          # install every workspace, link them together
pnpm add lodash --filter @acme/utils  # add a dep to one package
pnpm add @acme/utils --filter web --workspace   # link a local package
pnpm --filter web dev                 # run a script in one package
pnpm -r build                         # recursively, in dependency order
pnpm -r --parallel dev                # all at once
```

### Filtering

The `--filter` syntax is genuinely powerful and worth learning:

```bash
pnpm --filter @acme/api test              # one package
pnpm --filter "./apps/**" build           # by path
pnpm --filter @acme/utils... build        # utils AND everything that depends on it
pnpm --filter ...@acme/web build          # web AND everything it depends on
pnpm --filter "[origin/main]" test        # only packages changed since main
```

That last one is the important one for CI: run tests only for packages touched
by the branch, rather than the whole monorepo on every push.

### Workspace protocol

```json
{
  "dependencies": {
    "@acme/utils": "workspace:*",
    "@acme/config": "workspace:^"
  }
}
```

`workspace:` guarantees the local package is used rather than a same-named one
from the registry — which prevents an entire class of confusing bug. On publish,
pnpm rewrites it to the real version number.

### Catalogs

Define a version once and reference it everywhere, so a monorepo cannot drift
into three React versions:

```yaml title="pnpm-workspace.yaml"
catalog:
  react: ^19.2.0
  typescript: ~6.0.3
```

```json title="packages/ui/package.json"
{
  "dependencies": {"react": "catalog:"}
}
```

Upgrading React across twenty packages then means editing one line.

Unlike npm workspaces, pnpm runs recursive scripts in **dependency order**, so
`pnpm -r build` builds `utils` before the app that imports it. For task caching
on top of that, add Turborepo or Nx.

---

## Security

pnpm 11 changed two defaults that make it the most conservative mainstream
package manager on supply chain, and they are the strongest single reason to
choose it in 2026.

**`minimumReleaseAge` defaults to 1440 minutes (one day).** A package version
published less than a day ago will not be installed. Most malicious releases are
detected and pulled within hours, so this converts the majority of registry
compromises into a non-event. Override per package when you genuinely need a
fresh release:

```yaml title="pnpm-workspace.yaml"
minimumReleaseAge: 1440
minimumReleaseAgeExclude:
  - '@acme/*' # your own packages
```

**`blockExoticSubdeps` is on by default**, rejecting transitive dependencies
that resolve to a Git URL or tarball rather than a registry version — a common
shape for injected malicious dependencies.

**Install scripts are opt-in.** pnpm does not run `postinstall` for dependencies
unless you allow them:

```yaml title="pnpm-workspace.yaml"
allowBuilds:
  esbuild: true
  sharp: true
  '@parcel/watcher': true
```

In pnpm 11 this unified mapping replaces the older `onlyBuiltDependencies` and
`neverBuiltDependencies` settings. Lifecycle scripts are the primary execution
vector for malicious packages, so an allowlist is exactly the right default.

```bash
pnpm audit --prod
pnpm sbom --format cyclonedx > sbom.json
```

See [npm best practices](/knowledge-base/npm/best-practices#security) for the
broader supply-chain picture, all of which applies here too.

---

## Migrating to pnpm 11

From npm or Yarn:

```bash
pnpm import          # generate pnpm-lock.yaml from package-lock.json / yarn.lock
rm -rf node_modules package-lock.json
pnpm install
pnpm run build       # then fix what breaks
```

Expect two categories of breakage, both of which are pnpm surfacing real
problems:

1. **Missing dependencies.** Something imported a package it never declared.
   Declare it. This is the correctness win.
2. **Packages needing build scripts.** `sharp`, `esbuild`, `better-sqlite3` and
   similar will not build until listed under `allowBuilds`.

From pnpm 10, additionally:

- Move every non-auth setting out of `.npmrc` into `pnpm-workspace.yaml`.
- Replace `onlyBuiltDependencies`/`neverBuiltDependencies` with `allowBuilds`.
- Rename any `npm_config_*` environment variables to `pnpm_config_*`.
- Ensure CI runs Node 22 or later.
- Expect the new `minimumReleaseAge` default to block just-published versions —
  including, occasionally, your own.

---

## Do's and Don'ts

### Do

- Pin the version with `packageManager` and enforce it via Corepack.
- Use `--frozen-lockfile` (or `pnpm ci`) in CI.
- Use `workspace:*` for internal packages.
- Use catalogs to keep shared dependency versions aligned.
- Use `--filter "[origin/main]"` in CI to test only what changed.
- Keep `allowBuilds` an explicit allowlist.
- Fix undeclared imports rather than hoisting around them.

### Don't

- Don't set `shamefully-hoist: true` permanently.
- Don't keep pnpm settings in `.npmrc` on pnpm 11 — they are ignored.
- Don't commit more than one lockfile.
- Don't disable `minimumReleaseAge` globally to unblock one package; exclude
  that package.
- Don't assume `node_modules/.pnpm` is safe to hand-edit — it is generated
  structure.

---

## Debugging

| Symptom                                           | Cause and fix                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Cannot find module 'x'` after migrating from npm | A phantom dependency. Add `x` to `package.json` — pnpm is correct here.            |
| A package fails at runtime after install          | Its build script was skipped. Add it to `allowBuilds`.                             |
| `ERR_PNPM_OUTDATED_LOCKFILE` in CI                | `package.json` changed without installing. Run `pnpm install` and commit the lock. |
| A just-published version will not install         | `minimumReleaseAge`. Wait, or add the package to `minimumReleaseAgeExclude`.       |
| A setting in `.npmrc` has no effect               | pnpm 11 reads only auth/registry from `.npmrc`. Move it to `pnpm-workspace.yaml`.  |
| A tool cannot find its plugins                    | Strict layout. Add a `publicHoistPattern` entry for that plugin namespace.         |
| Store looks corrupt                               | `pnpm store status`, then `pnpm store prune`.                                      |
| Native module built for the wrong platform        | Don't copy `node_modules` between machines or into a Docker image.                 |

---

## FAQ

**Is pnpm a drop-in replacement for npm?**
Almost. The CLI maps closely, and `pnpm import` converts the lockfile. What
breaks is undeclared imports — which is the feature, not a defect.

**Does the strict layout break anything real?**
Occasionally, with older tools that expect a flat layout. `publicHoistPattern`
handles those cases without abandoning strictness elsewhere.

**pnpm or npm?**
pnpm for monorepos, for many projects on one machine, and for its supply-chain
defaults. npm when you want zero setup and a single application.

**Can I use pnpm with Docker?**
Yes. Use `pnpm fetch` to populate the store from the lockfile alone, before
copying source — it gives an even better cache layer than copying manifests.

**What about Bun?**
Faster still, and it bundles a runtime and test runner. pnpm is the more
conservative choice today; Bun's package manager alone can be used with Node.

**Do I still need Turborepo?**
pnpm handles linking, filtering and dependency-ordered execution. Turborepo and
Nx add task-level caching and remote caching, which start to matter at larger
scale.

---

## Check your understanding

<Quiz
question="After migrating a project from npm to pnpm, the build fails with `Cannot find module 'chalk'`. The code imports chalk, and it is not in package.json. What is the correct fix?"
options={[
{
text: 'Add chalk to package.json — the import was a phantom dependency that npm hoisting silently permitted',
correct: true,
why: 'npm flattens node_modules, so a transitive dependency was importable by accident. pnpm’s strict layout surfaces the missing declaration, which was a latent bug all along.',
},
{
text: 'Set shamefully-hoist: true to restore npm’s layout',
why: 'It makes the error go away by reproducing the flat layout, and leaves the undeclared dependency in place to break later when the transitive dependent drops it.',
},
{
text: 'Add chalk to publicHoistPattern',
why: 'Also a workaround. Hoisting is for tools that genuinely cannot cope with strict layout, not for your own missing declarations.',
},
{
text: 'Run pnpm install --force',
why: 'Reinstalling changes nothing: the package is not declared, so it will not be linked at the top level.',
},
]}
explanation={<>This is the main reason to adopt pnpm. Every one of these failures is a real dependency your project was relying on without declaring — a build that could break on any unrelated upgrade.</>}
reference={{label: 'Strict resolution', href: '/knowledge-base/pnpm#strict-resolution-and-phantom-dependencies'}}
/>

<Quiz
question="On pnpm 11, a version published two hours ago refuses to install. Nothing is wrong with the package. Why?"
options={[
{
text: 'minimumReleaseAge defaults to 1440 minutes, so versions younger than a day are not installed',
correct: true,
why: 'pnpm 11 turned this on by default as a supply-chain control: most malicious releases are detected and pulled within hours, so a one-day delay neutralises the majority of registry compromises.',
},
{text: 'The registry has not finished propagating the release', why: 'npm registry propagation is effectively immediate, and would not produce a consistent refusal.'},
{text: 'blockExoticSubdeps is rejecting it', why: 'That setting rejects transitive dependencies resolving to Git URLs or tarballs, not fresh registry versions.'},
{text: 'The lockfile needs regenerating', why: 'A stale lockfile produces an outdated-lockfile error, not a refusal to install a specific new version.'},
]}
explanation={<>Add the package to <code>minimumReleaseAgeExclude</code> rather than disabling the setting globally — your own internal packages are the usual legitimate exception.</>}
reference={{label: 'Security', href: '/knowledge-base/pnpm#security'}}
/>

<Quiz
question="Which pnpm features specifically address monorepo problems that npm workspaces does not?"
type="multiple"
options={[
{text: 'Recursive scripts run in dependency order', correct: true, why: 'pnpm -r build builds a shared package before the app importing it. npm --workspaces runs in sequence with no dependency awareness.'},
{text: 'Catalogs, defining a shared dependency version once for every package', correct: true, why: 'Prevents a monorepo drifting into several React versions, and makes an upgrade a one-line change.'},
{text: 'Filtering by changed packages, e.g. --filter "[origin/main]"', correct: true, why: 'Lets CI test only the packages a branch touched instead of the entire repository.'},
{text: 'The workspace: protocol', correct: true, why: 'Guarantees the local package is used rather than a same-named registry package.'},
{text: 'Symlinking local packages so edits are visible immediately', why: 'Real and useful, but npm workspaces does this too — it is not a differentiator.'},
]}
explanation={<>Dependency-ordered execution and catalogs are the two that most often decide the choice. Task-level caching still needs Turborepo or Nx on top.</>}
reference={{label: 'Workspaces', href: '/knowledge-base/pnpm#workspaces'}}
/>

<Quiz
question="You upgrade from pnpm 10 to pnpm 11 and several settings in .npmrc stop taking effect. Why?"
options={[
{
text: 'pnpm 11 reads only authentication and registry settings from .npmrc; everything else moved to pnpm-workspace.yaml or ~/.config/pnpm/config.yaml',
correct: true,
why: 'The configuration split is one of pnpm 11’s deliberate breaking changes. Settings left in .npmrc are simply ignored, with no error.',
},
{text: '.npmrc must be renamed to .pnpmrc', why: 'No such file. Project settings live in pnpm-workspace.yaml.'},
{text: 'The settings need a pnpm. prefix now', why: 'The change is which file they live in, not their naming.'},
{text: 'pnpm 11 requires all configuration on the command line', why: 'Configuration files are fully supported — just different ones.'},
]}
explanation={<>The related change is that environment variables moved from <code>npm_config__</code> to <code>pnpm_config__</code>, which bites CI pipelines that set options that way.</>}
reference={{label: 'Migrating to pnpm 11', href: '/knowledge-base/pnpm#migrating-to-pnpm-11'}}
/>

<Quiz
question="After installing, `sharp` throws at runtime saying its native binary is missing. Installation reported no errors. What happened?"
options={[
{
text: 'pnpm did not run sharp’s install script, because build scripts are opt-in via allowBuilds',
correct: true,
why: 'Lifecycle scripts are the main execution vector for malicious packages, so pnpm requires an explicit allowlist. Packages with native components need an entry.',
},
{text: 'The package is corrupt in the store', why: 'That would fail the integrity check at install time with a clear error.'},
{text: 'sharp is incompatible with pnpm’s symlinked layout', why: 'sharp works fine under pnpm once its build step is allowed to run.'},
{text: 'minimumReleaseAge installed an older version', why: 'It would install an older version successfully; it does not skip build steps.'},
]}
explanation={<>Add <code>sharp: true</code> under <code>allowBuilds</code> in <code>pnpm-workspace.yaml</code>. The prompt pnpm prints during install lists exactly which packages wanted to run scripts.</>}
reference={{label: 'Security', href: '/knowledge-base/pnpm#security'}}
/>

---

## References

- [pnpm documentation](https://pnpm.io/) — CLI, settings and workspace features.
- [pnpm 11 release notes](https://pnpm.io/blog/releases/11.0) — the breaking
  changes and new defaults described above.
- [pnpm workspaces](https://pnpm.io/workspaces) — filtering, the `workspace:`
  protocol and catalogs.
- [pnpm motivation](https://pnpm.io/motivation) — the store and strict-layout
  rationale.
- [npm](/knowledge-base/npm) — shared concepts: `package.json`, SemVer ranges,
  lockfiles.
