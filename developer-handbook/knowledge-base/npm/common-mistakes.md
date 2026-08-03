---
id: common-mistakes
title: Common Mistakes
sidebar_position: 4
description: The npm mistakes that cost the most time — why each happens, what it breaks, and the habit that prevents it.
---

# Common Mistakes

## Introduction

Grouped by where they bite: the lockfile, dependency declarations, security,
scripts and the environment. Each entry covers the cause, the symptom and the
fix.

---

## Lockfile and Install Mistakes

### Running `npm install` in CI

The most consequential mistake on this page, because it is invisible.

`npm install` treats `package.json` as authoritative and may resolve newer
versions than the lockfile records, then rewrite the lockfile. CI therefore
tests a dependency tree that was never committed, and a build can break with no
change to your code — the classic "it passed yesterday" failure.

```bash
npm ci    # installs strictly from the lockfile; errors if it is out of sync
```

`npm ci` is also faster, because it skips resolution entirely.

### Not committing the lockfile

Without it, installs a week apart can produce different trees. "Works on my
machine" becomes literally true, and no one can reproduce a bug reported from
production.

Commit it for applications **and** libraries. For a library it does not affect
consumers, who resolve their own tree, but it makes your CI reproducible.

### Hand-editing a lockfile conflict

Lockfile merge conflicts look like ordinary JSON conflicts and are not. Resolving
one by hand produces a file that describes a tree npm would never generate — and
the damage surfaces much later.

```bash
git checkout --theirs package-lock.json   # or --ours; either is fine
npm install                               # regenerate correctly
git add package-lock.json
```

### Deleting `node_modules` as the first response

`rm -rf node_modules package-lock.json && npm install` does usually work, and it
also discards the pinning that made your build reproducible. The next install
may resolve different versions.

Escalate in order:

```bash
npm ci                # deletes node_modules, reinstalls exactly from lockfile
npm cache verify      # if you suspect cache corruption
rm -rf node_modules && npm ci
# only then consider deleting the lockfile
```

### Mixing package managers

`package-lock.json` and `pnpm-lock.yaml` in one repository guarantees that
someone installs a different tree than CI. Pick one, delete the others, and
enforce it:

```json
{"packageManager": "npm@11.13.0"}
```

---

## Dependency Declaration Mistakes

### Build tools in `dependencies`

TypeScript, ESLint, Vitest and `@types/*` in `dependencies` mean every
production install downloads them, every audit scans them, and every container
image carries them.

The test: **does this code execute in the deployed artefact?** TypeScript does
not — what ships is compiled JavaScript.

```bash
npm uninstall typescript && npm install -D typescript
```

### A library declaring its host as a dependency

A React component library with `"react": "^19.2.0"` in `dependencies` installs
its _own_ copy of React into every consumer. Two React instances in one
application breaks hooks and context in ways that are very hard to diagnose.

```json
{
  "peerDependencies": {"react": ">=19"},
  "devDependencies": {"react": "^19.2.0"}
}
```

Peer so the consumer supplies it; dev so your own tests can run.

### Narrow peer ranges

`"peerDependencies": {"react": "^19.2.0"}` forces every consumer onto 19.2.x and
causes `ERESOLVE` failures for anyone on 19.1. Declare the widest range you can
honestly support — usually `>=19`.

### Assuming `^0.4.2` allows `0.5.0`

Below 1.0.0, the caret treats the **minor** as the breaking position: `^0.4.2`
resolves to `>=0.4.2 <0.5.0`. Many packages sit at 0.x for years, and this
surprises people every time.

### Importing something you never declared

Hoisting flattens `node_modules`, so a transitive dependency is importable from
your code and everything works — until that package updates and drops it. Your
build then breaks with no change on your side.

```bash
npx depcheck    # lists both unused declarations and undeclared imports
```

This class of bug is why pnpm's strict symlinked layout exists.

### Reaching for `--legacy-peer-deps` permanently

It restores npm 6 behaviour of ignoring peer conflicts entirely. Fine as a
one-off unblock; as a standing setting it silences every future incompatibility
too. Prefer a scoped `overrides` entry, which at least records the decision in
`package.json` where a reviewer can see it.

---

## Security Mistakes

### Treating `npm install` as safe

Installing runs the package's `preinstall`, `install` and `postinstall` scripts
with your user's permissions — access to your SSH keys, your cloud credentials
and your environment. This is the primary vector in every large registry
compromise.

```ini title=".npmrc"
ignore-scripts=true
```

Try it, find the handful of packages with native components that genuinely need
scripts, and allow-list those.

### Committing a token in `.npmrc`

```ini
# ❌ never
//registry.npmjs.org/:_authToken=npm_xxxxxxxxxxxx

# ✅ interpolate from the environment
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

If a token has been committed, **revoke it first**, then clean history. See
[Git: committing a secret](/knowledge-base/git/common-mistakes#committing-a-secret).

### Still relying on long-lived publish tokens

npm classic tokens were permanently revoked in December 2025, and granular
tokens now expire after at most 90 days. A CI pipeline built around a
never-expiring token is both broken and, previously, a standing liability.
Migrate to [OIDC trusted publishing](/knowledge-base/npm/npm-commands#publishing-from-ci-with-trusted-publishing).

### `npm audit fix --force` without reading it

`--force` permits major upgrades across your tree. It resolves the advisory and
frequently breaks the build in the same command. Always:

```bash
npm audit fix --dry-run
```

### Typos in `npx`

`npx create-vite` fetches whatever name you type. Typosquatted packages exist
specifically to catch this, and the payload runs immediately. Read the name
before pressing enter, and use `npx --no-install <cmd>` when the tool should
already be local.

### Publishing without checking the file list

Without a `files` allowlist, `npm publish` ships everything not ignored — tests,
fixtures, `.env.example`, screenshots, sometimes real credentials. Published
versions are effectively permanent.

```bash
npm pack --dry-run    # two seconds, prevents a permanent mistake
```

---

## Script and Environment Mistakes

### Shell-specific scripts

```json
{
  "scripts": {
    "clean": "rm -rf dist",                        // fails on Windows
    "build": "NODE_ENV=production node build.js"   // fails on Windows
  }
}
```

Use `rimraf` and `cross-env`, or move the logic into a `.mjs` file run with
`node`.

### Installing CLI tools globally

Global installs drift between machines, are invisible to `package.json`, and
change per Node version under a version manager. The result is a build that
depends on something no one else has.

```bash
npm install -D typescript    # then use it via npm run
npx create-vite@latest       # for one-off scaffolding
```

Global installs are appropriate for genuinely machine-level tools — a version
manager, `pnpm` itself.

### `sudo npm install -g`

An `EACCES` error means npm is trying to write into a system directory. `sudo`
fixes the symptom and leaves root-owned files in your cache that break later
installs. Use a version manager, which puts the global prefix somewhere you own.

### Not pinning the Node version

A project that works on Node 24 and fails on Node 20 will eventually meet
someone on Node 20.

```json
{"engines": {"node": ">=24.0.0"}}
```

```ini title=".npmrc"
engine-strict=true
```

Plus `.nvmrc` so version managers switch on `cd`.

### Copying `node_modules` into a Docker image

Native modules are compiled for the host platform, so an image built this way
either fails to start or fails subtly. Add `node_modules` to `.dockerignore` and
run `npm ci` inside the image.

---

## Debugging

| Symptom                                       | Cause and fix                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ERESOLVE unable to resolve dependency tree`  | Conflicting peer ranges. Fix the real conflict or add a scoped `overrides` entry.        |
| `npm ci` fails: lockfile out of sync          | `package.json` was edited without installing. Run `npm install` and commit the lockfile. |
| `EACCES` on a global install                  | Writing to a system directory. Use a version manager; never `sudo npm`.                  |
| `command not found` for a local binary        | Run via `npm run` or `npm exec`, which add `node_modules/.bin` to the PATH.              |
| Module not found, but it is in `package.json` | Stale tree. `npm ci`.                                                                    |
| Two versions of the same package at runtime   | Conflicting ranges. `npm ls <pkg>` to see who asked; `overrides` to force one.           |
| Works locally, fails in CI                    | `npm install` in CI, or a Node version difference. Use `npm ci` and pin `engines`.       |
| Works locally, fails in Docker                | Case-sensitive filesystem, or copied `node_modules`. `.dockerignore` it.                 |
| Lockfile churns with no dependency change     | Different npm versions across the team. Pin `packageManager`.                            |

```bash
npm ls <pkg>            # what is installed, and where
npm explain <pkg>       # why it is installed at all
npm install --verbose   # full resolution logging
npm doctor              # environment sanity check
```

---

## Do's and Don'ts

### Do

- Use `npm ci` everywhere automated, and commit the lockfile.
- Regenerate lockfile conflicts rather than editing them.
- Keep build tools in `devDependencies`.
- Declare hosts as wide `peerDependencies`.
- Run `npm pack --dry-run` before publishing.
- Pin Node and npm with `engines` and `packageManager`.
- Read `npm audit fix --dry-run` before applying.

### Don't

- Don't run `npm install` in CI.
- Don't delete the lockfile as a first debugging step.
- Don't `sudo npm install -g`.
- Don't commit tokens in `.npmrc`.
- Don't make `--legacy-peer-deps` permanent.
- Don't import packages you have not declared.
- Don't assume a `postinstall` script from a stranger is harmless.

---

## FAQ

**I deleted the lockfile and now the app is broken. What now?**
Restore it from Git — `git checkout HEAD -- package-lock.json` — then `npm ci`.
This is one of the better arguments for committing it.

**Why does the same install differ between two machines?**
Different npm or Node versions, a different platform for optional dependencies,
or one machine using `npm install` where the other used `npm ci`.

**Should I check in `node_modules`?**
No. It is large, platform-specific and generated. The lockfile provides
reproducibility.

**`npm audit` reports vulnerabilities I cannot fix. Now what?**
Determine reachability with `npm explain`. If it is dev-only, schedule it. If it
ships and upstream has not patched, use `overrides` with the fixed version and
test carefully.

**Can I recover an accidentally published version?**
Within 72 hours and only if nothing depends on it. Otherwise `npm deprecate` it
and publish a fixed version. Assume anything published is permanent.

---

## Check your understanding

<Quiz
question="CI has failed with a dependency error, though no one changed package.json. The pipeline runs `npm install`. What is the most likely explanation?"
options={[
{
text: 'npm install resolved a newer in-range version than the lockfile recorded, and that version broke something',
correct: true,
why: 'install may update the lockfile to satisfy package.json, so CI can pick up a release published since your last local install. npm ci installs exactly what is committed.',
},
{
text: 'The npm registry served a corrupted package',
why: 'Possible but rare, and the lockfile integrity hashes would fail the install with a clear error rather than a dependency error.',
},
{
text: 'The lockfile was not committed',
why: 'That would produce a different error, and the question states the pipeline is otherwise unchanged.',
},
{
text: 'node_modules was cached from a previous run',
why: 'A stale cache can cause problems, but it would not introduce a newer dependency version.',
},
]}
explanation={<>This is the single strongest argument for <code>npm ci</code>: it makes the dependency tree a reviewed, committed artefact rather than something re-derived on every run.</>}
reference={{label: 'Running npm install in CI', href: '/knowledge-base/npm/common-mistakes#running-npm-install-in-ci'}}
/>

<Quiz
question="A React component library lists react at caret 19.2.0 under dependencies rather than peerDependencies. What goes wrong for consumers?"
type="single"
options={[
{
text: 'They may end up with two copies of React, which breaks hooks and context',
correct: true,
why: 'If the consumer app resolves a different React version, npm installs both. Hooks rely on module-level state, so two instances fail in confusing ways.',
},
{
text: 'Nothing — npm always deduplicates to a single React',
why: 'It deduplicates only when the ranges overlap. Different majors, or an incompatible resolution, produce two copies.',
},
{
text: 'The library will fail to install',
why: 'It installs fine. The problem appears at runtime, which is what makes it hard to diagnose.',
},
{
text: 'Consumers cannot use React features newer than 19.2',
why: 'The caret range permits newer 19.x. The real problem is duplication, not a version ceiling.',
},
]}
explanation={<>Declare the host as a wide <code>peerDependency</code> and keep a matching <code>devDependency</code> so your own tests still run.</>}
reference={{label: 'Library declaring its host as a dependency', href: '/knowledge-base/npm/common-mistakes#a-library-declaring-its-host-as-a-dependency'}}
/>

<Quiz
question="Which of these are genuinely risky habits rather than merely untidy?"
type="multiple"
options={[
{text: 'Committing an .npmrc containing a literal auth token', correct: true, why: 'The token is in history, in every clone and every fork. Revocation is the only real fix.'},
{text: 'Running npm audit fix --force in an unattended pipeline', correct: true, why: 'It performs major upgrades without review, breaking builds and occasionally changing runtime behaviour silently.'},
{text: 'Typing an npx command from memory without checking the package name', correct: true, why: 'npx fetches and executes whatever name you typed. Typosquatting targets exactly this.'},
{text: 'Keeping @types/node in devDependencies', why: 'Correct placement — type definitions are erased at compile time and never execute.'},
{text: 'Using caret ranges in package.json for an application', why: 'Standard practice. The lockfile provides the exact pinning; the range describes what you are willing to accept on a deliberate update.'},
]}
explanation={<>The first three all end in code executing or credentials leaking. The last two are normal practice that occasionally gets mistaken for a problem.</>}
reference={{label: 'Security mistakes', href: '/knowledge-base/npm/common-mistakes#security-mistakes'}}
/>

<Quiz
question="`npm ls express` shows two versions installed. What does that mean, and what is the right first step?"
options={[
{
text: 'Two dependents requested incompatible ranges, so npm nested one copy; run npm explain to see who asked for what',
correct: true,
why: 'Where ranges overlap npm shares one copy; where they conflict it installs both. Knowing the dependents tells you whether an upgrade or an override resolves it.',
},
{
text: 'The lockfile is corrupt — delete it and reinstall',
why: 'Duplicate versions are normal, expected resolution behaviour, not corruption.',
},
{
text: 'Add express to overrides immediately',
why: 'Overrides may well be the fix, but applying one before knowing who depends on which version is a compatibility guess.',
},
{
text: 'Run npm dedupe with --force',
why: 'dedupe can only collapse copies whose ranges actually overlap. If they conflict, it cannot help — and --force is not the answer to a diagnostic question.',
},
]}
explanation={<>Two copies is only a problem when the package holds state — React, a database driver, an instrumentation library. For a stateless utility it is merely wasted bytes.</>}
reference={{label: 'Debugging', href: '/knowledge-base/npm/common-mistakes#debugging'}}
/>

<Quiz
question="A Dockerfile copies the whole project directory, including node_modules from the developer's Mac, then runs the app on Linux. What breaks?"
options={[
{
text: 'Native modules compiled for macOS/arm64 will not load on Linux, causing runtime failures',
correct: true,
why: 'Packages with native bindings are built for a specific platform and architecture. Add node_modules to .dockerignore and run npm ci inside the image.',
},
{
text: 'Nothing — node_modules is platform independent',
why: 'Pure JavaScript packages are, but anything with a native addon is not.',
},
{
text: 'The image will be smaller but slower',
why: 'It will be larger, and correctness rather than speed is the issue.',
},
{
text: 'npm ci will refuse to run afterwards',
why: 'It would run fine. The failure happens at runtime, when a native module cannot be loaded.',
},
]}
explanation={<>The same reasoning explains why <code>npm ci</code> must run inside the image, and why copying manifests before source is what makes that layer cacheable.</>}
reference={{label: 'Copying node_modules into Docker', href: '/knowledge-base/npm/common-mistakes#copying-node_modules-into-a-docker-image'}}
/>

---

## References

- [npm ci](https://docs.npmjs.com/cli/commands/npm-ci) — exactly how it differs
  from `install`.
- [npm overrides](https://docs.npmjs.com/cli/configuring-npm/package-json#overrides)
  — forcing transitive versions.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) — the
  replacement for long-lived tokens.
- [OpenSSF: npm Best Practices Guide](https://best.openssf.org/npm-best-practices/)
  — supply-chain guidance.
- [node-semver](https://github.com/npm/node-semver) — the pre-1.0 caret rule,
  precisely.
