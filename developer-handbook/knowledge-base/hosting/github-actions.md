---
title: 'GitHub Actions'
description: 'CI/CD workflows that live alongside your repository — syntax, caching, matrices, reusable workflows, OIDC and fork security.'
---

# GitHub Actions

## Introduction

GitHub Actions runs workflows defined in YAML inside your repository, triggered
by events: pushes, pull requests, schedules, releases, or a manual click.

**Why it dominates:** the workflow lives with the code, the marketplace covers
almost everything, and public repositories run free. For a team already on
GitHub, the integration — checks on pull requests, deployment environments,
required approvals — is worth more than a marginally better standalone CI
product.

**Where the difficulty actually is:** not the syntax, which is straightforward,
but two things that bite later —

1. **Caching**, which is the difference between a two-minute pipeline and a
   twelve-minute one.
2. **Secrets and fork-triggered workflows**, which is where the security
   incidents are.

This page assumes the concepts on the
[CI/CD page](/knowledge-base/hosting/ci-cd) — stages, artefacts, deployment
strategies, migrations — and covers the GitHub-specific implementation.

**Version note.** The examples below use the current major versions of the
official actions: `checkout@v7`, `setup-node@v7`, `cache@v6`,
`upload-artifact@v7`. Runners default to Node 24 as of June 2026, and older
action majors that bundle Node 20 now emit deprecation warnings.

---

## Anatomy of a Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run lint
      - run: npm test
```

**The structure:**

| Level        | What it is                                                       |
| ------------ | ---------------------------------------------------------------- |
| **Workflow** | One YAML file in `.github/workflows/`                            |
| **Job**      | Runs on a fresh runner; jobs are parallel by default             |
| **Step**     | A command (`run`) or an action (`uses`), sequential within a job |
| **Action**   | A reusable unit from the marketplace or your own repository      |

**Three settings worth adding to every workflow from the start:**

- **`concurrency` with `cancel-in-progress`** — cancels the previous run when
  you push again. Saves a great deal of runner time on active branches.
- **`permissions: contents: read`** at the top level — the default token is
  broader than most workflows need, and narrowing it is a one-line improvement.
- **`timeout-minutes`** on jobs — the default is six hours, and a hung job will
  happily consume all of it.

**Jobs do not share a filesystem.** Each runs on a fresh machine. To pass
anything between them, use `upload-artifact`/`download-artifact` or job outputs.
This surprises people who expect a single workspace.

---

## Caching

The highest-leverage change in most workflows.

**Language setup actions have caching built in**, and it is the easiest route:

```yaml
- uses: actions/setup-node@v7
  with:
    node-version: 22
    cache: npm # also: yarn, pnpm
```

**Manual caching** for anything else:

```yaml
- uses: actions/cache@v6
  with:
    path: |
      ~/.cache/ms-playwright
      .next/cache
    key: ${{ runner.os }}-build-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-build-
```

**How keys work, which is the part people get wrong:**

- An **exact `key` match** restores the cache and skips saving at the end.
- A miss falls back to the first matching **`restore-keys`** prefix, restores
  that, and **saves a new cache under the exact key** afterwards.
- **Caches are immutable.** You cannot overwrite a key — hash the lock file into
  it so a dependency change produces a new key naturally.

**`npm ci` is correct even with a cache.** The cache holds the download
directory, not `node_modules`; `ci` still installs, but from local files.
Caching `node_modules` directly is fragile across Node versions and platforms.

**Limits:** 10 GB per repository, and entries unused for 7 days are evicted.
When the limit is hit, the least recently used entries are removed — which shows
up as an inexplicable cache miss on a rarely built branch.

**Cache scoping is a security boundary.** A branch can read caches from its base
branch and from the default branch, but not from sibling branches. This prevents
cache poisoning between unrelated pull requests, and it means the first run on a
new branch will miss.

---

## Matrix Builds

Run the same job across combinations:

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [20, 22, 24]
        exclude:
          - os: windows-latest
            node: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci && npm test
```

**`fail-fast: false` is usually what you want.** The default cancels every
remaining combination on the first failure, which hides whether the problem is
one platform or all of them — exactly what the matrix was meant to tell you.

**Watch the multiplication.** Three operating systems by three Node versions is
nine jobs, and Windows and macOS runners are billed at higher multipliers on
private repositories. Use `include` to add specific combinations rather than
expanding the whole grid.

---

## Secrets and Environments

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production # required reviewers, branch rules, scoped secrets
    steps:
      - run: ./deploy.sh
        env:
          API_TOKEN: ${{ secrets.API_TOKEN }}
```

**Environments are the mechanism that makes production deploys safe:**

- **Required reviewers** — a human approves before the job runs.
- **Deployment branch rules** — only `main` may deploy to production.
- **Environment secrets** — production credentials are unreadable from any job
  that does not name the environment.
- **Wait timers** — a delay before deployment proceeds.

**Secret handling:**

- Secrets are masked in logs on a best-effort basis. **A secret you transform —
  base64, JSON-encode, interpolate into a URL — is no longer masked.**
- Never `echo` a secret to check it is set. Assert non-emptiness instead:
  `[ -n "$TOKEN" ] || exit 1`.
- Secrets are unavailable to workflows triggered by pull requests from forks.
  **That is deliberate. Do not work around it.**

---

## OIDC: Deploying Without Stored Credentials

The most valuable security improvement available to most pipelines.

Instead of storing a long-lived cloud key, the workflow requests a short-lived
OIDC token from GitHub and exchanges it for temporary cloud credentials:

```yaml
permissions:
  id-token: write # required to request the OIDC token
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v5
    with:
      role-to-assume: arn:aws:iam::123456789012:role/github-deploy
      aws-region: eu-west-2
```

The IAM trust policy restricts which repository, and which branch or
environment, may assume the role. **No secret is stored anywhere**, credentials
expire in minutes, and a leaked log reveals nothing reusable.

AWS, Google Cloud, Azure, HashiCorp Vault and others support this. If you are
storing cloud access keys as repository secrets today, this is the change to
make. See [AWS: IAM](/knowledge-base/hosting/aws#iam).

---

## Reusable Workflows and Composite Actions

**Reusable workflows** — call an entire workflow from another:

```yaml
# .github/workflows/deploy.yml
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
    secrets:
      DEPLOY_TOKEN:
        required: true
```

```yaml
jobs:
  deploy-staging:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: staging
    secrets: inherit
```

**Composite actions** bundle several steps into one `uses:`, for repeated setup
sequences within jobs.

|                       | Use for                                                    |
| --------------------- | ---------------------------------------------------------- |
| **Reusable workflow** | Whole jobs; can define its own runner, matrix, environment |
| **Composite action**  | A sequence of steps inside an existing job                 |

Both prevent the copy-paste drift that makes ten workflow files slowly diverge.
Put them in a central repository once more than one project needs them.

---

## Security

The workflow has credentials to your infrastructure. Treat it accordingly.

**Pin third-party actions to a full commit SHA:**

```yaml
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0
```

**Tags are mutable.** Anyone who can move `v4` to a malicious commit runs code
inside your job with access to its secrets. This has happened to widely used
actions more than once, including one 2025 incident where a popular action was
altered to dump runner memory — and therefore secrets — into build logs across
thousands of repositories. Dependabot keeps SHA pins updated, so the cost is
low.

**`pull_request_target` is the dangerous trigger.** It runs with write
permissions and access to secrets, in the context of the _base_ repository. If
you then check out the pull request's code and run it, you have executed
untrusted code with your secrets. **Do not check out or execute PR code under
`pull_request_target`.** Use plain `pull_request` for anything that runs the
contributor's code.

**Never interpolate untrusted input into `run` blocks:**

```yaml
# ❌ script injection — a PR title can contain shell metacharacters
- run: echo "Title: ${{ github.event.pull_request.title }}"

# ✅ pass through the environment
- run: echo "Title: $TITLE"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

The first form substitutes the title into the script _before_ the shell sees it,
so a crafted title executes commands. The second passes it as data.

**Also:**

- Set `permissions` explicitly, at workflow or job level.
- Self-hosted runners should be ephemeral. A persistent runner lets one job
  leave state — or a backdoor — for the next.
- Never run self-hosted runners on public repositories: anyone can open a pull
  request and execute code on your machine.
- Enable secret scanning and push protection.

See [Pipeline security](/knowledge-base/hosting/ci-cd#pipeline-security).

---

## A Complete Deployment Workflow

```yaml
name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-production
  cancel-in-progress: false # never cancel a deploy mid-flight

permissions:
  contents: read
  id-token: write

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v7
        with:
          name: dist
          path: dist/
          retention-days: 7

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/download-artifact@v7
        with:
          name: dist
          path: dist/
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: ${{ vars.DEPLOY_ROLE_ARN }}
          aws-region: eu-west-2
      - run: aws s3 sync dist/ s3://my-bucket --delete
```

**Note `cancel-in-progress: false` on the deploy group.** Cancelling a running
deploy leaves the system half-updated. Cancel builds freely; never cancel
deploys.

**Note the artefact.** `build` produces it once and `deploy` consumes it — the
build-once-deploy-everywhere rule, implemented.

---

## Do's and Don'ts

### Do

- Set `permissions` explicitly and minimally.
- Add `concurrency` with cancellation for CI, without it for deploys.
- Set `timeout-minutes` on every job.
- Cache dependencies keyed on the lock file hash.
- Use `fail-fast: false` on matrices you want full results from.
- Use environments with required reviewers for production.
- Use OIDC instead of stored cloud credentials.
- Pin third-party actions to a commit SHA, updated by Dependabot.
- Pass untrusted values through `env`, never into `run` directly.
- Extract shared logic into reusable workflows.

### Don't

- Don't check out or run pull-request code under `pull_request_target`.
- Don't interpolate `github.event` values into shell commands.
- Don't echo secrets, even to debug.
- Don't assume a transformed secret is still masked.
- Don't expect jobs to share a filesystem.
- Don't run self-hosted runners on public repositories.
- Don't use `latest` or mutable tags for third-party actions.
- Don't cache `node_modules` directly.
- Don't leave the default six-hour timeout in place.

---

## Common Mistakes

**Expecting state to carry between jobs.** Each job is a fresh machine. Use
artefacts or outputs.

**Caching `node_modules`.** Breaks across Node versions and platforms. Cache the
package manager's download directory — or use the setup action's `cache` input.

**Cache never hitting.** The key contains something that changes every run, such
as `github.sha`. Keys should change only when the inputs change.

**Script injection through `github.event`.** A crafted pull request title or
branch name executes commands. Pass through `env`.

**`pull_request_target` with a PR checkout.** Untrusted code, write permissions,
and your secrets. This is the single most exploited Actions misconfiguration.

**Unpinned third-party actions.** A moved tag is a supply-chain compromise.

**Secrets undefined in a fork PR.** Working as designed. Restructure the
workflow rather than defeating the protection.

**A workflow that never triggers.** Check the `on:` filters — `paths`,
`branches`, and the fact that a workflow must exist on the default branch for
`schedule` and `workflow_dispatch` to appear.

**Deploys cancelled mid-flight.** `cancel-in-progress: true` on a deploy
concurrency group leaves the system half-updated.

---

## Debugging

```yaml
# Re-run any workflow with debug logging from the UI, or set:
#   ACTIONS_RUNNER_DEBUG: true
#   ACTIONS_STEP_DEBUG: true
```

| Symptom                      | Where to look                                               |
| ---------------------------- | ----------------------------------------------------------- |
| Workflow does not run        | `on:` filters; must be on the default branch for `schedule` |
| Secret is empty              | Fork PR, or the job does not name the environment           |
| Cache always misses          | A volatile component in the key; or 7-day eviction          |
| Passes locally, fails in CI  | Runner OS, Node version, timezone, locale, missing env vars |
| Permission denied to the API | `permissions` too narrow, or `GITHUB_TOKEN` scope           |
| Job hangs                    | A command waiting on stdin; set `timeout-minutes`           |
| Artefact not found           | Wrong job order, or `needs:` missing                        |
| Deprecation warnings         | An action major bundling an old Node runtime                |

**`act` runs workflows locally** in Docker for fast iteration. It is an
approximation rather than a replica — services, permissions and the runner image
all differ — so verify anything important on a real runner.

**Push a debugging branch rather than committing repeatedly to a pull request.**
Workflow debugging generates a lot of noise, and a scratch branch keeps it out
of the review history.

---

## FAQ

**Is it free?**
Free and unlimited on public repositories. Private repositories get a monthly
minute allowance, with Windows billed at 2× and macOS at 10× the Linux rate.

**Larger runners?**
Available as a paid option with more CPU and memory. Often cheaper overall than
a slow pipeline consuming developer attention.

**Self-hosted runners?**
For private network access, specific hardware, or heavy usage. Make them
ephemeral, and never attach them to a public repository.

**How do I test a workflow before merging?**
Push to a branch and add it to the `on: push: branches:` list temporarily, or
use `workflow_dispatch` to run it manually.

**Can I run a workflow on a schedule?**
Yes, with `schedule` and cron syntax. Note that it runs in UTC, execution can be
delayed under load, and scheduled workflows are disabled automatically after 60
days without repository activity.

**How do I share workflows across repositories?**
Reusable workflows in a central repository, referenced as
`org/repo/.github/workflows/ci.yml@main`. Pin the reference for anything
security-sensitive.

---

## Check your understanding

<Quiz
question="A workflow uses `pull_request_target`, checks out the pull request's head commit, and runs the project's build script. Why is this dangerous?"
options={[
{
text: 'pull_request_target runs with write permissions and access to secrets, so checking out and executing the contributor\'s code runs untrusted code with your credentials',
correct: true,
why: 'The trigger exists so that a workflow can act on a fork PR with base-repository privileges. Executing the PR\'s own code under those privileges hands them to anyone who can open a pull request.',
},
{text: 'pull_request_target cannot access the pull request\'s code at all', why: 'It can, by explicit ref — that capability is precisely what makes the pattern exploitable.'},
{text: 'It runs the workflow twice, doubling minute usage', why: 'A billing concern at worst, and not the security problem.'},
{text: 'Secrets are unavailable under pull_request_target', why: 'The reverse — they are available, which is the whole issue.'},
]}
explanation={<>Use plain <code>pull_request</code> for anything that executes contributor code: it has no secrets and read-only permissions by default. Reserve <code>pull_request_target</code> for workflows that only read metadata — labelling, commenting — and never check out the PR ref inside it.</>}
reference={{label: 'Security', href: '/knowledge-base/hosting/github-actions#security'}}
/>

<Quiz
question="A step runs a shell echo command with the pull request title interpolated directly into it as an Actions expression. What is wrong with that?"
options={[
{
text: 'The expression is substituted into the script before the shell runs it, so a crafted pull request title can execute arbitrary commands',
correct: true,
why: 'Actions expressions are textual substitution into the generated script. A title containing shell metacharacters becomes part of the command rather than data.',
},
{text: 'github.event.pull_request.title is not available in that context', why: 'It is available; availability is not the problem.'},
{text: 'echo does not support interpolated expressions', why: 'The interpolation happens before echo is involved at all.'},
{text: 'It exposes the PR title in the logs', why: 'Pull request titles are already public information.'},
]}
explanation={<>Pass untrusted values through the environment instead: bind the expression to an <code>env</code> variable on the step, then reference <code>$TITLE</code> in the script. The value reaches the shell as data rather than as source code. The same applies to branch names, commit messages and issue bodies.</>}
reference={{label: 'Security', href: '/knowledge-base/hosting/github-actions#security'}}
/>

<Quiz
question="A workflow's dependency cache never seems to hit. The key is `${{ runner.os }}-npm-${{ github.sha }}`. What is wrong?"
options={[
{
text: 'The commit SHA changes on every run, so every key is unique and no cache can ever match',
correct: true,
why: 'A cache key must change only when the cached content should change. Including the SHA guarantees a miss and a fresh save every single run.',
},
{text: 'runner.os is not a valid expression in a cache key', why: 'It is valid and appropriate — caches are platform-specific.'},
{text: 'Caches expire after 24 hours', why: 'Entries are evicted after 7 days without use, not 24 hours.'},
{text: 'npm caches cannot be restored with actions/cache', why: 'They can, though the setup-node cache input is simpler.'},
]}
explanation={<>Key on the lock file: <code>{'${{ hashFiles(\'**/package-lock.json\') }}'}</code>. Add <code>restore-keys</code> with a prefix so a dependency change still restores the nearest previous cache and then saves a fresh one under the new key.</>}
reference={{label: 'Caching', href: '/knowledge-base/hosting/github-actions#caching'}}
/>

<Quiz
question="Which of these belong in a production-grade workflow?"
type="multiple"
options={[
{text: 'permissions: contents: read at the top level', correct: true, why: 'The default GITHUB_TOKEN is broader than most workflows need, and narrowing it costs one line.'},
{text: 'Third-party actions pinned to a full commit SHA', correct: true, why: 'Tags are mutable, and a moved tag runs attacker code with your secrets. Dependabot keeps SHA pins current.'},
{text: 'timeout-minutes on every job', correct: true, why: 'The default is six hours, and a job waiting on stdin will consume all of it.'},
{text: 'An environment with required reviewers for production deploys', correct: true, why: 'It scopes production secrets away from ordinary jobs and puts a human in the path.'},
{text: 'concurrency with cancel-in-progress: true on the deploy job', why: 'Cancel builds freely; cancelling a deploy mid-flight leaves the system half-updated. Use a concurrency group without cancellation for deploys.'},
]}
explanation={<>The defaults are tuned for getting started rather than for production. Each of these is a single line that removes a whole category of incident.</>}
reference={{label: 'A complete deployment workflow', href: '/knowledge-base/hosting/github-actions#a-complete-deployment-workflow'}}
/>

<Quiz
question="A team stores an AWS access key as a repository secret to deploy from Actions. What is the better arrangement?"
options={[
{
text: 'Grant the workflow id-token: write and use OIDC to assume an IAM role, with the trust policy scoped to the repository and branch',
correct: true,
why: 'GitHub issues a short-lived token that AWS exchanges for temporary credentials. Nothing long-lived is stored, and a leaked log reveals nothing reusable.',
},
{text: 'Store the key in an environment secret and rotate it quarterly', why: 'An improvement on a repository secret, and still a permanent credential that exists to be leaked.'},
{text: 'Encrypt the key in the repository and decrypt it at runtime', why: 'The decryption key becomes the secret, and now it is committed as well.'},
{text: 'Use a self-hosted runner with the key in its environment', why: 'It moves the credential onto a machine you must now also secure, and persistent runners leak state between jobs.'},
]}
explanation={<>OIDC is supported by AWS, Google Cloud, Azure and Vault, and it is the single highest-value security change available to most pipelines. The IAM trust policy can restrict which repository, branch or environment may assume the role.</>}
reference={{label: 'OIDC', href: '/knowledge-base/hosting/github-actions#oidc-deploying-without-stored-credentials'}}
/>

---

## References

- [GitHub Actions documentation](https://docs.github.com/en/actions) — the full
  reference.
- [Workflow syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
  — every key, with defaults.
- [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
  — script injection, `pull_request_target`, and runner risks.
- [OIDC in cloud providers](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
  — keyless deployment setup.
- [Caching dependencies](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
  — keys, restore-keys and scoping rules.
- [CI/CD](/knowledge-base/hosting/ci-cd) — the concepts these workflows
  implement.
