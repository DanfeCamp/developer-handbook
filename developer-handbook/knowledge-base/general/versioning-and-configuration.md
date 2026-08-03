---
title: 'Versioning & Configuration'
description: 'Semantic versioning and range syntax, lockfiles, environment-based configuration, secret handling, and feature flags.'
---

# Versioning & Configuration

## Introduction

Two topics that look like housekeeping and cause disproportionate trouble:

- **Versioning** — the contract you offer consumers, and the trust you extend to
  dependencies.
- **Configuration** — everything that differs between environments, and where it
  should live.

**The connecting idea is that both are about change arriving from outside.** A
dependency updates; an environment differs; a secret rotates. Systems that
handle those gracefully do so because someone decided in advance where that
variation lives.

**Two rules carry most of the value:**

1. **The lockfile is what actually pins your dependency graph** — not the range
   in `package.json`.
2. **Validate configuration at startup**, so a missing variable crashes at boot
   with a clear message rather than at 3 a.m. on one code path.

---

## Semantic Versioning

`MAJOR.MINOR.PATCH` — for example `4.2.1`:

- **MAJOR** — a breaking change; consumers must do work.
- **MINOR** — new functionality, backwards compatible.
- **PATCH** — a bug fix, backwards compatible.

**Range syntax is a statement of trust:**

| Range     | Accepts        | Meaning                            |
| --------- | -------------- | ---------------------------------- |
| `4.2.1`   | exactly 4.2.1  | Pinned                             |
| `~4.2.1`  | 4.2.x          | Patches only                       |
| `^4.2.1`  | 4.x.x          | Patches and features (the default) |
| `>=4.2.1` | anything newer | Too permissive                     |
| `*`       | anything       | Never do this                      |

**`0.x` versions are special.** The ecosystem treats a minor bump as potentially
breaking, because the author has not committed to stability. `^0.3.1` therefore
resolves only to `0.3.x`, not `0.x.x`.

**The lockfile is what actually pins your dependency graph.** `^4.2.1` says what
you _accept_; `package-lock.json` records what you _got_, for every transitive
dependency. Commit it, and use `npm ci` in CI so builds are reproducible. See
[npm](/knowledge-base/npm).

**Publishing: what counts as breaking is broader than people assume.** Removing
an export, renaming a parameter, tightening validation, changing a default,
raising the minimum runtime version, and changing observable timing are all
breaking. So is fixing a bug that consumers have worked around — which is why
"it was a bug" is not a defence for a patch release that broke people.

**Pre-release tags** (`4.3.0-beta.1`) sort before the release and are not
matched by ranges unless requested, which makes them safe to publish.

**Automate the changelog from commit messages.** Conventional Commits plus
`changesets` or `semantic-release` removes the judgement call about which number
to bump, and produces release notes as a side effect. See
[Git: best practices](/knowledge-base/git/best-practices).

---

## Configuration

The rule from the twelve-factor methodology: **anything that differs between
environments is configuration, and belongs in the environment, not in the code.**

```js
// Validate configuration once, at startup, and crash if it is wrong.
const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
```

**Failing at boot with a clear message is far better than failing at 3 a.m. on
the one code path that reads an undefined variable.** A schema library makes
this stronger still — Zod or Valibot will coerce types, apply defaults, and
report every problem at once rather than the first:

```js
const config = ConfigSchema.parse(process.env); // typed, validated, once
```

**Read the environment once, at startup, into a config object.** Scattered
`process.env.FOO` calls are untestable, undiscoverable, and make it impossible
to know what the application actually requires.

**What is configuration and what is not:**

| Configuration                | Not configuration                       |
| ---------------------------- | --------------------------------------- |
| Database URL, API endpoints  | Business rules                          |
| Credentials and keys         | Which fields a form has                 |
| Log level, feature flags     | Anything identical in every environment |
| Port, hostname, worker count | Constants that never vary               |

**A setting that is the same everywhere is a constant.** Making it configurable
adds a way to get it wrong for no benefit.

**Keep an `.env.example`** in the repository listing every variable with a
non-secret placeholder. It is the only reliable documentation of what a new
developer or a new environment needs.

---

## Secrets

**Never commit secrets.** Not in code, not in config files, not in a commented
block, not "temporarily".

- Keep `.env` in `.gitignore`, and commit `.env.example` instead.
- Use the platform's secret manager — AWS Secrets Manager, Vault, GitHub
  environment secrets, your host's encrypted variables.
- **Prefer short-lived credentials to stored ones.** OIDC federation lets CI
  assume a cloud role with no stored key at all. See
  [GitHub Actions: OIDC](/knowledge-base/hosting/github-actions#oidc-deploying-without-stored-credentials).
- Enable secret scanning and push protection on the repository.

**If a secret is ever committed, rotate it.** Removing the file does not remove
the secret: **Git history is forever**, the value is in every clone, and it is
almost certainly already indexed by an automated scanner. Rewriting history does
not help either, because forks and caches retain it. Rotate first, then clean up.

**The same applies to logs.** `logger.info(req.body)` on a login route writes
plaintext passwords to your aggregator, your backups and your vendor's storage.
Configure redaction at the logger. See
[Logging](/knowledge-base/operations/logging#what-never-to-log).

---

## Environments and Feature Flags

**Environments should differ in configuration, not in code.** `if (isProduction)`
scattered through the application means the code you test is not the code you
run — which defeats the purpose of having a staging environment at all.

**Build one artefact and promote it**, with configuration supplied per
environment. See [CI/CD](/knowledge-base/hosting/ci-cd#pipeline-stages).

**Feature flags decouple deployment from release.** Ship code disabled, enable
it for a subset of users, and turn it off without a deploy when it misbehaves —
frequently more useful than any deployment strategy.

| Flag type       | Lifetime                                             |
| --------------- | ---------------------------------------------------- |
| **Release**     | Weeks — remove once the feature is stable            |
| **Experiment**  | The duration of an A/B test                          |
| **Operational** | Long-lived kill switches                             |
| **Permission**  | Permanent, and really entitlements rather than flags |

**Flags accumulate, and stale flags are technical debt.** Each one doubles the
number of code paths, and combinations multiply. Give release flags an owner and
a removal date, and delete them once the feature is settled.

**Do not use flags for entitlements.** "Is this customer on the Pro plan" is
domain logic belonging in your data model, not in a flag service.

---

## Do's and Don'ts

### Do

- Commit the lockfile, and use `npm ci` in CI.
- Read and validate configuration once, at startup.
- Keep an `.env.example` listing every variable.
- Use a schema library to parse and type configuration.
- Use the platform's secret manager, and prefer OIDC to stored keys.
- Rotate any secret that has ever been committed.
- Follow SemVer when publishing, and automate the changelog.
- Give release flags an owner and a removal date.
- Build one artefact and configure it per environment.

### Don't

- Don't use `*` or `>=` ranges in dependencies.
- Don't commit `.env` or any secret.
- Don't assume deleting a committed secret makes it safe.
- Don't scatter `process.env` reads through the codebase.
- Don't make a value configurable when it never varies.
- Don't branch on the environment name inside application logic.
- Don't leave feature flags in place after the feature ships.
- Don't use feature flags for plan entitlements.
- Don't release a "bug fix" that consumers have worked around as a patch.

---

## Common Mistakes

**Trusting the range instead of the lockfile.** `^4.2.1` resolves differently
depending on when you install. Without a committed lockfile, builds are not
reproducible.

**Not committing the lockfile "because it causes conflicts".** The conflicts are
information. Resolve by re-running the install.

**Configuration read lazily.** A missing variable surfaces weeks later, on the
one code path that reads it.

**Secrets in the repository.** Automated scanners find them within minutes of a
push.

**Deleting a committed secret without rotating.** It is in every clone and every
fork, permanently.

**`if (process.env.NODE_ENV === 'production')` in business logic.** The tested
path is not the running path.

**Configurable constants.** A setting that is identical in every environment is
a way to get it wrong for no benefit.

**Feature flags that never leave.** Two years of dead branches, and nobody dares
delete them.

**Publishing a breaking change as a minor.** Consumers using `^` get it
automatically, and their builds break.

---

## Debugging

| Symptom                                     | Likely cause                                                 |
| ------------------------------------------- | ------------------------------------------------------------ |
| Works locally, fails in CI                  | An environment variable set locally but not in CI            |
| Works on one instance, not another          | Configuration drift between environments                     |
| Different behaviour after a fresh install   | Range resolved to a newer version; check the lockfile        |
| `undefined` in a URL or connection string   | Missing variable read lazily, never validated                |
| Build reproducible locally, not in CI       | Lockfile not committed, or `npm install` instead of `npm ci` |
| A dependency broke without a version change | A transitive dependency moved — check `npm ls`               |
| Feature enabled for the wrong users         | Flag targeting rules, or a stale cached evaluation           |

**`npm ls <package>` shows which version actually resolved and what pulled it
in.** Most "but I pinned it" confusion is a transitive dependency with its own
range.

**Print the resolved config at startup, with secrets redacted.** A single log
line listing effective configuration answers a large share of environment
questions immediately.

---

## FAQ

**Should I pin exact versions?**
Applications: use ranges plus a committed lockfile. Libraries: use permissive
ranges so consumers can deduplicate. Pinning exactly in a library causes
conflicts downstream.

**How often should I update dependencies?**
Continuously and in small batches — Renovate or Dependabot with grouped PRs. A
year of accumulated updates is far harder than fifty-two weeks of small ones.

**Where should feature flags live?**
A dedicated service (LaunchDarkly, Unleash, Flagsmith) if you need targeting and
audit. A database table with a cache is sufficient for simple on/off switches.

**Is `.env` safe if it is gitignored?**
Safe from commits, and it still sits in plaintext on disk and in shell history.
Fine for development; use a secret manager in production.

**What about configuration files versus environment variables?**
Environment variables for anything secret or environment-specific. Files for
large structured configuration that is not sensitive — checked into the
repository.

**Do I need SemVer for an internal package?**
Yes, if anything else depends on it. The value is communicating breakage, which
matters regardless of who the consumer is.

---

## Check your understanding

<Quiz
question="A dependency is declared with the caret range ^4.17.20. Two developers install a month apart and get different versions. What prevents this?"
options={[
{
text: 'A committed lockfile, plus `npm ci` in CI — the range says what you accept, the lockfile records what you got',
correct: true,
why: 'A caret range resolves to the newest matching version at install time. The lockfile pins the exact resolution for every direct and transitive dependency.',
},
{text: 'Pinning the exact version in package.json', width: false, why: 'It fixes the direct dependency and leaves every transitive one still floating.'},
{text: 'Using `~4.17.20` instead of `^4.17.20`', width: false, why: 'It narrows the range to patches and still resolves differently over time.'},
{text: 'Running npm install rather than npm ci', why: 'The reverse — npm install may update the lockfile, while npm ci installs exactly what it specifies.'},
]}
explanation={<>Commit the lockfile and use <code>npm ci</code> in CI. When a dependency version surprises you, <code>npm ls &lt;package&gt;</code> shows what actually resolved and which parent pulled it in — most "but I pinned it" confusion is a transitive dependency with its own range.</>}
reference={{label: 'Semantic versioning', href: '/knowledge-base/general/versioning-and-configuration#semantic-versioning'}}
/>

<Quiz
question="A developer notices an API key committed three weeks ago, deletes the file, and pushes. Is the key safe?"
options={[
{
text: 'No — it remains in Git history, in every clone and fork, and was almost certainly indexed by an automated scanner within minutes. It must be rotated',
correct: true,
why: 'Deleting a file adds a commit; it does not remove earlier ones. Even rewriting history does not reach forks, caches or anything already harvested.',
},
{text: 'Yes, once the file is deleted from the default branch', why: 'The value is still reachable in history by anyone with the repository.'},
{text: 'Yes, if the repository is private', width: false, why: 'It reduces exposure and does not undo it — anyone with past access, and any CI system with a cached clone, still has the value.'},
{text: 'Only if the commit is amended before anyone pulls', why: 'Three weeks in, that window closed long ago.'},
]}
explanation={<>Rotate first, then clean up. Enable secret scanning and push protection so the next one is blocked before it lands, and prefer OIDC federation over stored keys entirely — a credential that does not exist cannot leak.</>}
reference={{label: 'Secrets', href: '/knowledge-base/general/versioning-and-configuration#secrets'}}
/>

<Quiz
question="A service reads `process.env.STRIPE_KEY` inside the payment handler. It deploys successfully and fails two weeks later on the first refund. What practice would have caught this at boot?"
options={[
{
text: 'Reading and validating all configuration once at startup, crashing immediately if a required variable is missing',
correct: true,
why: 'Lazy reads mean a missing variable is only discovered when that specific code path runs — which may be long after deployment, in production, at an inconvenient hour.',
},
{text: 'Adding a default value for the key', width: false, why: 'A default for a credential means silently using the wrong one, which is worse than failing.'},
{text: 'Better test coverage of the refund path', width: false, why: 'Useful, and tests typically run with their own environment and would not catch a production variable being unset.'},
{text: 'Reading configuration from a file rather than the environment', why: 'The same lazy-read problem applies to files.'},
]}
explanation={<>Parse the whole environment through a schema at startup — Zod or Valibot will coerce types, apply defaults and report every problem at once. Keep an <code>.env.example</code> listing every variable, since it is the only reliable record of what a new environment needs.</>}
reference={{label: 'Configuration', href: '/knowledge-base/general/versioning-and-configuration#configuration'}}
/>

<Quiz
question="Which of these are breaking changes requiring a MAJOR version bump?"
type="multiple"
options={[
{text: 'Removing an exported function', correct: true, why: 'Any consumer importing it breaks immediately.'},
{text: 'Tightening input validation that previously accepted a value', correct: true, why: 'Code that worked now throws — breaking, regardless of whether the old behaviour was intended.'},
{text: 'Raising the minimum supported runtime version', correct: true, why: 'Consumers on the old runtime can no longer install or run the package.'},
{text: 'Changing a default option value', correct: true, why: 'Consumers relying on the old default get different behaviour with no code change of their own.'},
{text: 'Adding a new optional parameter with a default', why: 'Existing calls behave identically, so this is a MINOR — new functionality, backwards compatible.'},
]}
explanation={<>What counts as breaking is broader than most people assume, and includes fixing a bug that consumers have worked around. "It was a bug" is not a defence for a patch release that breaks people — their code depended on the observed behaviour.</>}
reference={{label: 'Semantic versioning', href: '/knowledge-base/general/versioning-and-configuration#semantic-versioning'}}
/>

<Quiz
question="A codebase has forty feature flags, most from features shipped over a year ago. What is the cost?"
options={[
{
text: 'Each flag doubles the code paths and combinations multiply, so the tested configuration is a tiny fraction of the possible ones',
correct: true,
why: 'Flags are branches that persist. Forty independent flags describe an enormous configuration space, of which only the current production combination is ever exercised.',
},
{text: 'Flag evaluation adds unacceptable request latency', width: false, why: 'Evaluation is typically cached and cheap; the cost is combinatorial complexity, not milliseconds.'},
{text: 'Flag services charge per flag, so it is primarily a billing problem', why: 'A minor consideration against the maintenance cost.'},
{text: 'No real cost, provided each flag defaults correctly', why: 'Defaults do not remove the untested combinations or the dead branches nobody dares delete.'},
]}
explanation={<>Give release flags an owner and a removal date, and delete them once the feature is settled. Keep long-lived operational kill switches deliberately — and note that plan entitlements are domain logic for your data model, not flags.</>}
reference={{label: 'Environments and feature flags', href: '/knowledge-base/general/versioning-and-configuration#environments-and-feature-flags'}}
/>

---

## References

- [Semantic Versioning 2.0.0](https://semver.org/) — the exact rules.
- [npm: semver ranges](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#dependencies)
  — how each range operator resolves.
- [The Twelve-Factor App: Config](https://12factor.net/config) — the
  environment-based argument, stated originally.
- [OWASP: Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
  — storage, rotation and detection.
- [Martin Fowler: Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)
  — the taxonomy and its maintenance cost.
- [Changesets](https://github.com/changesets/changesets) — versioning and
  changelogs driven by intent.
