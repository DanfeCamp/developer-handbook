---
title: 'CI/CD'
description: 'Automating build, test and deployment pipelines — stages, artefacts, environments, deployment strategies, migrations and rollback.'
---

# CI/CD

## Introduction

**Continuous integration** verifies every change automatically as it merges.
**Continuous delivery** keeps every verified change ready to release.
**Continuous deployment** releases it without a human step.

Most teams do CI and continuous delivery; continuous deployment is a further
choice that depends on your risk tolerance and test quality.

**The value is not the tooling.** It is that releasing stops being an event.
When deploying is a scripted, reversible, five-minute operation, teams deploy
small changes often — and small changes are dramatically easier to debug when
they go wrong. The direction of causation is the point: safe deploys cause
frequent deploys, and frequent deploys cause smaller changes.

**The DORA metrics** describe what a good pipeline produces: deployment
frequency, lead time for changes, change failure rate, and time to restore
service. Research consistently finds these correlate rather than trade off — the
teams deploying most often also have the lowest failure rates, because their
changes are small and their rollbacks are practised.

**The one property that matters most is trust.** A pipeline with flaky tests
gets ignored, then bypassed, then removed. A slow pipeline gets worked around. A
pipeline people trust is one they will not merge without.

---

## Pipeline Stages

A typical pipeline, in order of increasing cost:

```
Lint & format  →  Type check  →  Unit tests  →  Build
      ↓
Integration tests  →  Security scan  →  Deploy to staging
      ↓
E2E tests  →  Deploy to production  →  Smoke tests
```

**Fail fast.** Put cheap checks first — a lint failure should be known in twenty
seconds, not after a nine-minute test suite. Run independent jobs in parallel.

**Build once, deploy everywhere.** Produce a single artefact — a container
image, a bundle, a tarball — and promote _that same artefact_ through staging to
production. Rebuilding per environment means the thing you tested is not the
thing you shipped, and it reintroduces exactly the class of bug the pipeline
exists to catch.

**Target ten minutes for the pull-request pipeline.** Beyond that people context
switch, and the feedback loop stops working. Longer suites belong on a schedule
or on merge to main.

---

## Making Pipelines Fast

The most common reason a pipeline is untrusted is that it is slow.

- **Cache dependencies** — `~/.npm`, Composer, pip, Gradle — keyed on the lock
  file hash. Usually the single biggest win.
- **Run jobs in parallel.** Lint, type check and test have no reason to be
  sequential.
- **Shard large test suites** across parallel runners.
- **Only run what changed** in a monorepo, using path filters or a tool like
  Turborepo or Nx.
- **Use Docker layer caching** with `--cache-from` or buildx.
- **Reserve the slow, comprehensive suite** for merges to main and nightly runs.

**Then keep it fast.** Pipeline duration creeps upward one job at a time. Track
it, and treat a regression as a bug.

---

## Flaky Tests

A test that passes and fails on identical code does more damage than a missing
test, because it teaches everyone to re-run rather than investigate. Once
re-running is the reflex, real failures get re-run too.

**Common causes:** timing assumptions and fixed sleeps, shared mutable state
between tests, test-order dependence, real network calls, and time zone or clock
sensitivity.

**Deal with them explicitly.** Quarantine a flaky test out of the blocking path
_with a ticket and an owner_, then fix it. Quarantining without fixing is how
suites rot.

**Never add a blanket automatic retry.** It hides the flake and lets genuine
intermittent bugs — race conditions especially — reach production silently. See
[Testing](/knowledge-base/testing).

---

## Environments and Secrets

**Typical progression:** local → preview (per pull request) → staging →
production.

**Preview environments are the highest-value addition** to most pipelines.
Reviewers see the change running rather than reading a diff, and designers and
product people can look without installing anything.

**Secrets:**

- **Never in the repository.** Not in code, not in config, not in a commented
  block. Enable secret scanning; leaked credentials are found by automated
  scanners within minutes of a push.
- **Use the platform's secret store**, scoped to the environment. Production
  secrets should not be readable by a pull-request build.
- **Prefer OIDC to stored credentials.** GitHub Actions can assume an AWS or GCP
  role directly with no long-lived key stored anywhere — the single best
  security improvement available to most pipelines.
- **Rotate on any suspicion**, and revoke before investigating.
- **Require approval for production deploys** through protected environments.

**Beware secrets in forked pull requests.** Most platforms withhold secrets from
fork builds by default, for the good reason that a fork's code is untrusted. Do
not disable that.

---

## Deployment Strategies

| Strategy       | How it works                          | Trade-off                              |
| -------------- | ------------------------------------- | -------------------------------------- |
| **Recreate**   | Stop old, start new                   | Simple; brief downtime                 |
| **Rolling**    | Replace instances gradually           | No downtime; two versions coexist      |
| **Blue-green** | Two full environments, switch traffic | Instant rollback; double the resources |
| **Canary**     | Small traffic percentage first        | Safest; needs good metrics             |

**Rolling is the sensible default** for most applications, and it means two
versions run simultaneously — which is what makes backward compatibility a
requirement rather than a nicety.

**Blue-green gives the fastest rollback**: switch traffic back. Its awkward part
is the database, which is shared between both environments and cannot be
switched with them.

**Canary is the safest and demands the most.** Routing 5% of traffic to a new
version only helps if you are measuring error rates and latency well enough to
notice a problem in that 5%. Without
[monitoring](/knowledge-base/operations/monitoring), a canary is just a slower
deploy.

**Feature flags decouple deploy from release.** Ship the code dark, enable it for
a subset of users, and turn it off without a deploy when it misbehaves. This is
frequently more useful than any deployment strategy, and it comes with a cost:
flags accumulate, and stale flags are technical debt. Remove them once the
feature is settled.

---

## Database Migrations

Where pipelines most often go wrong, because the database does not roll back
with the code.

**The rule: migrations must be backward compatible with the currently running
version.** During any rolling or blue-green deploy, old and new code both talk
to the migrated schema.

**The expand–contract pattern** makes destructive changes safe across
deployments:

1. **Expand** — add the new column, nullable, and start writing to both.
2. **Migrate** — backfill existing rows.
3. **Switch** — deploy code that reads from the new column.
4. **Contract** — in a _later_ deploy, stop writing the old column and drop it.

Renaming a column in one migration breaks every instance still running the old
code. This is the most common self-inflicted deployment outage.

**Other essentials:**

- **Run migrations as a separate step** before the new code, not on application
  boot — otherwise several instances race to migrate simultaneously.
- **Avoid long-held locks.** Use `CREATE INDEX CONCURRENTLY` in PostgreSQL;
  adding a non-null column with a default rewrites the table on older engines.
- **Back up before migrating** in production.
- **Test the migration against production-sized data.** A migration that takes
  200 ms on a development database can take forty minutes on a real one, and
  that is discovered during deploys rather than in review.

See [Migrations](/knowledge-base/databases/data-modelling#migrations).

---

## Rollback

**Every deploy needs a way back, and it must be practised.** A rollback
procedure that has never been executed is an untested assumption at the worst
possible moment.

- **Keep the previous artefact available**, so rollback is a redeploy rather
  than a rebuild.
- **Do not roll back through destructive migrations.** Expand–contract exists so
  that you do not have to.
- **Roll forward when it is faster** — for a small, obvious bug, a fix deployed
  in ten minutes often beats a rollback.
- **Feature flags are the fastest rollback available** for anything they cover:
  no deploy at all.
- **Rehearse it.** Roll back a real deploy in staging on purpose, occasionally.

---

## Pipeline Security

The pipeline has credentials to production, which makes it a target.

- **Pin third-party actions to a commit SHA**, not a mutable tag. A compromised
  action running with your secrets is a supply-chain compromise — and this has
  happened repeatedly to widely used actions.
- **Grant least privilege.** Read-only tokens where possible; write scopes only
  where needed.
- **Scan dependencies** — `npm audit`, Dependabot, Renovate — and act on the
  results rather than accumulating them.
- **Never log secrets.** Platforms mask known values; constructed strings and
  debug output can leak them anyway.
- **Review who can modify pipeline files.** Someone who can edit the workflow
  can exfiltrate every secret it uses.
- **Do not run untrusted pull-request code with secrets.** The default is safe;
  the ways around it are not.

See [npm: Security](/knowledge-base/npm/best-practices#security).

---

## Do's and Don'ts

### Do

- Run cheap checks first and fail fast.
- Build one artefact and promote it unchanged.
- Cache dependencies keyed on the lock file.
- Keep the pull-request pipeline under about ten minutes.
- Use preview environments for review.
- Use OIDC instead of stored cloud credentials.
- Make migrations backward compatible with expand–contract.
- Run migrations as a distinct step before deploying code.
- Keep the previous artefact for instant rollback.
- Pin third-party actions to a SHA.
- Require approval for production deploys.

### Don't

- Don't rebuild per environment.
- Don't add automatic retries to hide flaky tests.
- Don't put secrets in the repository or in logs.
- Don't run migrations on application boot.
- Don't rename or drop columns in a single deploy.
- Don't deploy without a tested way back.
- Don't let the pipeline slow down unchecked.
- Don't allow fork pull requests access to secrets.
- Don't canary without metrics to judge it by.

---

## Common Mistakes

**Rebuilding for each environment.** The artefact you tested is not the artefact
you shipped. Build once, promote it.

**Ignoring flaky tests.** They train the team to re-run rather than
investigate, and real intermittent bugs then reach production.

**A destructive migration during a rolling deploy.** Old instances query a
column that no longer exists. Expand–contract.

**Migrations on application start.** Several instances race; one wins and the
others fail or corrupt.

**Secrets in environment files committed "temporarily".** Git remembers, and
scanners find them.

**Unpinned third-party actions.** A tag can be moved to malicious code, running
with your production credentials.

**No rollback plan.** Discovered under pressure, which is the worst time to
design one.

**A pipeline that grew to forty minutes.** People stop waiting for it, and start
merging around it.

**Canary deploys with no monitoring.** A slower deploy with none of the safety.

---

## Debugging

| Symptom                               | Where to look                                                  |
| ------------------------------------- | -------------------------------------------------------------- |
| Passes locally, fails in CI           | Environment differences — versions, timezone, locale, env vars |
| Intermittent failures                 | Flaky test: timing, shared state, or ordering                  |
| Slow pipeline                         | Cache misses; sequential jobs that could run in parallel       |
| Deploy succeeds, app broken           | Migration not run, or a missing environment variable           |
| Cannot pull the image                 | Registry authentication or expired credentials                 |
| Secrets undefined                     | Environment scoping, or a fork pull request                    |
| Works in staging, fails in production | Configuration drift, or data volume differences                |

**"Works locally" is nearly always an environment difference.** Pin the runtime
version, run in the same container image locally, and set `TZ` and `LANG`
explicitly. Reproducing the CI environment locally is usually faster than
debugging through commits.

---

## FAQ

**Do I need CD if I deploy weekly?**
Yes — automation makes the deploy repeatable and reversible whatever its
frequency. The frequency usually rises once it stops being frightening.

**Which platform?**
[GitHub Actions](/knowledge-base/hosting/github-actions) if you are on GitHub —
the integration is worth a great deal. GitLab CI is excellent and more
opinionated. CircleCI and Buildkite suit larger or self-hosted needs.

**Should the pipeline deploy to production automatically?**
Only with strong test coverage, good monitoring and a practised rollback. Start
with automatic deploys to staging and a manual approval for production.

**How much test coverage before automating deploys?**
Coverage percentage is a poor proxy. What matters is whether the suite catches
the failures you actually have. Add a test for every incident, and the suite
becomes trustworthy where it counts.

**Self-hosted runners?**
For larger machines, private network access, or specific hardware. They cost
maintenance and carry real security implications — a compromised job on a
persistent runner can affect later jobs.

**Monorepo pipelines?**
Use path filters or a build tool with a dependency graph, so a change to one
package does not rebuild everything.

---

## Check your understanding

<Quiz
question="A pipeline builds the application separately for staging and again for production, from the same commit. What is the problem?"
options={[
{
text: 'The artefact tested in staging is not the artefact deployed to production — dependency resolution, base images or build tooling can differ between the two builds',
correct: true,
why: 'Two builds of the same commit are not guaranteed identical. A floating dependency or a changed base image reintroduces exactly the class of bug the pipeline exists to catch.',
},
{text: 'It doubles the build time', why: 'True and secondary — the correctness problem is what matters.'},
{text: 'Staging and production must always run different builds', why: 'The opposite: promoting one identical artefact is the goal.'},
{text: 'It prevents rollback', why: 'Rollback is affected by artefact retention rather than by how many times you build.'},
]}
explanation={<>Build once, deploy everywhere: produce a single container image or bundle, and promote that same artefact through each environment. Configuration differs per environment; the artefact does not.</>}
reference={{label: 'Pipeline stages', href: '/knowledge-base/hosting/ci-cd#pipeline-stages'}}
/>

<Quiz
question="During a rolling deploy, a migration renames the column `email` to `email_address` and the new code uses the new name. What happens?"
options={[
{
text: 'Instances still running the old code query a column that no longer exists and start failing until the rollout completes',
correct: true,
why: 'Rolling deploys run two versions simultaneously against one migrated schema. A rename is destructive to whichever version is not yet updated.',
},
{text: 'Nothing — the database handles the rename transparently for old queries', why: 'There is no aliasing; the old column name is simply gone.'},
{text: 'The migration blocks until all old instances have stopped', why: 'Migrations do not coordinate with application rollout.'},
{text: 'Only writes fail; reads continue from a cached schema', why: 'Both fail — the column does not exist for either.'},
]}
explanation={<>Use expand–contract: add the new column and write to both, backfill, deploy code that reads the new one, then drop the old column in a <em>later</em> deploy. This is the most common self-inflicted deployment outage, and it is entirely avoidable.</>}
reference={{label: 'Database migrations', href: '/knowledge-base/hosting/ci-cd#database-migrations'}}
/>

<Quiz
question="A team adds automatic retries to CI so that intermittently failing tests pass on the second attempt. Why is this a bad trade?"
options={[
{
text: 'It hides genuine intermittent bugs — race conditions and ordering problems reach production because the pipeline reports green',
correct: true,
why: 'A flaky test is often reporting a real non-determinism in the code. Retrying suppresses the signal without removing the defect.',
},
{text: 'Retries make the pipeline slower', why: 'They do, and that is not the main cost.'},
{text: 'Most CI platforms do not support retries', why: 'Nearly all do; the question is whether you should use them this way.'},
{text: 'Retries invalidate code coverage figures', why: 'Coverage is unaffected in any way that matters here.'},
]}
explanation={<>Quarantine flaky tests out of the blocking path <em>with a ticket and an owner</em>, then fix the underlying non-determinism — usually a fixed sleep, shared mutable state, test-order dependence, or a real network call. Quarantining without fixing is how suites rot.</>}
reference={{label: 'Flaky tests', href: '/knowledge-base/hosting/ci-cd#flaky-tests'}}
/>

<Quiz
question="Which practices improve CI/CD security?"
type="multiple"
options={[
{text: 'Pinning third-party actions to a commit SHA rather than a tag', correct: true, why: 'Tags are mutable. A compromised action running with your production secrets is a supply-chain compromise, and this has happened to widely used actions repeatedly.'},
{text: 'Using OIDC federation instead of stored cloud credentials', correct: true, why: 'The workflow assumes a role and gets short-lived credentials, so there is no long-lived key to leak.'},
{text: 'Scoping production secrets to a protected environment with required approval', correct: true, why: 'A pull-request build then cannot read credentials it has no business having.'},
{text: 'Withholding secrets from forked pull-request builds', correct: true, why: 'Fork code is untrusted. This is the platform default for good reason, and the workarounds are dangerous.'},
{text: 'Echoing secret values during debugging to confirm they are set', why: 'Masking is best-effort and constructed strings leak. Assert that a value is non-empty instead of printing it.'},
]}
explanation={<>The pipeline holds credentials to production, which makes it a target. Anyone who can edit a workflow file can exfiltrate every secret it uses — review those changes accordingly.</>}
reference={{label: 'Pipeline security', href: '/knowledge-base/hosting/ci-cd#pipeline-security'}}
/>

<Quiz
question="A team adopts canary deploys, routing 5% of traffic to the new version for ten minutes before completing the rollout. They have no error-rate or latency dashboards. What have they achieved?"
options={[
{
text: 'A slower deploy with none of the safety — a canary is only useful if you are measuring well enough to detect a problem in that 5%',
correct: true,
why: 'The strategy provides an observation window. Without metrics to observe, nothing is being evaluated during it.',
},
{text: 'A meaningful safety improvement, since fewer users are exposed initially', why: 'Only if the exposure is noticed — otherwise the rollout proceeds into the same failure a few minutes later.'},
{text: 'Automatic rollback on failure', why: 'Automatic rollback requires exactly the metrics they do not have.'},
{text: 'Equivalent protection to blue-green deployment', why: 'Blue-green offers instant rollback by traffic switch, which is a different mechanism.'},
]}
explanation={<>Add error rate, latency and a few business metrics per version before canarying. Feature flags are often the better first step — they decouple deploy from release and let you disable a misbehaving feature with no deploy at all.</>}
reference={{label: 'Deployment strategies', href: '/knowledge-base/hosting/ci-cd#deployment-strategies'}}
/>

---

## References

- [DORA metrics](https://dora.dev/guides/dora-metrics-four-keys/) — what a
  healthy delivery process measures.
- [GitHub Actions documentation](https://docs.github.com/en/actions) — workflows,
  environments and OIDC.
- [GitLab CI/CD documentation](https://docs.gitlab.com/ee/ci/) — pipelines,
  stages and rules.
- [Martin Fowler: Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html)
  — the practice, independent of tooling.
- [OpenSSF: Securing CI/CD](https://openssf.org/) — supply-chain guidance for
  build systems.
- [GitHub Actions](/knowledge-base/hosting/github-actions) — the concrete
  implementation of everything here.
