---
id: best-practices
title: Best Practices
sidebar_position: 3
description: Commit hygiene, branching strategies, review, signing, secrets and repository maintenance — the practices that keep Git history useful instead of merely present.
---

# Best Practices

## Introduction

Git records whatever you tell it to. The difference between a history that helps
you and one that merely exists is entirely a matter of habit.

The purpose of good Git practice is not tidiness for its own sake. It is that
six months from now, someone — probably you — will be looking at a line of code
asking _why is this here?_ A good history answers that in thirty seconds. A bad
one sends you to the person who wrote it, who has also forgotten.

Every practice below is judged against that test.

---

## Commits

### Make each commit one logical change

A commit should be the smallest change that leaves the codebase working. Not one
file, not one day's work — one _idea_.

This is a practical property, not an aesthetic one. Small, coherent commits make
`git bisect` precise, make `git revert` safe, make review possible, and make
`git log -S` useful. A 2,000-line commit called "refactor" is effectively opaque
to every one of those tools.

If you have made three unrelated changes in one session, separate them:

```bash
git add -p            # stage only the hunks belonging to the first change
git commit -m "Fix off-by-one in pagination offset"
git add -p            # then the next
git commit -m "Rename userSvc to userService for consistency"
```

### Write messages that explain why

The diff already shows _what_ changed. The message exists for _why_.

```text
Add retry with exponential backoff to the payments client

Stripe intermittently returns 503 during their maintenance windows,
which surfaced to users as a failed checkout roughly twice a week.

Retries three times with backoff and full jitter, only for 5xx and
network errors — 4xx responses are not retried, since they indicate a
problem with the request itself.

Fixes #482
```

The mechanics:

- **Subject line under ~50 characters, imperative mood, no full stop.** "Add
  retry", not "Added retry" or "Adds retry". The convention reads naturally as
  "if applied, this commit will _add retry_", and it matches Git's own generated
  messages like "Merge branch…".
- **Blank line, then the body wrapped at ~72 characters.** Tools do not wrap it
  for you.
- **The body covers why, what changed at a high level, and anything
  non-obvious** — a rejected alternative, a constraint, a link to the incident.
- **Reference issues** so the ticket and the code stay connected.

### Conventional Commits

If you want machine-readable history — automated changelogs and version bumps —
adopt a prefix convention:

```text
feat(auth): add passkey login
fix(api): reject negative quantities in the order endpoint
docs: clarify the rate-limit headers table
refactor(db): extract the connection pool into its own module
perf(search): add a covering index for the tag filter
test(cart): cover the empty-basket edge case
chore(deps): bump express to 5.1.0

feat(api)!: remove the deprecated /v1/users endpoint

BREAKING CHANGE: clients must migrate to /v2/users before 1 March.
```

`feat` triggers a minor version bump, `fix` a patch, and `!` or a
`BREAKING CHANGE:` footer a major one, which lets tooling derive
[SemVer](/knowledge-base/general/versioning-and-configuration#semantic-versioning) releases and a changelog
from history alone.

Adopt it if you publish a package or generate release notes. If you do neither,
a clear plain-English subject is worth more than a prefix nobody reads.

### Amend and fix up before pushing

Review feedback should not produce a trail of "address review comments"
commits:

```bash
git commit --fixup a1b2c3d          # marks this as belonging to commit a1b2c3d
# … more review rounds, more fixups …
git rebase -i --autosquash main     # folds every fixup into its target
```

The branch that lands is then the branch you would have written if you had got
it right first time.

---

## Branching

### Name branches predictably

```text
feature/passkey-login
fix/checkout-503-retry
chore/bump-express-5
docs/api-rate-limits
release/2026.08
```

Use a type prefix, lowercase, hyphens rather than spaces or underscores. Include
the issue number if your team tracks work that way (`fix/482-checkout-retry`).
Predictable names make branch lists scannable and let CI rules match on prefix.

### Pick a strategy deliberately

| Strategy        | How it works                                                                     | Suits                                               |
| --------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Trunk-based** | Everyone commits to `main` (or via same-day short branches) behind feature flags | Continuous deployment, strong test coverage         |
| **GitHub Flow** | Branch from `main`, PR, merge, deploy `main`                                     | Most web teams — the sensible default               |
| **GitLab Flow** | GitHub Flow plus long-lived environment branches (`staging`, `production`)       | Teams needing an explicit promotion path            |
| **Git Flow**    | `develop`, `release/*`, `hotfix/*`, `feature/*`, `main`                          | Versioned software with parallel supported releases |

**Recommendation: GitHub Flow unless you have a specific reason otherwise.** One
long-lived branch, short-lived feature branches, deploy from `main`. It is
simple enough that nobody gets it wrong.

Git Flow is widely cited and usually the wrong choice for a web application. Its
author has [said as much](https://nvie.com/posts/a-successful-git-branching-model/):
it was designed for software with multiple versions in support simultaneously,
not for something continuously deployed. Its `develop`/`main` split adds a merge
step that buys nothing when you deploy every day.

### Keep branches short-lived

A branch open for three weeks is three weeks of divergence, and the merge cost
grows super-linearly. Aim for **one to three days**. If a change genuinely takes
longer, merge it in stages behind a feature flag rather than accumulating a
600-file pull request.

### Keep the branch current

```bash
git fetch origin
git rebase origin/main      # your commits replay on top of current main
```

Rebasing daily surfaces conflicts while they are small and while you still
remember the code. Because the branch is unpublished (or published only for
review), rewriting is safe. Once someone else has based work on your branch,
switch to merging.

---

## Integration and Review

### Choose one merge strategy and apply it consistently

| Method           | History                          | Use when                                                |
| ---------------- | -------------------------------- | ------------------------------------------------------- |
| **Squash merge** | One commit per PR                | Default for most teams — clean, and `main` bisects well |
| **Merge commit** | Full branch history plus a merge | The individual commits are meaningful and worth keeping |
| **Rebase merge** | Linear, every commit on `main`   | You require a strictly linear history                   |

Squash merging is the pragmatic default: contributors can commit as messily as
they like while working, and `main` still reads as one clean change per feature.
The trade-off is that the branch's internal steps are lost, so if the commits
were genuinely well-structured, a merge commit preserves more value.

What matters most is _consistency_. A repository that mixes all three is
unreadable.

### Make pull requests reviewable

- **Small.** Under ~400 changed lines is where review quality falls off a cliff.
- **One concern per PR.** A refactor plus a feature means the reviewer can
  approve neither with confidence.
- **Separate mechanical changes.** Renames, reformatting and dependency bumps go
  in their own PR — otherwise the real change is buried in noise.
- **Describe the why.** What problem, what approach, what alternatives were
  rejected, how it was tested.
- **Self-review first.** Read your own diff in the PR view before requesting a
  review. You will find something every time.

### Protect the default branch

On any repository with more than one contributor:

- Require a pull request; disallow direct pushes to `main`.
- Require CI to pass.
- Require at least one approving review.
- Require the branch to be up to date before merging.
- Block force pushes and deletion.
- Require signed commits, if your organisation needs provenance.

These are forge settings (GitHub branch protection or rulesets, GitLab protected
branches), not Git settings. Git itself has no concept of permissions.

---

## Ignoring and Attributing Files

### .gitignore

```gitignore title=".gitignore"
# Dependencies
node_modules/
vendor/

# Build output
dist/
build/
*.tsbuildinfo

# Environment and secrets
.env
.env.*
!.env.example          # …but do commit the template

# Editor and OS noise
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

# Logs and coverage
*.log
coverage/
```

Rules worth knowing:

- **A trailing slash means directory only.** `build/` ignores the directory,
  `build` also ignores a file named `build`.
- **`!` re-includes**, but cannot re-include a file whose _parent directory_ is
  excluded.
- **`.gitignore` does not affect already-tracked files.** Adding a rule for a
  committed file changes nothing until you run `git rm --cached <file>`.
- **Personal preferences belong in a global ignore file**, not in the project's:
  `git config --global core.excludesFile ~/.gitignore_global`. Your editor's
  directory is not everyone's problem.
- `git check-ignore -v <path>` tells you exactly which rule is matching.

### .gitattributes

Less well known and more useful than most people realise:

```gitattributes title=".gitattributes"
# Normalise line endings for everyone (see the Git setup page).
* text=auto
*.sh text eol=lf

# Mark generated files so they collapse in PR diffs and are excluded
# from language statistics.
package-lock.json linguist-generated=true
dist/** linguist-generated=true

# Treat these as binary — no diff, no merge attempt.
*.png binary
*.woff2 binary

# Exclude development files from `git archive` and release tarballs.
tests/ export-ignore
.github/ export-ignore

# Use a union merge for changelogs so both sides' lines are kept.
CHANGELOG.md merge=union
```

### Large files

Git stores every version of every file forever. A 50 MB binary committed once is
in the repository permanently — deleting it later does not shrink the clone,
because the object is still reachable from old commits.

Use **Git LFS** for assets that legitimately belong in the repository:

```bash
git lfs install
git lfs track "*.psd" "*.mp4"
git add .gitattributes
```

Better still, keep large artefacts out entirely: object storage for media,
a package registry for build outputs, a CDN for anything served.

---

## Tags and Releases

```bash
git tag -a v2.4.0 -m "Release 2.4.0"
git push origin v2.4.0
```

- **Annotated tags for releases**, always. They record who, when and why, can be
  signed, and are what `git describe` uses.
- **Follow [SemVer](/knowledge-base/general/versioning-and-configuration#semantic-versioning)** so consumers
  can reason about upgrades.
- **Tags are immutable by convention.** Never move a published tag; clones that
  already have it will not update, so different people end up with different
  ideas of what `v2.4.0` contains.
- **Generate release notes from history.** This is where Conventional Commits
  pays off — the changelog writes itself.

---

## Hooks and CI

Automate the checks that catch mistakes cheaply, and put each at the level where
it belongs:

| Stage        | Check                                 | Why there                                    |
| ------------ | ------------------------------------- | -------------------------------------------- |
| `pre-commit` | Lint and format **staged files only** | Instant feedback; must stay under ~2 seconds |
| `commit-msg` | Message convention                    | Cheapest possible moment to enforce it       |
| `pre-push`   | Type check, fast unit tests           | Catches the obvious before CI                |
| **CI**       | Full suite, build, security scan      | The authority — hooks can always be bypassed |

```json title="package.json (lint-staged)"
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

Two rules. **Keep hooks fast** — a slow `pre-commit` hook teaches the team to
run `--no-verify`, which is worse than no hook. And **never rely on hooks for
correctness**: they are local, bypassable and not installed on a fresh clone.
Anything that must be true has to be enforced in CI.

Since Git 2.54, hooks can be declared in configuration instead of only as
scripts in `.git/hooks`, which allows multiple hooks per event and centrally
managed hooks — see
[Key Concepts](/knowledge-base/git/key-concepts#hooks).

---

## Security

### Never commit secrets

The critical point: **removing a secret in a later commit does not remove it.**
It is in history, in every clone, and in every fork. The only correct response
to a committed credential is to **rotate it immediately** — then clean history
if you must.

Prevent it instead:

```bash
# Scan the whole repository, including history.
gitleaks detect --source .

# Block commits containing secrets, locally.
gitleaks protect --staged
```

Enable your forge's secret scanning with push protection (GitHub, GitLab both
offer it), keep `.env` in `.gitignore`, and commit a `.env.example` with keys
but no values.

If a secret does land: rotate first, then use
[`git filter-repo`](https://github.com/newren/git-filter-repo) to purge it, then
force-push and ask everyone to re-clone. See
[Common Mistakes](/knowledge-base/git/common-mistakes#committing-a-secret).

### Sign your commits

Signing proves a commit came from you. Without it, `user.email` is a free-text
field — anyone can author a commit as anyone.

SSH signing is much simpler to set up than GPG and is supported by GitHub and
GitLab:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

Then add the same public key to your forge account as a _signing_ key (separate
from the authentication key entry).

### Verify what you pull

Treat repository content as untrusted input. A malicious `.gitattributes`, a
hook in a submodule, or a build script in a dependency all execute on your
machine. Be as careful cloning an unfamiliar repository as you would be running
its code — because you are.

---

## Repository Maintenance

```bash
# Register background maintenance (prefetch, incremental repack, commit-graph).
git maintenance start

# Delete remote-tracking refs for branches deleted upstream.
git fetch --all --prune

# List local branches already merged into main.
git branch --merged main | grep -v "^\*\|main"

# Check size and object counts.
git count-objects -vH
```

For very large repositories:

- **Partial clone** — `--filter=blob:none` gives full history with file contents
  fetched on demand.
- **Sparse checkout** — work with a subset of directories:
  `git sparse-checkout set apps/web packages/ui`.
- **Commit-graph** — `git maintenance` keeps it current; it makes `git log
--graph` and merge-base computation dramatically faster.

---

## Do's and Don'ts

### Do

- Commit one logical change at a time, with a message explaining why.
- Stage with `git add -p` so you read your own diff.
- Keep branches short-lived and rebase them onto `main` daily.
- Squash-merge (or pick one strategy and stick to it).
- Protect `main` with required reviews and required CI.
- Use annotated, signed tags for releases.
- Keep hooks fast and enforce correctness in CI.
- Add `.gitattributes` to any repository with more than one operating system.
- Rotate any credential that touches a commit, immediately.

### Don't

- Don't commit generated output, dependencies or secrets.
- Don't let a pull request exceed a few hundred lines.
- Don't mix a refactor and a behaviour change in one commit or one PR.
- Don't rebase a branch that others have based work on.
- Don't use `git push --force` — alias `--force-with-lease --force-if-includes`.
- Don't move a published tag.
- Don't add your editor's directory to the project's `.gitignore`.
- Don't adopt Git Flow by default; most teams need GitHub Flow.

---

## FAQ

**Squash or merge commits?**
Squash unless the individual commits carry real information. Consistency matters
more than which you choose.

**How small is a small commit?**
Small enough that the subject line describes it completely without an "and".

**Should everyone sign commits?**
Yes if you publish software others depend on, or if your organisation needs
provenance. SSH signing makes it a two-minute setup, so the cost is low.

**Do we need Conventional Commits?**
Only if something consumes them — automated changelogs or version bumps. They
are overhead otherwise.

**How do we handle a monorepo?**
Sparse checkout and partial clone for size; path-filtered CI so a change to one
package does not run every suite; and scope your commit subjects
(`feat(web): …`) so history stays navigable.

**Is it bad to have merge commits in `main`?**
No. A merge commit per feature is perfectly readable. What is unreadable is
dozens of `Merge branch 'main' of …` commits from people running `git pull`
without `--rebase`.

---

## Check your understanding

<Quiz
question="Your team deploys the web app several times a day. Which branching strategy is the best default?"
options={[
{
text: 'GitHub Flow — short-lived branches off main, PR, merge, deploy main',
correct: true,
why: 'One long-lived branch and short feature branches matches continuous deployment. There is no release train to coordinate, so extra long-lived branches add ceremony without benefit.',
},
{
text: 'Git Flow — develop, release/_, hotfix/_ and main',
why: 'Designed for software with several versions in support at once. With daily deploys the develop/main split is an extra merge step that buys nothing.',
},
{
text: 'A long-lived branch per developer, merged monthly',
why: 'Maximises divergence and merge pain — the opposite of what continuous deployment needs.',
},
{
text: 'One branch per environment, with cherry-picks between them',
why: 'Cherry-picking between environment branches duplicates commits and makes it hard to tell what is actually deployed where.',
},
]}
explanation={<>Trunk-based development is also a strong fit at high deploy frequency, but it demands feature flags and strong test coverage. GitHub Flow is the safe default for most teams.</>}
reference={{label: 'Pick a strategy deliberately', href: '/knowledge-base/git/best-practices#pick-a-strategy-deliberately'}}
/>

<Quiz
question="An API key was committed three weeks ago and pushed to a public repository. It has since been removed in a later commit. What must you do?"
options={[
{
text: 'Rotate the key immediately, then optionally purge it from history',
correct: true,
why: 'The secret is in history, in every clone and in every fork, and public repositories are scraped continuously. Assume it is compromised — rotation is the only fix that actually works.',
},
{
text: 'Nothing further — the later commit removed it',
why: 'A later commit changes the current tree only. Anyone can read the old commit, and the object is present in every clone.',
},
{
text: 'Force-push a rewritten history and consider it resolved',
why: 'Rewriting helps future clones but cannot recall anything already fetched, forked or cached by the forge. The key is still compromised.',
},
{
text: 'Make the repository private',
why: 'It does not un-publish three weeks of exposure, and forks may already exist.',
},
]}
explanation={<>Order matters: rotate first, clean history second. Push protection and a <code>gitleaks</code> pre-commit hook prevent the next occurrence.</>}
reference={{label: 'Never commit secrets', href: '/knowledge-base/git/best-practices#never-commit-secrets'}}
/>

<Quiz
question="Which of these belong in a project's committed .gitignore?"
type="multiple"
options={[
{text: 'node_modules/', correct: true, why: 'Reinstallable from the lockfile, enormous, and platform-specific. Never commit it.'},
{text: '.env', correct: true, why: 'Contains secrets and differs per environment. Commit a .env.example with keys but no values instead.'},
{text: 'dist/ or build/', correct: true, why: 'Generated output. Committing it creates merge conflicts and lets the artefact drift from the source.'},
{text: '.DS_Store', why: 'A personal-machine artefact. It belongs in your global excludes file (core.excludesFile), not in every project you touch.'},
{text: 'package-lock.json', why: 'Must be committed — it is what makes installs reproducible. Mark it linguist-generated in .gitattributes to keep it out of diffs.'},
]}
explanation={<>The dividing line: commit anything needed to reproduce the build, ignore anything produced <em>by</em> the build, and put personal-environment noise in your global excludes.</>}
reference={{label: '.gitignore', href: '/knowledge-base/git/best-practices#gitignore'}}
/>

<Quiz
question="A pre-commit hook runs the full test suite and takes 90 seconds. Developers have started committing with --no-verify. What is the best fix?"
options={[
{
text: 'Move the test suite to CI and have pre-commit lint only the staged files',
correct: true,
why: 'Hooks must be fast enough that nobody wants to skip them. Correctness belongs in CI, which cannot be bypassed and runs on a fresh checkout.',
},
{
text: 'Remove the ability to use --no-verify',
why: 'Not possible — it is a client-side flag. And even if it were, the underlying problem is that the hook is too slow to be usable.',
},
{
text: 'Run the tests in a pre-push hook instead',
why: 'Better than pre-commit, but a 90-second push is still disruptive and still bypassable. The full suite belongs in CI.',
},
{
text: 'Ask the team not to use --no-verify',
why: 'A social fix for a design problem. It will hold until the next deadline.',
},
]}
explanation={<>Hooks are for fast, local feedback; CI is the authority. Anything that <em>must</em> be true cannot depend on a hook, because hooks are not installed on a fresh clone and can always be skipped.</>}
reference={{label: 'Hooks and CI', href: '/knowledge-base/git/best-practices#hooks-and-ci'}}
/>

<Quiz
question="Which commit message is best?"
options={[
{
text: '"Add retry with backoff to payments client" plus a body explaining that Stripe returns 503 during maintenance windows and that 4xx responses are deliberately not retried',
correct: true,
why: 'Imperative subject under 50 characters, and a body that captures why the change exists and a non-obvious decision — exactly what a future reader cannot get from the diff.',
},
{
text: '"fix: retry payments"',
why: 'Correctly formatted and correctly scoped, but it says only what the diff already shows. No reader learns why, or why 4xx is excluded.',
},
{
text: '"Fixed the bug where payments sometimes failed because Stripe was down during their maintenance window and we did not retry, so users saw an error"',
why: 'The information is good but it is all crammed into a subject line. Split it: short imperative subject, blank line, then the detail.',
},
{
text: '"Update PaymentsClient.ts"',
why: 'Restates the filename. This is the message Git would have to invent if you gave it nothing.',
},
]}
explanation={<>The test for a commit message: does it tell a future reader something the diff cannot? Mechanism is visible in the code; motivation and rejected alternatives are not.</>}
reference={{label: 'Write messages that explain why', href: '/knowledge-base/git/best-practices#write-messages-that-explain-why'}}
/>

---

## References

- [Conventional Commits](https://www.conventionalcommits.org/) — the
  specification.
- [How to Write a Git Commit Message](https://cbea.ms/git-commit/) — Chris
  Beams; the origin of the widely cited seven rules.
- [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)
  — the strategy itself, from GitHub.
- [git-filter-repo](https://github.com/newren/git-filter-repo) — the supported
  tool for rewriting history; `filter-branch` is deprecated.
- [Gitleaks](https://github.com/gitleaks/gitleaks) — secret scanning for
  history and staged changes.
- [GitHub: About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
  — SSH and GPG signing setup.
- [Git LFS](https://git-lfs.com/) — large file storage.
