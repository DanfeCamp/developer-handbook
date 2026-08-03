---
id: best-practices
title: Best Practices
sidebar_position: 3
description: Dependency hygiene, lockfile discipline, script conventions, supply-chain security and CI — the practices that keep an npm project maintainable and safe.
---

# Best Practices

## Introduction

npm's defaults are convenient rather than safe. Installing a package runs its
code on your machine and, if it reaches production, on your users' behalf. A
typical application has a handful of direct dependencies and a thousand
transitive ones, every one of which is code you did not write and did not
review.

The practices here are about two things: keeping the dependency tree small and
current, and making sure what runs in production is exactly what you tested.

---

## Dependency Hygiene

### Add dependencies deliberately

Before installing, ask:

- **Can the platform do this?** `structuredClone`, `Intl.NumberFormat`,
  `crypto.randomUUID()`, `Array.prototype.at`, `fetch` and `AbortController` are
  all built in now. A great many small packages exist because they were not, a
  decade ago.
- **How large is its own tree?** `npm view <pkg> dependencies` before, and
  [bundlephobia](https://bundlephobia.com/) for install size and bundle impact.
- **Is it maintained?** Last publish date, open issue count, whether the last
  release was security-only.
- **Would fifteen lines do?** A dependency is a permanent maintenance and
  security commitment. Fifteen lines you own are not.

This is not an argument for reinventing everything. It is an argument against
the reflex to install.

### Keep the tree current

Small, frequent updates are far cheaper than an annual big-bang upgrade:

```bash
npm outdated              # weekly
npm update                # patches and minors within range
npm audit --omit=dev      # what actually reaches production
```

Automate it. Dependabot or Renovate opens PRs on a schedule; grouping patch
updates into one weekly PR keeps the noise manageable while keeping majors
separate for real review.

### Prune what you no longer use

```bash
npx depcheck               # unused dependencies, and imports never declared
```

Unused dependencies still get audited, still get installed, and still enlarge
the attack surface.

---

## Lockfile Discipline

**Commit `package-lock.json`. Always** — applications and libraries alike.

- **Use `npm ci` in every automated context** — CI, Docker builds, deploys. It
  installs strictly from the lockfile and fails if it disagrees with
  `package.json`, so a drift is a loud error rather than a silent difference.
- **Review lockfile diffs.** They are large and boring, and that is exactly why
  a malicious `resolved` URL or an unexpected major bump slips through. You do
  not need to read every line; scan for changed registry hosts and for version
  jumps you did not ask for.
- **Never resolve a lockfile conflict by hand.** Take either side, then
  regenerate:

  ```bash
  git checkout --theirs package-lock.json
  npm install
  git add package-lock.json
  ```

- **Pin the toolchain**, or two developers on different npm versions will churn
  the lockfile back and forth:

  ```json
  {
    "packageManager": "npm@11.13.0",
    "engines": {"node": ">=24.0.0"}
  }
  ```

---

## Scripts

### Use a conventional set

Predictable names mean any developer, and any CI template, knows what to run:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "validate": "npm run typecheck && npm run lint && npm run test"
  }
}
```

A single `validate` script that CI and developers both run removes the class of
failure where CI checks something nobody can reproduce locally.

### Keep them portable and short

`rm -rf dist && NODE_ENV=production node build.js` fails on Windows. Use
`rimraf` and `cross-env`, or move the logic into a `scripts/build.mjs` file. Any
script longer than about 80 characters belongs in a file where it can be read,
commented and tested.

### Be careful with lifecycle hooks

`postinstall` runs automatically on every install. It is the single most common
mechanism for malicious packages to execute code, and a `postinstall` in your
_own_ published package inherits that suspicion. Use `prepare` for
build-from-source, and avoid `postinstall` in anything you publish.

---

## Security

This section matters more than the rest of the page combined.

### Assume the registry is hostile

Recent history is not reassuring: the 2016 `left-pad` unpublish, the 2018
`event-stream` takeover, the 2021 `ua-parser-js` compromise, and the
self-replicating worm campaigns of 2025 that compromised hundreds of packages
through stolen maintainer credentials. Every one of them executed on developer
machines and in CI.

Practical defences, roughly in order of value:

**1. Use `npm ci` with a committed lockfile.** The lockfile's `integrity` hashes
mean a tampered tarball fails the install rather than silently replacing a
package.

**2. Consider `--ignore-scripts`.** Lifecycle scripts are the primary execution
vector.

```ini title=".npmrc"
ignore-scripts=true
```

Some packages with native components genuinely need them, so this is a per
project decision — but it is worth trying, and allow-listing the few that break.

**3. Enable two-factor authentication** on your npm account, and require it for
your organisation.

**4. Publish with OIDC trusted publishing, not tokens.** npm classic tokens were
permanently revoked in December 2025; granular tokens now have a 90-day maximum
lifetime. Trusted publishing removes the long-lived credential entirely and
attaches provenance automatically. Where your org supports it, configure the
package so trusted publishing is the _only_ permitted publish path — then a
leaked token is useless.

**5. Add a cooldown on new versions.** Most malicious releases are detected and
removed within hours. Renovate's `minimumReleaseAge` (and equivalents) delays
adopting a version for a few days, which converts most incidents into a
non-event.

**6. Scan in CI.**

```bash
npm audit --audit-level=high --omit=dev
npm sbom --sbom-format=cyclonedx > sbom.json
```

**7. Pin GitHub Actions to commit SHAs**, not tags. A tag can be moved; a SHA
cannot.

### Never commit secrets to .npmrc

```ini
# .npmrc — safe to commit
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

The literal token goes in the environment. See
[Git best practices](/knowledge-base/git/best-practices#never-commit-secrets)
for what to do if one is committed.

### Triage audit output rather than chasing zero

`npm audit` reports what is _installed_, not what is _reachable_. A ReDoS
advisory in a linter's transitive dependency has no production impact. Fix what
ships:

```bash
npm audit --omit=dev --audit-level=high
```

Chasing a clean `npm audit` across devDependencies trains teams to run
`--force`, which breaks builds and is genuinely worse.

---

## Publishing

- **`private: true`** on every application and monorepo root.
- **`files` allowlist**, and `npm pack --dry-run` before the first release.
- **`exports`** to declare the public surface and prevent deep imports into your
  internals.
- **`npm version`** to bump, commit and tag in one step.
- **Publish from CI**, never from a laptop — reproducible, and no credentials on
  a developer machine.
- **`npm deprecate`**, not `npm unpublish`, to retire a version.
- **Support the current LTS** in `engines`, and treat raising the floor as a
  major version bump.

---

## CI

```yaml title=".github/workflows/ci.yml"
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm # caches ~/.npm keyed on the lockfile
      - run: npm ci
      - run: npm run validate
      - run: npm audit --audit-level=high --omit=dev
```

Two details that matter: `cache: npm` keys the cache on the lockfile hash, so it
invalidates exactly when dependencies change; and `npm ci` rather than
`npm install` guarantees CI tests the committed tree.

### Docker

```dockerfile
FROM node:24-alpine AS deps
WORKDIR /app
# Copy only the manifests first — this layer is cached until they change.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The pattern to copy: **manifests first, then `npm ci`, then the source.** Docker
caches layers by content, so editing application code does not reinstall
dependencies. The final stage installs production dependencies only, and runs as
a non-root user.

Add a `.dockerignore` containing `node_modules` — copying a host `node_modules`
into an image is both slow and wrong, because native modules are built for the
host platform.

---

## Do's and Don'ts

### Do

- Commit the lockfile and use `npm ci` in every automated context.
- Check whether the platform already does it before installing.
- Update in small, frequent increments, automated by Renovate or Dependabot.
- Enable 2FA, and publish from CI with OIDC trusted publishing.
- Run `npm pack --dry-run` before publishing.
- Set `private: true` on applications.
- Focus audit effort on `--omit=dev`.
- Pin Node and npm with `engines` and `packageManager`.

### Don't

- Don't run `npm install` in CI.
- Don't run `npm audit fix --force` unattended.
- Don't hand-edit lockfile conflicts.
- Don't add `postinstall` to a published package.
- Don't commit a token in `.npmrc`.
- Don't use `--legacy-peer-deps` as a permanent setting.
- Don't mix npm with pnpm or Yarn in one repository.
- Don't install a package globally when `npx` will do.

---

## FAQ

**How often should we update dependencies?**
Patches and minors weekly, automated. Majors deliberately, one at a time, with
the changelog open.

**Should a library commit its lockfile?**
Yes. It does not affect consumers, who resolve their own tree, but it makes your
CI reproducible.

**Is `npm audit` worth running?**
Yes, scoped with `--omit=dev --audit-level=high`. Unscoped, the noise makes
teams stop reading it.

**Do we need Renovate if we have Dependabot?**
No. Renovate offers more configuration — grouping, scheduling, and the
`minimumReleaseAge` cooldown that is genuinely valuable against malicious
releases. Dependabot is simpler and built in.

**Is `--ignore-scripts` realistic?**
More realistic than it sounds. Try it, find the handful of packages that break,
and allow-list them. The reduction in attack surface is significant.

**What is provenance?**
A signed, verifiable statement linking a published tarball to the commit and CI
workflow that built it. It is attached automatically when publishing via trusted
publishing, and consumers can verify it with `npm audit signatures`.

---

## Check your understanding

<Quiz
question="Your Dockerfile copies the whole source tree, then runs npm ci. Builds are slow because dependencies reinstall on every code change. What is the fix?"
options={[
{
text: 'Copy package.json and package-lock.json first, run npm ci, then copy the rest of the source',
correct: true,
why: 'Docker caches layers by content. With manifests copied first, the npm ci layer is reused until the lockfile changes, so editing source code no longer triggers a reinstall.',
},
{
text: 'Use npm install instead of npm ci',
why: 'install is slower, and may modify the lockfile inside the image so the build no longer matches what you committed.',
},
{
text: 'Add node_modules to .dockerignore',
why: 'Correct and necessary — but it does not create the cached dependency layer, which is what makes the build fast.',
},
{
text: 'Mount node_modules as a volume at build time',
why: 'Volumes are a runtime concept; they do not affect image build caching, and the result would not be self-contained.',
},
]}
explanation={<>The same principle applies to any package manager and any language: copy the dependency manifest, install, then copy source. It is the single highest-impact Dockerfile optimisation.</>}
reference={{label: 'Docker', href: '/knowledge-base/npm/best-practices#docker'}}
/>

<Quiz
question="Which measures meaningfully reduce supply-chain risk for an npm project?"
type="multiple"
options={[
{text: 'Committing the lockfile and installing with npm ci', correct: true, why: 'The integrity hashes make a tampered tarball fail the install rather than silently substituting a package.'},
{text: 'Setting ignore-scripts=true and allow-listing the few packages that need them', correct: true, why: 'Lifecycle scripts are the primary code-execution vector for malicious packages.'},
{text: 'Publishing via OIDC trusted publishing instead of a long-lived token', correct: true, why: 'There is no durable credential to steal, and provenance is attached automatically. Classic tokens were revoked outright in December 2025.'},
{text: 'Delaying adoption of brand-new versions by a few days', correct: true, why: 'Most malicious releases are detected and removed within hours, so a cooldown turns most incidents into a non-event.'},
{text: 'Running npm audit fix --force in CI so the build always has zero advisories', why: 'It installs major versions unattended, breaking builds, and optimises for a number rather than for actual exposure.'},
]}
explanation={<>Notice that four of the five are about <em>reducing what can execute and when</em>, rather than about reacting to advisories after the fact.</>}
reference={{label: 'Security', href: '/knowledge-base/npm/best-practices#security'}}
/>

<Quiz
question="Two developers on the same team keep producing conflicting package-lock.json diffs even when neither has changed a dependency. What is the most likely cause?"
options={[
{
text: 'They are running different npm or Node versions, which resolve and serialise the lockfile differently',
correct: true,
why: 'Lockfile format and resolution details vary between npm versions. Pin both with packageManager and engines, plus an .nvmrc so version managers switch automatically.',
},
{
text: 'One of them is not committing the lockfile',
why: 'That would produce a missing file rather than repeated conflicting rewrites of an existing one.',
},
{
text: 'The registry is returning different versions to each of them',
why: 'Published versions are immutable, and the lockfile pins exact versions with integrity hashes.',
},
{
text: 'They need to run npm dedupe',
why: 'dedupe restructures the tree to share duplicates. It does not address version differences between the two clients.',
},
]}
explanation={<>Pinning the toolchain is cheap and removes an entire recurring category of noisy diffs.</>}
reference={{label: 'Lockfile discipline', href: '/knowledge-base/npm/best-practices#lockfile-discipline'}}
/>

<Quiz
question="A teammate proposes adding a 2 KB package that formats relative dates ('3 hours ago'). What is the strongest reason to check the platform first?"
options={[
{
text: 'Intl.RelativeTimeFormat is built into every current runtime and is fully localised',
correct: true,
why: 'The platform version handles every locale correctly, ships with the runtime, and carries no maintenance, audit or supply-chain cost.',
},
{
text: '2 KB is too large for a production bundle',
why: '2 KB is negligible. The cost of a dependency is maintenance and supply-chain exposure, not bytes.',
},
{
text: 'Small packages are more likely to be malicious',
why: 'There is no reliable relationship between package size and trustworthiness.',
},
{
text: 'npm audit produces warnings for any package under 10 KB',
why: 'Not a thing — audit reports known advisories, and size plays no part.',
},
]}
explanation={<>Much of the long tail of tiny packages exists because the platform lacked these APIs years ago. <code>structuredClone</code>, <code>crypto.randomUUID()</code>, <code>fetch</code> and the <code>Intl</code> family have all replaced popular dependencies.</>}
reference={{label: 'Add dependencies deliberately', href: '/knowledge-base/npm/best-practices#add-dependencies-deliberately'}}
/>

<Quiz
question="npm audit reports 14 vulnerabilities, all in devDependencies of your build tooling, none in production code. What is the appropriate response?"
options={[
{
text: 'Scope the CI gate to --omit=dev --audit-level=high, and address the dev-side findings on a normal maintenance schedule',
correct: true,
why: 'Audit reports what is installed, not what is reachable. Gating on production exposure keeps the signal meaningful while dev tooling is updated in the usual cadence.',
},
{
text: 'Run npm audit fix --force until the count reaches zero',
why: 'Unattended major upgrades across build tooling is how a green audit becomes a red build.',
},
{
text: 'Ignore npm audit entirely — it is too noisy to be useful',
why: 'Overcorrection. Scoped properly it catches genuine production exposure.',
},
{
text: 'Add every affected package to overrides with a newer version',
why: 'Overriding fourteen transitive packages is a large compatibility gamble taken for findings with no production impact.',
},
]}
explanation={<>An audit gate is only useful if people read it. Scoping to what ships keeps a failure meaningful rather than routine.</>}
reference={{label: 'Triage audit output', href: '/knowledge-base/npm/best-practices#triage-audit-output-rather-than-chasing-zero'}}
/>

---

## References

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) — OIDC
  configuration and allowed actions.
- [npm: Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements)
  — how provenance is produced and verified.
- [OpenSSF: npm Best Practices Guide](https://best.openssf.org/npm-best-practices/)
  — a security-focused checklist.
- [Renovate configuration](https://docs.renovatebot.com/configuration-options/)
  — grouping, scheduling and `minimumReleaseAge`.
- [Node.js Docker best practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
  — official image guidance.
- [npm audit](https://docs.npmjs.com/cli/commands/npm-audit) — what it checks and
  how severity is assigned.
