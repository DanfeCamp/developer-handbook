---
title: npm
description: "The Node.js package manager: what it does, how to set it up in 2026, and where to go for concepts, commands, practices and pitfalls."
---

# npm

## Introduction

npm is two things that share a name: the **public registry** holding several
million JavaScript packages, and the **command-line client** that installs from
it, resolves dependencies, runs scripts and publishes your own work.

It ships with Node.js — installing Node installs npm — which is why it remains
the default even though pnpm, Yarn and Bun all exist. Node 24 bundles npm 11.

**The problem it solves.** Before a package manager, reusing JavaScript meant
downloading a file, committing it to your repository, and manually checking for
updates forever. Transitive dependencies — the packages your packages need —
made that unmanageable. npm turns "I need a date library" into one command, and
records the decision in a file so that every machine and every deploy resolves
to exactly the same code.

**What it actually manages:**

- **Dependency resolution** — working out one coherent set of versions from
  everyone's declared ranges, and installing them.
- **Reproducibility** — the lockfile pins the entire tree so that CI and
  production get byte-identical dependencies.
- **Task running** — `npm run` scripts are how most JavaScript projects expose
  build, test and lint.
- **Publishing** — versioning and distributing your own packages.

:::warning npm is a supply chain
Installing a package runs its code on your machine and ships it to your users.
2025 and 2026 saw several large-scale registry compromises, and npm's
authentication model changed substantially in response — classic tokens were
permanently revoked in December 2025, and OIDC trusted publishing is now the
recommended path. The security material on this page and in
[Best Practices](/knowledge-base/npm/best-practices#security) is not optional
reading.
:::

---

## Installation & Setup

### Install Node and npm

Do not install Node from a system package manager if you can avoid it — you will
eventually need more than one version. Use a version manager:

```bash
# fnm — fast, cross-platform, the current default recommendation
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24        # 24 is the active LTS line
fnm use 24
fnm default 24

# nvm — the long-established alternative
nvm install 24 && nvm use 24

# Or Volta, which pins per project automatically
```

```bash
node --version   # v24.x
npm --version    # 11.x
```

Pin the version for the whole team so nobody debugs a problem caused by running
Node 20 against a Node 24 project:

```json title="package.json"
{
  "engines": {
    "node": ">=24.0.0",
    "npm": ">=11.0.0"
  },
  "packageManager": "npm@11.13.0"
}
```

Add `.nvmrc` or `.node-version` containing `24` so version managers switch
automatically on `cd`.

`engines` is advisory by default. Make it binding:

```ini title=".npmrc"
engine-strict=true
```

### Upgrading npm itself

```bash
npm install -g npm@latest
```

npm updates far more often than Node, and newer versions fix real resolution and
audit bugs. Upgrading it independently of Node is normal and safe.

### Starting a project

```bash
mkdir my-app && cd my-app
npm init -y                    # generate package.json with defaults
npm pkg set type=module        # opt into ES modules — do this immediately
npm pkg set license=MIT
```

`npm pkg set` edits `package.json` without opening an editor, which is much
safer than hand-editing JSON in a script.

### A useful .npmrc

```ini title=".npmrc — committed, project-level"
engine-strict=true
save-exact=false        # keep caret ranges; the lockfile does the pinning
audit-level=high        # only fail on high and critical
fund=false              # silence funding messages in CI logs
```

```ini title="~/.npmrc — personal, never committed"
init-author-name=Your Name
init-license=MIT
```

**Never commit an `.npmrc` containing a token.** Reference an environment
variable instead, so the file is safe to check in:

```ini
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

---

## The Ecosystem: npm, pnpm, Yarn, Bun

All four read `package.json` and install from the same registry. They differ in
how they lay out `node_modules` and how fast they are.

|                 | npm                                     | pnpm                                  | Yarn (Berry)                           | Bun                  |
| --------------- | --------------------------------------- | ------------------------------------- | -------------------------------------- | -------------------- |
| Ships with Node | ✅                                      | ❌                                    | ❌                                     | ❌                   |
| Lockfile        | `package-lock.json`                     | `pnpm-lock.yaml`                      | `yarn.lock`                            | `bun.lock`           |
| Layout          | Flat, hoisted                           | Symlinks to a content-addressed store | Hoisted, or PnP with no `node_modules` | Flat, hoisted        |
| Disk use        | One copy per project                    | One copy per machine                  | One copy per project                   | One copy per project |
| Strictness      | Permissive — undeclared deps often work | Strict — undeclared deps fail         | Strict under PnP                       | Permissive           |

**Choosing:** npm is the right default — it is already installed, and for a
single application the performance gap no longer matters much. Choose **pnpm**
for monorepos and for its strictness, which catches dependencies you use but
never declared. Choose **Bun** when you also want its runtime and test runner.

Whatever you pick, **use exactly one**. Two lockfiles in a repository guarantees
that someone eventually installs a different tree than CI does. The
`packageManager` field plus [Corepack](https://nodejs.org/api/corepack.html)
enforces this.

---

## What is in this section

```mdx-code-block
import DocCardList from '@theme/DocCardList';
import {useCurrentSidebarCategory} from '@docusaurus/theme-common';

<DocCardList items={useCurrentSidebarCategory().items}/>
```

- **[Key Concepts](/knowledge-base/npm/key-concepts)** — `package.json` fields,
  dependency types, SemVer ranges, how the lockfile and resolution actually
  work, scripts, workspaces and the registry.
- **[Commands](/knowledge-base/npm/npm-commands)** — a task-oriented reference
  including the `ci`/`install` distinction, `npm query`, overrides and
  publishing.
- **[Best Practices](/knowledge-base/npm/best-practices)** — dependency hygiene,
  lockfile discipline, script conventions, supply-chain security and CI.
- **[Common Mistakes](/knowledge-base/npm/common-mistakes)** — the mistakes that
  cost the most time, and how to avoid them.

---

## FAQ

**npm or pnpm?**
npm if you have one application and no strong opinion. pnpm for a monorepo, for
disk efficiency across many projects, or when you want undeclared dependencies
to fail loudly rather than work by accident.

**Do I commit `package-lock.json`?**
Yes, always — for applications _and_ for libraries. For a library it does not
affect consumers (who resolve their own tree), but it makes your own CI
reproducible.

**Is `node_modules` really that big?**
Yes, and that is fine. It is generated, gitignored and disposable. If size is a
genuine problem, pnpm's content-addressed store is the answer.

**What is `npx`?**
A runner for package binaries. `npx create-vite@latest` downloads, executes and
discards, so there is no global install to keep updated. Type the package name
carefully — typosquatting is real.

**Why does `npm install` change my lockfile in CI?**
Because `install` is allowed to update it. CI should run `npm ci`, which
installs strictly from the lockfile and fails if it disagrees with
`package.json`.

---

## References

- [npm CLI documentation](https://docs.npmjs.com/cli/) — commands,
  `package.json` fields, and `.npmrc` configuration.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) — OIDC
  publishing from CI, now the recommended path.
- [Node.js releases](https://nodejs.org/en/about/previous-releases) — LTS
  schedule and support windows.
- [Semantic Versioning 2.0.0](https://semver.org/) — the versioning contract
  every range depends on.
- [node-semver](https://github.com/npm/node-semver) — the exact range grammar
  npm implements.
