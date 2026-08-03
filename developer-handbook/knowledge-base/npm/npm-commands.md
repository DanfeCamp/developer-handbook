---
id: npm-commands
title: NPM Commands
sidebar_position: 2
description: A task-oriented npm reference — installing, inspecting, updating, auditing, scripting, workspaces and publishing, with the flags that actually matter.
---

# npm Commands

## Introduction

Organised by task rather than alphabetically. For what the commands operate on —
dependency types, ranges, the lockfile — read
[Key Concepts](/knowledge-base/npm/key-concepts) first.

Examples assume npm 11, which ships with Node 24.

---

## Installing

```bash
npm install                     # install everything in package.json (alias: npm i)
npm ci                          # install strictly from the lockfile — use in CI

npm install lodash              # add to dependencies
npm install -D vitest           # add to devDependencies (alias: --save-dev)
npm install -O sharp            # add to optionalDependencies
npm install -E zod              # save an exact version, no caret
npm install -g pnpm             # install globally

npm install zod@4.1.8           # a specific version
npm install zod@latest          # the latest release
npm install zod@next            # a dist-tag
npm install "zod@>=4 <5"        # a range (quote it — the shell will eat < and >)

npm install ./local-package     # from a path
npm install user/repo           # from GitHub
npm install git+ssh://git@github.com/user/repo.git#v2.1.0
```

Useful install modifiers:

```bash
npm install --omit=dev          # production only (replaces --production)
npm install --ignore-scripts    # do not run lifecycle scripts — safer for untrusted deps
npm install --no-save           # install without touching package.json
npm install --prefer-offline    # use the cache when possible
npm install --dry-run           # report what would change, change nothing
npm install --force             # override conflicts. Rarely correct
```

`--dry-run` before a large upgrade is a habit worth forming: it prints the
resolved changes without writing anything.

---

## Removing and cleaning

```bash
npm uninstall lodash            # remove and update package.json (alias: npm rm)
npm uninstall -g some-cli
npm prune                       # remove packages not in package.json
npm prune --omit=dev            # strip devDependencies from an existing install

npm cache verify                # check and clean the cache
npm cache clean --force         # nuclear option; rarely necessary
rm -rf node_modules package-lock.json && npm install   # last resort
```

That last line is folklore for a reason — it does work — but it also discards a
reproducible tree. Try `npm ci` first: it deletes `node_modules` and reinstalls
from the lockfile, which fixes most corruption without losing pinning.

---

## Inspecting

```bash
npm ls                          # the dependency tree, top level
npm ls --all                    # everything, usually enormous
npm ls zod                      # which versions of zod are installed, and who asked
npm ls --omit=dev               # production tree only

npm explain zod                 # the full dependency path explaining why it is here
npm view react                  # registry metadata for a package
npm view react versions         # every published version
npm view react dist-tags        # latest, next, canary …
npm view react@19.2.0 dependencies

npm outdated                    # what is behind, and what the range allows
npm outdated --long             # …with the reason

npm root -g                     # where global packages live
npm config list                 # effective configuration
npm config list -l              # …including defaults
npm doctor                      # check the environment for common problems
```

**`npm explain`** is the command to remember. When something you never installed
appears in your tree, it prints the chain of dependents that pulled it in — far
more direct than reading `npm ls --all`.

### npm query

A CSS-selector language over the dependency tree, and much sharper than grepping
`npm ls`:

```bash
npm query "#lodash"                    # all instances of lodash
npm query ".prod"                      # production dependencies
npm query ":type(git)"                 # anything installed from git
npm query "[name=zod]:not(.dev)"       # zod, excluding dev
npm query ":outdated(major)"           # dependencies a major version behind
```

Pipe it through `jq` to build reports — for example, every direct dependency
with no repository field.

---

## Updating

```bash
npm outdated                    # see what is available first
npm update                      # upgrade within the ranges in package.json
npm update lodash               # one package, within its range
npm install lodash@latest       # cross a major boundary — edits package.json
```

The distinction that trips people up: **`npm update` never leaves the declared
range.** If `package.json` says `^4.2.1`, `npm update` will reach `4.9.9` and
stop. Reaching `5.0.0` requires `npm install lodash@latest`, which rewrites the
range.

For a big upgrade round, `npx npm-check-updates` (`ncu`) rewrites every range to
the newest available, after which `npm install` applies them. Do it deliberately
and read the changelogs.

---

## Auditing and security

```bash
npm audit                       # known advisories in the installed tree
npm audit --omit=dev            # only what ships to production
npm audit --audit-level=high    # exit non-zero only for high and critical
npm audit fix                   # apply in-range fixes
npm audit fix --dry-run         # preview
npm audit fix --force           # ⚠️ allows breaking major upgrades

npm sbom --sbom-format=cyclonedx > sbom.json   # software bill of materials
```

Two cautions. **`npm audit fix --force` installs major versions**, which can and
does break builds — never run it unattended. And `npm audit` reports what is
_present_, not what is _reachable_: a prototype-pollution advisory in a build
tool's transitive dependency may have no production impact at all. Triage rather
than chasing zero.

### Forcing a transitive version

When a vulnerable package sits three levels down and its parent has not
updated:

```json title="package.json"
{
  "overrides": {
    "semver": "^7.5.4",
    "some-package": {
      "nested-dep": "1.2.3"
    }
  }
}
```

`overrides` rewrites the resolution for everyone in the tree. It works, and it
is a compatibility gamble — you are asserting the new version satisfies a
consumer that never tested against it. Record why, and remove it once upstream
catches up.

---

## Running scripts

```bash
npm run                         # list every script defined
npm run build
npm start                       # shorthand: no `run` needed
npm test                        # likewise
npm run test -- --watch         # pass arguments through

npm run build --workspaces      # every workspace
npm run build --workspaces --if-present   # skip those without the script
npm run build -w packages/utils # one workspace

npm exec -- vitest run          # run a binary from the local tree
npx create-vite@latest my-app   # download, run, discard
```

`npx` fetches the package if it is not installed, so **check the spelling**.
Typosquatted names on the registry exist precisely to catch `npx` typos. Use
`npx --no-install <cmd>` to require that the package is already present locally.

---

## Workspaces

```bash
npm install                                 # installs and links every workspace
npm install lodash -w packages/utils        # add a dependency to one
npm install @acme/utils -w apps/web         # link one workspace into another
npm run test --workspaces --if-present
npm ls --workspaces
npm publish -w packages/utils
```

See [workspaces](/knowledge-base/npm/key-concepts#workspaces) for the layout and
its limits.

---

## Editing package.json safely

```bash
npm pkg get version
npm pkg get scripts
npm pkg set "scripts.lint=eslint ."
npm pkg set type=module
npm pkg delete scripts.postinstall
npm pkg fix                     # correct common metadata problems
```

Prefer `npm pkg set` over `sed` in any script that edits `package.json` — it
parses and re-serialises properly instead of hoping a regex holds.

---

## Versioning and publishing

```bash
npm version patch               # 1.2.3 → 1.2.4, commits and tags
npm version minor               # → 1.3.0
npm version major               # → 2.0.0
npm version 2.1.0-beta.1
npm version prerelease --preid=beta

npm pack                        # build the tarball locally
npm pack --dry-run              # list exactly what would be published

npm publish
npm publish --access public     # required for a first scoped public release
npm publish --tag next          # publish without moving `latest`
npm publish --dry-run

npm deprecate my-pkg@"<2.0.0" "Upgrade to 2.x — 1.x is unmaintained"
npm dist-tag add my-pkg@2.1.0 latest
npm unpublish my-pkg@1.0.1      # heavily restricted; prefer deprecate
```

**Always run `npm pack --dry-run` before your first publish.** It lists the exact
file set, which is how you discover you are about to ship `.env.example`, your
test fixtures and a 40 MB screenshots directory. Fix it with `files` in
`package.json` or an `.npmignore`.

### Publishing from CI with trusted publishing

Long-lived tokens are no longer the recommended path. npm classic tokens were
permanently revoked in December 2025, and granular tokens now expire in at most
90 days. **Trusted publishing** uses OIDC: the registry verifies the identity of
the CI workflow itself, so there is no token to leak.

```yaml title=".github/workflows/publish.yml"
name: Publish
on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write # required — this is what mints the OIDC token

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm test
      - run: npm publish
```

Configure the trusted publisher on the package's npm settings page — repository,
workflow filename and, optionally, environment. Note that configurations created
after 20 May 2026 must explicitly select the allowed actions.

Provenance is attached automatically when publishing this way, giving consumers
a verifiable link from the tarball back to the commit and workflow that produced
it.

---

## Configuration

```bash
npm config get registry
npm config set registry https://registry.npmjs.org/
npm config set @acme:registry https://npm.pkg.github.com   # scoped registry
npm config delete proxy
npm config list -l              # everything, including defaults
```

Configuration resolves in this order, nearest wins: command-line flag →
environment variable (`npm_config_*`) → project `.npmrc` → user `~/.npmrc` →
global → npm defaults.

```ini title=".npmrc"
engine-strict=true
audit-level=high
fund=false
save-exact=false
```

Never commit a token. Interpolate it from the environment:

```ini
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

---

## Cheat Sheet

```bash
# ── Install ─────────────────────────────────────────────
npm ci                        # CI/deploy — exact, from lockfile
npm i                         # dev
npm i -D vitest               # dev dependency
npm i pkg@latest              # cross a major boundary

# ── Inspect ─────────────────────────────────────────────
npm ls pkg                    # which version(s) are installed
npm explain pkg               # why is this here at all
npm outdated                  # what is behind
npm query ":outdated(major)"  # majors available

# ── Maintain ────────────────────────────────────────────
npm update                    # within declared ranges
npm audit --omit=dev          # advisories that reach production
npm audit fix --dry-run       # preview before applying

# ── Scripts ─────────────────────────────────────────────
npm run                       # list them
npm run test -- --watch       # pass args through
npm exec -- tsc --noEmit      # run a local binary

# ── Publish ─────────────────────────────────────────────
npm pack --dry-run            # ALWAYS check the file list first
npm version minor
npm publish                   # via OIDC trusted publishing in CI
```

---

## Common Mistakes

**`npm install` in CI.** It may update the lockfile, so CI tests a tree you never
committed. Use `npm ci`.

**`npm audit fix --force` on autopilot.** It installs major versions and breaks
builds. Always `--dry-run` first.

**Expecting `npm update` to cross a major.** It stays inside the declared range
by design. Use `npm install pkg@latest`.

**Publishing without checking the file list.** `npm pack --dry-run` takes two
seconds and prevents shipping secrets, fixtures and build junk.

**Unquoted ranges in the shell.** `npm i "pkg@>=4 <5"` — without quotes the
shell interprets `<` as a redirect.

**Typos in `npx`.** It installs whatever name you typed. Typosquatted packages
target exactly this.

---

## Debugging

| Symptom                                      | Cause and fix                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ERESOLVE unable to resolve dependency tree` | Conflicting peer requirements. Read the output, fix the real conflict, or use `overrides`. `--legacy-peer-deps` hides it. |
| `EACCES` on a global install                 | Installing globally into a system directory. Use a version manager, never `sudo npm`.                                     |
| `ENOENT` for a package that is installed     | Corrupt tree. `npm ci`.                                                                                                   |
| `command not found` for a local binary       | Run it via `npm run`/`npm exec`, which put `node_modules/.bin` on the PATH.                                               |
| Lockfile churns on every install             | Different npm or Node versions across the team. Pin with `packageManager` and `.nvmrc`.                                   |
| `npm ci` fails: lockfile out of sync         | Someone edited `package.json` without installing. Run `npm install` and commit the lockfile.                              |
| Install hangs                                | Registry or proxy. `npm config get registry`, then `npm install --verbose`.                                               |
| Works locally, fails in Docker               | Case-sensitive filesystem, or `node_modules` copied in. `.dockerignore` it and run `npm ci` in the image.                 |

```bash
npm install --verbose           # full resolution logging
npm config get cache            # where the logs live
npm doctor                      # environment sanity check
```

---

## FAQ

**`npm i` or `npm ci` locally?**
`npm i` while developing, because you are changing dependencies. `npm ci` when
you want to reproduce CI exactly, or after switching branches.

**Is `--legacy-peer-deps` acceptable?**
As a temporary unblock, yes. As a permanent setting, no — it silences a genuine
incompatibility signal. Prefer `overrides`, which at least records the decision
in `package.json`.

**How do I install a package from a private GitHub repo?**
`npm i git+ssh://git@github.com/org/repo.git#v1.2.3`. Pin to a tag; a branch
reference is not reproducible.

**Why is my global install not on the PATH?**
`npm root -g` shows where it went. With a version manager, the global prefix
changes per Node version — reinstall global tools after switching.

**How do I see what a package will run on install?**
`npm view <pkg> scripts` shows its lifecycle scripts before you install.

---

## Check your understanding

<Quiz
question="package.json declares lodash at caret 4.17.10 and the lockfile pins 4.17.15. Version 5.0.0 has been released. What does npm update lodash install?"
options={[
{
text: 'The newest 4.x — the caret range excludes 5.0.0',
correct: true,
why: 'update resolves within the range declared in package.json. Crossing a major requires npm install lodash@latest, which rewrites the range.',
},
{
text: '5.0.0, because update always fetches the newest version',
why: 'That would silently introduce breaking changes. update deliberately respects the declared range.',
},
{
text: 'Nothing, because the lockfile pins 4.17.15',
why: 'update exists precisely to move the lockfile forward within the range.',
},
{
text: '5.0.0, but only after prompting for confirmation',
why: 'npm does not prompt, and it would not cross the range boundary in any case.',
},
]}
explanation={<><code>npm outdated</code> shows all three numbers side by side — current, wanted (range maximum) and latest — which makes the distinction obvious at a glance.</>}
reference={{label: 'Updating', href: '/knowledge-base/npm/npm-commands#updating'}}
/>

<Quiz
question="`npm audit` reports a high-severity advisory in a package you have never heard of. What is the most useful first command?"
options={[
{
text: 'npm explain <package> — to see which dependency chain pulled it in',
correct: true,
why: 'Knowing the dependent tells you whether an upgrade of the parent fixes it, whether an override is safe, and whether the code is even reachable in production.',
},
{
text: 'npm audit fix --force',
why: 'It can install major versions across your tree and break the build. Never the first move.',
},
{
text: 'npm uninstall <package>',
why: 'It is not a direct dependency, so there is nothing to uninstall — a dependency requires it.',
},
{
text: 'Add it to overrides with the patched version',
why: 'Often the eventual fix, but doing it before knowing who depends on it is a guess about compatibility.',
},
]}
explanation={<>Triage before remediation. Many advisories sit in build-time tooling and never reach production; <code>npm audit --omit=dev</code> narrows to what actually ships.</>}
reference={{label: 'Auditing and security', href: '/knowledge-base/npm/npm-commands#auditing-and-security'}}
/>

<Quiz
question="You are publishing a package for the first time. Which steps genuinely reduce risk?"
type="multiple"
options={[
{text: 'npm pack --dry-run to review the exact file list', correct: true, why: 'The reliable way to catch secrets, fixtures and build junk before they become a permanent published artefact.'},
{text: 'A `files` allowlist in package.json', correct: true, why: 'Publishes only what you name, rather than everything not excluded.'},
{text: 'Publishing from CI with OIDC trusted publishing', correct: true, why: 'No long-lived token exists to leak, and provenance is attached automatically. Classic tokens were revoked entirely in December 2025.'},
{text: 'Running npm publish --force to skip the checks', why: 'Skipping validation is the opposite of reducing risk.'},
{text: 'Relying on unpublish to fix a bad release', why: 'Unpublishing is heavily restricted — broadly 72 hours and only if nothing depends on it. Use npm deprecate and publish a fix.'},
]}
explanation={<>A published version is effectively permanent. The two minutes spent on <code>--dry-run</code> and a <code>files</code> list are the highest-value checks available.</>}
reference={{label: 'Versioning and publishing', href: '/knowledge-base/npm/npm-commands#versioning-and-publishing'}}
/>

<Quiz
question="An install fails with `ERESOLVE unable to resolve dependency tree` due to a peer conflict. Which response is best?"
options={[
{
text: 'Read the conflict, then either upgrade the package with the outdated peer range or add a scoped override recording why',
correct: true,
why: 'ERESOLVE reports a real incompatibility. Resolving it — or explicitly overriding with a note — keeps the decision visible in package.json.',
},
{
text: 'Add --legacy-peer-deps to every install permanently',
why: 'It restores npm 6 behaviour of ignoring peer conflicts entirely. Fine as a one-off unblock; as a standing setting it hides every future conflict too.',
},
{
text: 'Run npm install --force',
why: 'Forces a tree npm has determined is invalid, producing failures at runtime instead of install time.',
},
{
text: 'Delete package-lock.json and reinstall',
why: 'The conflict is between declared ranges, not a lockfile artefact. It will reappear immediately.',
},
]}
explanation={<>The valuable property of <code>overrides</code> over <code>--legacy-peer-deps</code> is that it lives in <code>package.json</code>, where a reviewer can see it and a future maintainer can remove it.</>}
reference={{label: 'Forcing a transitive version', href: '/knowledge-base/npm/npm-commands#forcing-a-transitive-version'}}
/>

<Quiz
question="Which command tells you why a package you never installed is present in node_modules?"
options={[
{text: 'npm explain <package>', correct: true, why: 'Prints the full dependency path — the chain of dependents that required it.'},
{text: 'npm ls <package>', why: 'Shows the versions installed and their position, but npm explain is the purpose-built answer to "why".'},
{text: 'npm view <package>', why: 'Fetches registry metadata about the package. It knows nothing about your tree.'},
{text: 'npm outdated <package>', why: 'Compares installed against available versions; it says nothing about who required it.'},
]}
explanation={<><code>npm explain</code> (aliased as <code>npm why</code> in some other package managers) is the fastest route from an audit finding to a decision about it.</>}
reference={{label: 'Inspecting', href: '/knowledge-base/npm/npm-commands#inspecting'}}
/>

---

## References

- [npm CLI commands](https://docs.npmjs.com/cli/commands) — every command and
  flag.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) — OIDC
  setup, allowed actions, and provenance.
- [npm query](https://docs.npmjs.com/cli/commands/npm-query) — the selector
  grammar.
- [overrides](https://docs.npmjs.com/cli/configuring-npm/package-json#overrides)
  — forcing transitive versions.
- [.npmrc configuration](https://docs.npmjs.com/cli/configuring-npm/npmrc) —
  precedence and available settings.
