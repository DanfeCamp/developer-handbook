---
id: key-concepts
title: Key Concepts
sidebar_position: 1
description: package.json, dependency types, SemVer ranges, how resolution and the lockfile actually work, scripts, workspaces and the registry.
---

# Key Concepts

## Introduction

Most npm confusion comes from three things: not knowing which dependency type a
package belongs in, not knowing what a caret range really permits, and not
knowing what the lockfile does that `package.json` does not.

This page covers those, plus the parts of the model — resolution, hoisting,
scripts, workspaces — that explain the behaviour you will otherwise find
arbitrary.

---

## package.json

The manifest. It is the project's identity, its dependency declarations and its
task list, all in one file.

```json title="package.json"
{
  "name": "@acme/checkout",
  "version": "2.4.1",
  "description": "Checkout flow for the Acme storefront",
  "type": "module",
  "license": "MIT",
  "private": false,

  "engines": {"node": ">=24.0.0"},
  "packageManager": "npm@11.13.0",

  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "sideEffects": false,

  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "lint": "eslint ."
  },

  "dependencies": {"zod": "^4.1.0"},
  "devDependencies": {"typescript": "~6.0.3", "vitest": "^4.1.0"},
  "peerDependencies": {"react": ">=19"},
  "peerDependenciesMeta": {"react": {"optional": true}}
}
```

Fields that matter more than they look:

**`type`** — `"module"` means `.js` files are ES modules; omitting it means
CommonJS. This one line determines whether `import` works. Set it on every new
project.

**`exports`** — declares your public entry points and _blocks deep imports_ into
your internals. Without it, consumers can import `your-pkg/dist/internal/thing`
and you can never refactor. With it, only what you list is reachable. It
supersedes the old `main`/`module`/`browser` trio; keep `main` alongside it only
for very old tooling.

**`files`** — an allowlist of what gets published. Without it you will
eventually publish your tests, fixtures and `.env.example`. `npm pack --dry-run`
shows exactly what would ship.

**`sideEffects: false`** — tells bundlers that importing your modules does
nothing observable, which lets them
[tree-shake](/knowledge-base/general/how-code-runs#bundling-minification-and-tree-shaking)
unused exports. Wrong if your package imports CSS or registers a polyfill; use
an array of the files that do have effects.

**`private: true`** — makes publishing impossible. Put it on every application
and every monorepo root. It is the cheapest protection against an accidental
`npm publish`.

---

## Dependency Types

Getting these wrong causes bloated production images and mysterious peer
warnings.

| Field                  | Installed for consumers?  | Use for                                   |
| ---------------------- | ------------------------- | ----------------------------------------- |
| `dependencies`         | Yes                       | Code that runs at runtime                 |
| `devDependencies`      | No                        | Build tools, test runners, linters, types |
| `peerDependencies`     | No — but required present | A host your plugin integrates with        |
| `optionalDependencies` | Yes, failure tolerated    | Platform-specific extras                  |
| `bundleDependencies`   | Bundled into the tarball  | Very rare; vendoring inside the package   |

The test for `dependencies` versus `devDependencies` is simple: **does this code
execute in production?** TypeScript is a devDependency even though the whole
codebase is written in it, because what ships is compiled JavaScript. A logging
library is a dependency.

Two exceptions worth knowing. In a **server application that builds in CI**, the
distinction is really about what your production image needs to install — a
smaller install is a smaller attack surface. In a **framework that compiles at
runtime**, some tools legitimately move to `dependencies`.

### peerDependencies

A peer dependency says: _"I work with this, but the consumer must install it, and
we must both use the same copy."_ This is how plugins avoid the disaster of two
React instances in one application.

```json
{
  "peerDependencies": {"react": ">=19"},
  "peerDependenciesMeta": {"react": {"optional": true}},
  "devDependencies": {"react": "^19.2.0"}
}
```

Note the pattern: React is a **peer** so consumers supply it, and _also_ a
**dev** dependency so your own tests can run. Use wide ranges for peers —
`>=19`, not `^19.2.0` — because a narrow peer range forces upgrades on everyone
who depends on you.

npm installs missing peers automatically (since npm 7), which is convenient but
occasionally installs a version you did not want. `npm ls react` shows what you
actually got.

---

## SemVer and Ranges

Every version is `MAJOR.MINOR.PATCH`. Ranges express how much future change you
will accept without review.

| Range           | Matches          | Notes                                   |
| --------------- | ---------------- | --------------------------------------- |
| `4.2.1`         | exactly 4.2.1    | Pinned                                  |
| `~4.2.1`        | `>=4.2.1 <4.3.0` | Patches only                            |
| `^4.2.1`        | `>=4.2.1 <5.0.0` | Patches and minors — npm's default      |
| `^0.4.2`        | `>=0.4.2 <0.5.0` | **Caret behaves differently below 1.0** |
| `^0.0.3`        | `>=0.0.3 <0.0.4` | Effectively pinned                      |
| `>=4.2.1`       | anything newer   | Unbounded — avoid in published packages |
| `4.x` / `4.*`   | any 4.y.z        | Same as `^4.0.0`                        |
| `*` or `latest` | anything         | Never do this                           |

The `0.x` behaviour is the part people miss. Below 1.0 the author has not
committed to stability, so npm treats the **minor** as the breaking position.
`^0.4.2` will not upgrade you to `0.5.0`.

### Pin, or use ranges?

- **Applications:** use caret ranges in `package.json` and rely on the lockfile
  for exact pinning. You get security patches when you deliberately update, and
  reproducibility in between.
- **Libraries:** use caret ranges too, and as wide as you can honestly support.
  Pinning an exact version in a library forces duplicate copies into every
  consumer's tree.

Pinning exact versions in an application's `package.json` is a common instinct
and usually redundant — the lockfile already guarantees the exact tree. It just
means every patch bump becomes a manual edit.

---

## Resolution and the Lockfile

### What resolution has to do

Your dependencies have dependencies, and they disagree. Package A wants
`lodash@^4.17.0`; package B wants `lodash@^4.17.21`. npm builds a tree that
satisfies everyone:

- Where ranges **overlap**, one copy is installed and shared.
- Where they **conflict** (`^4` and `^5`), npm installs both — one hoisted to
  the top of `node_modules`, the other nested inside the package that needs it.

This is why `node_modules` has thousands of directories, and why two copies of
the same library can coexist. It is also why "which version am I actually
running?" is a real question, answered by `npm ls <package>`.

### Hoisting, and the bug it hides

npm flattens the tree, placing dependencies at the top level of `node_modules`
wherever possible. Node's resolution algorithm walks up directories, so anything
hoisted is importable from anywhere.

The consequence: **you can `import` a package you never declared** and it works
— until a dependency drops it and your application breaks with no change on your
side. This is a _phantom dependency_, and it is the strongest argument for pnpm,
whose symlinked layout makes undeclared imports fail immediately.

### The lockfile

`package.json` says "^4.2.1". `package-lock.json` says "exactly 4.2.7, from this
URL, with this integrity hash, and here is the complete tree".

```json title="package-lock.json (excerpt)"
"node_modules/zod": {
  "version": "4.1.8",
  "resolved": "https://registry.npmjs.org/zod/-/zod-4.1.8.tgz",
  "integrity": "sha512-…",
  "engines": {"node": ">=18"}
}
```

The `integrity` hash is a supply-chain control: if the tarball's contents ever
differ from what was recorded, the install fails. That is what makes a lockfile
a security artefact and not merely a performance one.

**Always commit it.** Without it, two installs a week apart can produce different
trees, and "works on my machine" becomes literally true.

### `npm install` vs `npm ci`

|                         | `npm install`             | `npm ci`                       |
| ----------------------- | ------------------------- | ------------------------------ |
| Reads                   | `package.json` + lockfile | Lockfile only                  |
| May update the lockfile | Yes                       | Never — errors if out of sync  |
| Existing `node_modules` | Reuses                    | Deletes first                  |
| Speed                   | Slower                    | Faster                         |
| Use in                  | Development               | **CI, Docker builds, deploys** |

Using `npm install` in CI defeats the point of having a lockfile — CI may
resolve a newer version than you tested. `npm ci` is the correct command in
every automated context.

---

## Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "validate": "npm run typecheck && npm run lint && npm run test",
    "prepare": "husky"
  }
}
```

Mechanics worth knowing:

- **`node_modules/.bin` is on the PATH.** Inside a script, `vitest` resolves to
  the local binary — no global install, no `npx`.
- **`pre` and `post` hooks run automatically.** A `prebuild` script runs before
  `build` with no wiring. Useful, but easy to forget exists when debugging.
- **`npm start` and `npm test` need no `run`.** Everything else does.
- **Arguments pass through after `--`:** `npm run test -- --watch`.
- **`prepare`** runs after `npm install` in the project and before publishing —
  the standard place to install Git hooks or build a library from source.

Two lifecycle scripts deserve caution. **`postinstall` runs automatically on
every install**, including for anyone who installs your package. It is
convenient for you and the main mechanism by which malicious packages execute
code. Avoid it in published packages, and consider `--ignore-scripts` for
untrusted installs.

### Cross-platform scripts

`rm -rf dist && NODE_ENV=production node build.js` fails on Windows. Use
portable tools:

```json
{
  "scripts": {
    "clean": "rimraf dist",
    "build": "cross-env NODE_ENV=production node build.js"
  }
}
```

Or move anything non-trivial into a `.mjs` script and run it with `node`. Shell
one-liners in `package.json` stop being readable at about 80 characters anyway.

---

## Workspaces

npm's built-in monorepo support: several packages in one repository, one
lockfile, one `node_modules`.

```json title="package.json (repository root)"
{
  "name": "acme",
  "private": true,
  "workspaces": ["packages/*", "apps/*"]
}
```

```bash
npm install                                   # installs every workspace
npm install lodash -w packages/utils          # add a dep to one workspace
npm install @acme/utils -w apps/web           # link one workspace into another
npm run build -w packages/utils               # run a script in one
npm run test --workspaces --if-present        # run it everywhere it exists
```

Local packages are **symlinked**, so a change in `packages/utils` is immediately
visible in `apps/web` with no build-and-publish cycle.

The main limitation compared with pnpm workspaces or Turborepo is task
orchestration: npm has no dependency-aware task graph and no caching, so
`--workspaces` runs scripts in sequence whether or not they depend on each
other. For a handful of packages that is fine; beyond that, add Turborepo or Nx
on top, or use pnpm.

---

## The Registry

`registry.npmjs.org` is the default. Each package is a set of immutable
versioned tarballs plus metadata.

**Scopes** namespace packages: `@acme/utils`. They are how you avoid name
collisions, and scoped packages are private by default when published to a paid
org — publish a public one explicitly with `--access public`.

**Dist-tags** are named pointers to versions. `latest` is what `npm install pkg`
resolves to; `next` and `beta` are conventions for pre-releases.

```bash
npm dist-tag ls react
npm install react@next
```

**Unpublishing is heavily restricted** — broadly, only within 72 hours and only
if nothing depends on it. This is deliberate, and dates from the 2016 `left-pad`
incident, when one unpublished 11-line package broke a large part of the
ecosystem. Use `npm deprecate` instead, which warns installers without breaking
them.

---

## Do's and Don'ts

### Do

- Set `"type": "module"` and `"private": true` on new projects.
- Use `exports` and `files` in anything you publish.
- Keep build tools in `devDependencies`.
- Use wide `peerDependencies` ranges.
- Commit the lockfile; use `npm ci` everywhere automated.
- Run `npm ls <pkg>` when you are unsure which version is installed.

### Don't

- Don't pin exact versions in `package.json` and call it reproducibility — that
  is the lockfile's job.
- Don't import a package you have not declared, even though hoisting allows it.
- Don't add a `postinstall` script to a published package.
- Don't use `npm install` in CI.
- Don't mix package managers in one repository.
- Don't assume `^0.4.2` will pick up `0.5.0` — it will not.

---

## FAQ

**Why are there two copies of the same package?**
Because two dependents asked for incompatible ranges. `npm ls <pkg>` shows who
asked for what; `overrides` can force a single version if they are actually
compatible.

**What is the difference between `dependencies` and `devDependencies` if I bundle everything?**
For a bundled front end, less than you might think — but it still documents
intent, keeps `npm audit` focused on shipped code, and makes production installs
smaller for anything server-side.

**Do I need `main` if I have `exports`?**
Only for tooling that predates `exports`. New packages can use `exports` alone.

**Can I stop `postinstall` scripts running?**
`npm install --ignore-scripts`, or `ignore-scripts=true` in `.npmrc`. Some
packages with native components genuinely need them, so this is a per-project
decision.

**What does `npm audit` actually check?**
Your installed tree against the GitHub Advisory Database. It reports what is
_present_, not what is _reachable_ — a vulnerability in a build tool's
dependency may not be exploitable in production at all.

---

## Check your understanding

<Quiz
question="Your CI pipeline runs `npm install` before the test suite. What is the risk?"
options={[
{
text: 'install may resolve newer versions and rewrite the lockfile, so CI tests a different tree than the one you committed',
correct: true,
why: 'npm install treats package.json as authoritative and may update the lockfile to satisfy it. npm ci installs strictly from the lockfile and fails if the two disagree.',
},
{
text: 'None — install and ci behave identically when a lockfile exists',
why: 'They differ in the essential respect: ci never modifies the lockfile and deletes node_modules first, guaranteeing a clean, exact tree.',
},
{
text: 'It will fail if node_modules already exists',
why: 'install reuses an existing node_modules. It is ci that deletes it first.',
},
{
text: 'It skips devDependencies, so the tests cannot run',
why: 'Both install devDependencies by default; --omit=dev is what excludes them.',
},
]}
explanation={<>Use <code>npm ci</code> in CI, Docker builds and deploys. It is also meaningfully faster, because it skips resolution entirely.</>}
reference={{label: 'install vs ci', href: '/knowledge-base/npm/key-concepts#npm-install-vs-npm-ci'}}
/>

<Quiz
question="A dependency is declared as `^0.4.2`. Version `0.5.0` is released. Does `npm update` install it?"
options={[
{
text: 'No — below 1.0.0 the caret treats the minor as the breaking position, so it allows only 0.4.x',
correct: true,
why: '^0.4.2 resolves to >=0.4.2 <0.5.0. Pre-1.0 authors have not committed to stability, so npm assumes any minor bump may break.',
},
{
text: 'Yes — the caret allows all minor and patch updates',
why: 'True at 1.0.0 and above. Below 1.0.0 the rule shifts down one position.',
},
{
text: 'Yes, but only with --force',
why: 'The range simply does not include 0.5.0. Installing it requires editing package.json.',
},
{
text: 'Only if the lockfile is deleted first',
why: 'The lockfile pins within the declared range; it cannot widen the range.',
},
]}
explanation={<>The same logic applies again at <code>^0.0.3</code>, which permits only <code>0.0.3</code> — effectively a pin.</>}
reference={{label: 'SemVer and ranges', href: '/knowledge-base/npm/key-concepts#semver-and-ranges'}}
/>

<Quiz
question="Which of these belong in `devDependencies` for a Node API server that is compiled in CI and deployed as a Docker image?"
type="multiple"
options={[
{text: 'typescript', correct: true, why: 'Compiles at build time. The image runs the emitted JavaScript.'},
{text: 'vitest', correct: true, why: 'Tests run in CI, never in production.'},
{text: 'express', why: 'Runs in production on every request — a runtime dependency.'},
{text: '@types/node', correct: true, why: 'Type definitions are erased at compile time and do not exist at runtime.'},
{text: 'pino (the logger)', why: 'Executes at runtime on every log line.'},
]}
explanation={<>The single question to ask: does this code execute in the deployed artefact? TypeScript and its types do not, however central they are to how the project is written.</>}
reference={{label: 'Dependency types', href: '/knowledge-base/npm/key-concepts#dependency-types'}}
/>

<Quiz
question="Your code does `import chalk from 'chalk'` and it works, but `chalk` is not in your package.json. Why, and what will eventually happen?"
options={[
{
text: 'A dependency of a dependency was hoisted to the top of node_modules; when that package drops or moves chalk, your build breaks with no change on your side',
correct: true,
why: 'This is a phantom dependency. Node resolution walks up directories, so anything hoisted is importable from anywhere — until the tree changes.',
},
{
text: 'npm automatically installs any package you import',
why: 'npm has no visibility into your source code. It installs only what is declared.',
},
{
text: 'chalk is a Node built-in',
why: 'It is a third-party package. Built-ins are importable as node:fs and similar.',
},
{
text: 'The lockfile added it as a direct dependency',
why: 'A lockfile records the resolved tree; it never adds direct dependencies of its own.',
},
]}
explanation={<>Fix it by declaring what you import. pnpm's symlinked layout prevents the whole class of problem by making undeclared imports fail immediately — the strongest single argument for switching.</>}
reference={{label: 'Hoisting', href: '/knowledge-base/npm/key-concepts#hoisting-and-the-bug-it-hides'}}
/>

<Quiz
question="You maintain a React component library. Which declaration is correct for React?"
options={[
{
text: 'peerDependencies: ">=19", plus react in devDependencies for your own tests',
correct: true,
why: 'A peer means the consumer supplies React and both of you share one copy — essential, because two React instances in one app break hooks. The devDependency lets your test suite run.',
},
{
text: 'dependencies: "^19.2.0"',
why: 'Your library would bring its own React, producing two instances in the consumer app and breaking hooks and context.',
},
{
text: 'peerDependencies: "^19.2.0"',
why: 'Right field, but the range is too narrow: a strict peer range forces upgrades on every consumer and causes resolution conflicts.',
},
{
text: 'devDependencies only',
why: 'Consumers get no signal that React is required, and no warning if they are on an incompatible major.',
},
]}
explanation={<>The pattern — wide peer range plus a matching devDependency — is standard for every plugin-style package.</>}
reference={{label: 'peerDependencies', href: '/knowledge-base/npm/key-concepts#peerdependencies'}}
/>

---

## References

- [package.json field reference](https://docs.npmjs.com/cli/configuring-npm/package-json)
  — every field, authoritatively.
- [Node.js: Package entry points](https://nodejs.org/api/packages.html#package-entry-points)
  — how `exports` and conditional exports resolve.
- [node-semver](https://github.com/npm/node-semver) — the exact range grammar,
  including the pre-1.0 caret rule.
- [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) — the
  built-in monorepo support.
- [npm scripts and lifecycle](https://docs.npmjs.com/cli/using-npm/scripts) —
  hook ordering and the full lifecycle list.
