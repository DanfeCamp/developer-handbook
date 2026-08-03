---
title: Git
description: "Version control with Git: what it actually stores, how to configure it properly, and where to go for concepts, commands, practices and recovery."
---

# Git

## Introduction

Git is a **distributed version control system**: a database of every state your
project has ever been in, plus the tools to move between those states, compare
them, and combine work from many people.

Linus Torvalds wrote it in 2005 after the Linux kernel lost access to its
proprietary VCS. The design goals were speed, strong integrity guarantees, and
first-class support for thousands of parallel branches — which is why Git feels
different from the tools that came before it.

**The problem it solves.** Without version control you have
`final_v2_REAL.zip`, no record of who changed what or why, no way to work on two
things at once, and no way to undo a change from three weeks ago without undoing
everything since. Git gives you a complete, verifiable history and the ability to
develop several things in parallel and combine them.

**What "distributed" buys you.** Every clone is a full repository containing the
entire history, not a thin checkout. You can commit, branch, diff and search
history with no network. There is no single point of failure: if the server
dies, any clone can restore it. And because history is a chain of hashes, you
cannot alter an old commit without changing every commit after it — tampering is
detectable.

### Snapshots, not diffs

The most useful mental correction for anyone arriving from Subversion:
**Git stores snapshots, not deltas.**

Each commit records the complete state of the project as a tree of files. Files
that did not change are not duplicated — the new tree simply points at the same
unchanged content, because objects are addressed by the hash of what is inside
them. Diffs are _computed on demand_ when you ask for one; they are not what is
stored.

This explains much of Git's behaviour: why branching is instant (a branch is a
file containing one hash), why checking out an old commit is fast, and why
rewriting history necessarily changes every commit hash after the edit.

---

## Installation & Setup

### Install

```bash
# macOS — bundled with the Xcode CLI tools, but Homebrew stays current
brew install git

# Debian / Ubuntu
sudo apt update && sudo apt install git

# Fedora
sudo dnf install git

# Windows — includes Git Bash and Git Credential Manager
winget install --id Git.Git -e

git --version   # 2.54.x at the time of writing (April 2026)
```

### First-time configuration

Git will not let you commit without an identity:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

The email is what links commits to your account on GitHub or GitLab. If you also
commit under a work identity, do not swap it by hand — see
[per-directory identities](#per-directory-identities).

### A configuration worth copying

These settings prevent whole categories of the problems described in
[Common Mistakes](/knowledge-base/git/common-mistakes):

```bash
# Name the first branch of new repositories `main` (the Git 3.0 default).
git config --global init.defaultBranch main

# Make `git pull` rebase instead of creating a merge bubble on every sync.
git config --global pull.rebase true

# Push the current branch to a same-named upstream, creating it if needed.
git config --global push.default simple
git config --global push.autoSetupRemote true

# Reuse recorded conflict resolutions — solve a recurring conflict once.
git config --global rerere.enabled true

# Better diffs: distinguish moved lines, and use a smarter diff algorithm.
git config --global diff.colorMoved zebra
git config --global diff.algorithm histogram

# Sort branch listings by most recent commit rather than alphabetically.
git config --global branch.sort -committerdate

# Keep the repository fast with background maintenance.
git config --global maintenance.auto true

# A safe force-push, as an alias so the unsafe one stays awkward to type.
git config --global alias.pushf "push --force-with-lease --force-if-includes"
```

Three of these deserve a note.

**`pull.rebase true`** changes `git pull` from "fetch and merge" to "fetch, then
replay my local commits on top". It is the difference between a readable history
and one littered with `Merge branch 'main' of github.com:…` commits that carry
no information. If you would rather Git never rewrote anything implicitly, set
`pull.ff only` instead — a pull that cannot fast-forward then _fails_ and asks
you to choose, which is also a defensible policy.

**`rerere.enabled`** records how you resolved a conflict and replays that
resolution automatically when the same conflict reappears. On a long-lived
branch you rebase repeatedly, it removes a great deal of tedium.

**`--force-if-includes`** is the less well-known half of a safe force push. On
its own, `--force-with-lease` only checks that the remote is where you last saw
it; combined with `--force-if-includes` it also verifies that the commits you
are about to overwrite are actually part of your local history.

### Line endings

The most common cross-platform annoyance. Configure it per repository with
`.gitattributes`, which is committed and therefore applies to everyone:

```gitattributes title=".gitattributes"
# Normalise to LF in the repository; check out native on Windows.
* text=auto

# Files that must keep LF regardless of platform.
*.sh text eol=lf
Dockerfile text eol=lf

# Never transform these.
*.png binary
*.pdf binary
```

This is more reliable than each developer setting `core.autocrlf`, because it
travels with the repository rather than depending on local configuration.

### Per-directory identities

Conditional includes switch identity based on where a repository lives:

```ini title="~/.gitconfig"
[user]
  name = Your Name
  email = personal@example.com

[includeIf "gitdir:~/work/"]
  path = ~/.gitconfig-work
```

```ini title="~/.gitconfig-work"
[user]
  email = you@company.com
[commit]
  gpgsign = true
```

No more discovering six months later that every work commit is attributed to a
personal address.

### Authentication

Use SSH keys or a credential manager — never a password at a prompt.

```bash
# Generate a modern key (Ed25519, not RSA).
ssh-keygen -t ed25519 -C "you@example.com"

# Add the public key to GitHub/GitLab, then verify.
ssh -T git@github.com
```

See [SSH](/knowledge-base/ssh) for agent configuration, multiple keys and
hardware-backed keys.

---

## Your first repository

```bash
mkdir my-project && cd my-project
git init                      # create .git/ — this *is* the repository

echo "node_modules/" > .gitignore
git add .gitignore            # stage: choose what goes into the next snapshot
git commit -m "Add gitignore" # snapshot the staged content

git switch -c feature/login   # create a branch and move onto it
# … edit files …
git add -p                    # review and stage hunk by hunk
git commit -m "Add login form"

git switch main
git merge feature/login       # integrate
```

Then connect it to a remote:

```bash
git remote add origin git@github.com:you/my-project.git
git push -u origin main       # -u records the upstream; later pushes need no args
```

If you adopt one habit from this page, make it **`git add -p`**. Staging hunk by
hunk forces you to read your own diff before committing, which catches stray
debug statements, commented-out code and accidentally included files more
reliably than any review process.

---

## What is in this section

```mdx-code-block
import DocCardList from '@theme/DocCardList';
import {useCurrentSidebarCategory} from '@docusaurus/theme-common';

<DocCardList items={useCurrentSidebarCategory().items}/>
```

- **[Key Concepts](/knowledge-base/git/key-concepts)** — the object model, refs,
  the three trees, and why merge and rebase produce different histories. Read
  this first: most Git confusion is a missing mental model rather than a missing
  flag.
- **[Commands](/knowledge-base/git/git-commands)** — a task-oriented reference
  for everyday work.
- **[Best Practices](/knowledge-base/git/best-practices)** — commit hygiene,
  branching strategies, review, signing and repository maintenance.
- **[Common Mistakes](/knowledge-base/git/common-mistakes)** — the mistakes
  everybody makes, each with a recovery procedure.

---

## Where Git is going

Worth knowing, because these defaults will change under you:

- **SHA-256.** Git is migrating object hashing from SHA-1 to SHA-256. SHA-1 is
  cryptographically weakened, and although Git already applies collision
  detection to mitigate known attacks, Git 3.0 will default new repositories to
  SHA-256. Interoperability work between the two formats has been landing since
  2.52.
- **Reftable.** A binary reference-storage format replacing the loose files in
  `.git/refs`. It fixes case-sensitivity and Unicode-normalisation problems on
  Windows and macOS, makes deletion cheap, and is dramatically faster in
  repositories with many refs. Opt in today with
  `git config --global init.defaultRefFormat reftable`; it becomes the default
  in Git 3.0.
- **`main` as the default branch name** in Git 3.0, matching every major forge.
- **`safe.bareRepository` defaults to `explicit`** in 3.0, closing an attack in
  which a checked-in bare repository hijacks Git commands run inside the tree.
- **Removals in 3.0** include `git whatchanged` (use `git log --raw`), graft
  support (use `git replace`), and the long-deprecated `.git/branches/` and
  `.git/remotes/` directories. `git checkout` is explicitly _not_ going away
  despite `switch` and `restore` existing.

---

## FAQ

**Git or GitHub?**
Git is the version control system and runs entirely on your machine. GitHub,
GitLab and Bitbucket are hosting platforms that add pull requests, issues, CI
and access control _around_ Git. Everything in this section works without any of
them.

**Do I need to understand the internals?**
You need the object model and the three trees. Both are simple, and without them
commands like `reset` and `rebase` look arbitrary rather than obvious. See
[Key Concepts](/knowledge-base/git/key-concepts).

**Is my history really safe from a bad command?**
Committed work, almost always: commits become unreachable rather than deleted,
and `git reflog` finds them for around 90 days. The genuinely destructive
commands are the ones that touch _uncommitted_ work — `git reset --hard`,
`git restore .` and `git clean -fd`. Commit or stash before experimenting.

**Should I use a GUI?**
Use whatever helps you _read_ history; graph views are genuinely better than
`git log` in a terminal. Learn the CLI for anything that _changes_ history, so
that you know exactly what is happening.

**Why is my repository so large?**
Almost always a large binary committed once and now permanent in history.
Deleting the file does not shrink the repository — the object is still reachable
from old commits. See
[committing large files](/knowledge-base/git/common-mistakes#committing-large-files).

---

## References

- [Pro Git](https://git-scm.com/book/en/v2) — Chacon & Straub. Free, and still
  the best complete treatment; chapter 10 covers the internals.
- [Git reference manual](https://git-scm.com/docs) — authoritative documentation
  for every command.
- [Git BreakingChanges](https://git-scm.com/docs/BreakingChanges) — what Git 3.0
  will change, and why.
- [GitHub Blog: Git release highlights](https://github.blog/open-source/git/) —
  readable summaries of each release.
