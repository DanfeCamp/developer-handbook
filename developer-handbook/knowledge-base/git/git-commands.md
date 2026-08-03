---
id: git-commands
title: Git Commands
sidebar_position: 2
description: A task-oriented Git reference — the commands you actually run, the flags that matter, and the modern replacements for the old ones.
---

# Git Commands

## Introduction

This page is organised by **what you are trying to do**, not alphabetically. For
the model behind these commands — what a branch is, what `reset` moves — read
[Key Concepts](/knowledge-base/git/key-concepts) first.

A note on modern syntax. `git checkout` was historically overloaded: it switched
branches _and_ discarded file changes, two very different operations behind one
name. Git 2.23 split it:

| Old                            | Modern                        | Does                      |
| ------------------------------ | ----------------------------- | ------------------------- |
| `git checkout <branch>`        | `git switch <branch>`         | Move to another branch    |
| `git checkout -b <branch>`     | `git switch -c <branch>`      | Create a branch and move  |
| `git checkout -- <file>`       | `git restore <file>`          | Discard changes to a file |
| `git checkout <commit> -- <f>` | `git restore -s <commit> <f>` | Take a file from a commit |

`git checkout` still works and is explicitly not being removed, but `switch` and
`restore` are clearer and harder to misuse. This page uses them.

---

## Starting a repository

```bash
git init                          # create a repository in the current directory
git init -b main my-project       # create a directory and name the first branch

git clone git@github.com:org/repo.git
git clone <url> my-dir            # clone into a specific directory
git clone --depth 1 <url>         # shallow: latest commit only, much faster
git clone --filter=blob:none <url>  # blobless: full history, files on demand
```

For a large repository you only need to build once, `--depth 1` is right. For
one you need to work in, `--filter=blob:none` is usually better: you keep the
full commit graph (so `log` and `blame` work) and Git fetches file contents
lazily.

---

## Inspecting state

```bash
git status                  # the three trees, summarised
git status -sb              # short format with branch line — much less noise

git diff                    # working tree vs index (unstaged changes)
git diff --cached           # index vs HEAD (what you are about to commit)
git diff HEAD               # working tree vs HEAD (everything uncommitted)
git diff main...feature     # changes on feature since it diverged from main
git diff --stat             # summary of files and line counts only
git diff --word-diff        # word-level, good for prose and long lines
```

The three-dot form `main...feature` is the one you want when reviewing a branch:
it shows what the branch _added_, ignoring anything that landed on `main`
meanwhile. Two dots (`main..feature`) compares the two tips directly, which
includes differences caused by `main` moving on.

---

## Staging and committing

```bash
git add <file>              # stage a specific file
git add .                   # stage everything under the current directory
git add -p                  # stage hunk by hunk, interactively
git add -u                  # stage modifications and deletions, not new files

git restore --staged <file> # unstage, keeping the change on disk
git restore <file>          # DISCARD changes to a file — not recoverable

git commit -m "Add rate limiting to the login endpoint"
git commit                  # open an editor — use this for a real message body
git commit -a -m "…"        # stage all tracked modifications, then commit
git commit --amend          # replace the last commit (message and/or content)
git commit --amend --no-edit  # amend content, keep the existing message
git commit --fixup <hash>   # a commit marked to be squashed into <hash> later
```

**`git add -p`** is the highest-value command on this page. It walks you through
each hunk with `y`/`n`/`s` (split) /`e` (edit), which means you read your own
diff before committing and can separate unrelated changes into distinct commits.

**`--amend` rewrites history.** It is safe on unpushed commits and disruptive on
pushed ones — the amended commit has a different hash, so the remote now has a
commit yours no longer references.

---

## Branching

```bash
git branch                        # list local branches
git branch -a                     # include remote-tracking branches
git branch -vv                    # show upstream and last commit for each
git branch --merged main          # branches fully merged into main — safe to delete
git branch --no-merged main       # branches with unmerged work

git switch <branch>               # move to an existing branch
git switch -c <branch>            # create and move
git switch -c <branch> <start>    # branch from a specific commit or tag
git switch -                      # back to the previous branch
git switch --detach <commit>      # deliberately detached HEAD

git branch -m old-name new-name   # rename
git branch -d <branch>            # delete, refusing if unmerged
git branch -D <branch>            # delete regardless
git push origin --delete <branch> # delete on the remote
```

`git switch -` toggling between two branches is the small quality-of-life
command most people never learn.

---

## Working with remotes

```bash
git remote -v                     # list remotes and their URLs
git remote add upstream <url>     # add a second remote (typical for forks)
git remote set-url origin <url>   # change a URL, e.g. HTTPS → SSH

git fetch                         # update remote-tracking refs. Changes nothing else
git fetch --all --prune           # all remotes; delete refs for branches deleted upstream

git pull                          # fetch + merge (or rebase, per pull.rebase)
git pull --rebase                 # explicitly rebase your commits on top

git push                          # push the current branch to its upstream
git push -u origin <branch>       # push and record the upstream
git push --force-with-lease --force-if-includes   # safe force push
git push --follow-tags            # push commits plus annotated tags
```

**Never `git push --force`.** Use `--force-with-lease`, which refuses if the
remote has moved since your last fetch, and add `--force-if-includes`, which
additionally verifies you have actually seen the commits you are overwriting.
Together they turn "I silently destroyed a colleague's work" into an error
message.

`git fetch --prune` is worth running habitually — without it, `git branch -a`
accumulates remote-tracking branches for branches that were deleted months ago.

---

## Reading history

```bash
git log --oneline --graph --decorate --all    # the one worth aliasing
git log -5                                    # last five commits
git log --since="2 weeks ago"
git log --author="Ada"
git log --grep="rate limit"                   # search commit messages
git log -S "functionName"                     # commits that add/remove that string
git log -G "regex"                            # commits whose diff matches a regex
git log -p <file>                             # full patch history of one file
git log --follow <file>                       # …including across renames
git log main..feature                         # commits on feature, not on main
git log --first-parent main                   # ignore merged-branch detail
```

**`git log -S`** ("pickaxe") is the tool for "when did this function disappear?"
It searches the _content of the changes_, not messages — far more reliable than
grepping commit text.

```bash
git show <commit>                 # a commit's message and full diff
git show <commit>:<path>          # a file's contents at that commit
git blame <file>                  # who last changed each line
git blame -w -C <file>            # ignore whitespace, detect moved code
git shortlog -sn                  # commit counts per author
```

`git blame -w -C` is much more useful than plain `blame`: without it, a
reformatting pass or a file move attributes every line to whoever did the move.

---

## Integrating work

```bash
git merge <branch>                # merge into the current branch
git merge --no-ff <branch>        # always create a merge commit
git merge --squash <branch>       # apply the changes, stage them, no commit yet
git merge --abort                 # bail out of a conflicted merge

git rebase main                   # replay current branch on top of main
git rebase -i main                # interactive: reorder, squash, reword, drop
git rebase -i --autosquash main   # apply --fixup commits automatically
git rebase --update-refs          # also move other branches inside the range
git rebase --continue             # after resolving a conflict
git rebase --skip                 # drop the conflicting commit
git rebase --abort                # return to the pre-rebase state

git cherry-pick <commit>          # apply one commit's change here
git cherry-pick -x <commit>       # …and record the original hash in the message
git cherry-pick A..B              # a range
```

Interactive rebase is how a messy branch becomes a reviewable one. Each line in
the editor takes a verb:

```text
pick   a1b2c3  Add login form
squash d4e5f6  fix typo              ← folds into the commit above
reword 7g8h9i  Add passwrd reset     ← edit the message
edit   j1k2l3  Add rate limiting     ← stop here to amend the content
drop   m4n5o6  debug logging         ← remove entirely
```

The `--fixup` plus `--autosquash` pair is the smoother workflow: as you address
review comments, commit them with `git commit --fixup <original-hash>`, then a
single `git rebase -i --autosquash main` positions and squashes every fixup
automatically.

Use `-x` when cherry-picking to a release branch — it records which commit this
came from, which is invaluable months later.

---

## Undoing things

The right command depends on **where the change currently is**.

| Situation                                  | Command                               |
| ------------------------------------------ | ------------------------------------- |
| Unstage a file, keep the edit              | `git restore --staged <file>`         |
| Discard an uncommitted edit                | `git restore <file>` ⚠️ unrecoverable |
| Discard everything uncommitted             | `git restore .` ⚠️ unrecoverable      |
| Remove untracked files                     | `git clean -fd` ⚠️ unrecoverable      |
| Fix the last commit (not pushed)           | `git commit --amend`                  |
| Undo the last commit, keep changes staged  | `git reset --soft HEAD~1`             |
| Undo the last commit, keep changes on disk | `git reset HEAD~1`                    |
| Undo the last commit and the changes       | `git reset --hard HEAD~1` ⚠️          |
| Undo a **pushed** commit                   | `git revert <commit>`                 |
| Undo a pushed merge                        | `git revert -m 1 <merge-commit>`      |
| Restore one file from an old commit        | `git restore -s <commit> -- <file>`   |
| Recover from any of the above              | `git reflog`, then reset to the entry |

The distinction that matters:

- **`reset`** moves the branch pointer backwards. It rewrites history and is for
  commits you have not shared.
- **`revert`** creates a _new_ commit that undoes an old one. History is
  preserved, so it is the correct tool for anything already pushed.

Always dry-run `clean`: `git clean -nd` lists what would be deleted.

---

## Stashing

```bash
git stash push -m "wip: refactor auth"
git stash push -u                 # include untracked files (easy to forget)
git stash push -- <path>          # stash only certain paths
git stash list
git stash show -p stash@{0}       # view the diff
git stash pop                     # apply the top entry and drop it
git stash apply stash@{2}         # apply a specific entry, keep it
git stash drop stash@{0}
git stash clear                   # delete all — no confirmation
```

Without `-u`, untracked files are left behind. That is the single most common
stash surprise.

---

## Finding a bug

```bash
git bisect start
git bisect bad                    # current commit is broken
git bisect good v1.4.0            # this tag was fine
# Git checks out a midpoint; test it, then:
git bisect good                   # …or: git bisect bad
git bisect reset                  # finish and return to where you were
```

Binary search over history: 1,000 commits takes about ten tests. Automate it
entirely when you have a script that exits non-zero on failure:

```bash
git bisect start HEAD v1.4.0
git bisect run npm test
```

This is one of Git's genuinely great features and is heavily underused.

---

## Multiple working directories

```bash
git worktree add ../hotfix main   # a second checkout of the same repository
git worktree add -b fix ../fix    # …on a new branch
git worktree list
git worktree remove ../hotfix
```

Worktrees solve "I need to look at another branch but I am mid-refactor". They
share one object database, so they cost almost no disk, and unlike a stash your
current state is completely undisturbed.

---

## Maintenance and inspection

```bash
git gc                            # garbage collect and repack
git maintenance start             # register scheduled background maintenance
git count-objects -vH             # repository size breakdown
git fsck --lost-found             # find dangling objects after a disaster
git reflog expire --expire=now --all   # ⚠️ discard the safety net, before a gc

git rev-parse HEAD                # resolve a revision to a full hash
git cat-file -p <hash>            # print any object
git ls-files                      # everything tracked in the index
git check-ignore -v <path>        # which .gitignore rule is excluding this file
```

`git check-ignore -v` answers "why is Git not seeing my file?" instantly, which
otherwise involves reading every `.gitignore` in the tree.

---

## Aliases worth having

```bash
git config --global alias.st "status -sb"
git config --global alias.lg "log --oneline --graph --decorate --all"
git config --global alias.last "log -1 HEAD --stat"
git config --global alias.unstage "restore --staged"
git config --global alias.amend "commit --amend --no-edit"
git config --global alias.pushf "push --force-with-lease --force-if-includes"

# Branches sorted by recency, with their upstreams.
git config --global alias.recent "branch --sort=-committerdate --format='%(HEAD) %(color:yellow)%(refname:short)%(color:reset) %(committerdate:relative)'"
```

---

## Cheat Sheet

```bash
# ── Start ──────────────────────────────────────────────
git init -b main                     git clone <url>

# ── Everyday loop ──────────────────────────────────────
git switch -c feature/x              git add -p
git status -sb                       git commit -m "…"
git diff                             git push -u origin feature/x

# ── Sync ───────────────────────────────────────────────
git fetch --all --prune              git pull --rebase
git log HEAD..origin/main            # what is incoming

# ── Review a branch ────────────────────────────────────
git log --oneline main..feature      git diff main...feature

# ── Integrate ──────────────────────────────────────────
git merge --no-ff feature            git rebase -i --autosquash main

# ── Undo ───────────────────────────────────────────────
git restore --staged <f>             # unstage
git commit --amend                   # fix last commit (unpushed)
git reset --soft HEAD~1              # uncommit, keep staged
git revert <commit>                  # undo something pushed
git reflog                           # find anything "lost"

# ── Investigate ────────────────────────────────────────
git log -S "someString"              git blame -w -C <file>
git bisect run npm test              git show <commit>:<path>
```

---

## Common Mistakes

**Using `git add .` without looking.** It stages build output, `.env` files and
debugging changes. Use `git add -p`, or at least `git status` first.

**Reaching for `reset --hard` to "undo".** It discards uncommitted work
permanently — the reflog only recovers commits. Use `git restore --staged` or
`git reset --soft`.

**`git push --force` on a shared branch.** Use `--force-with-lease
--force-if-includes`, aliased so the safe form is the easy one to type.

**Two-dot instead of three-dot diff when reviewing.** `git diff main..feature`
includes changes that landed on `main` after the branch point, obscuring what
the branch actually did. Use `main...feature`.

**`git stash` without `-u`.** New files are not stashed, so the branch you
switch to still has them, and you get puzzling build errors.

**Committing to a detached HEAD, then switching away.** The commits become
unreachable. `git reflog` finds them; branch before experimenting instead.

---

## Debugging

| Symptom                                | Cause and fix                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `fatal: not a git repository`          | You are outside the tree. `git rev-parse --show-toplevel` finds the root.      |
| `Updates were rejected`                | The remote has commits you lack. `git pull --rebase`, then push.               |
| Untracked file will not be added       | A `.gitignore` rule matches. `git check-ignore -v <path>` shows which.         |
| The whole file shows as changed        | Line-ending or whitespace churn. Add a `.gitattributes`; diff with `-w`.       |
| A file is tracked despite `.gitignore` | It was committed before being ignored. `git rm --cached <file>`.               |
| Detached HEAD after a checkout         | Expected when checking out a hash or tag. `git switch -c <name>` to keep work. |
| `Permission denied (publickey)`        | SSH agent has no usable key. `ssh -T git@github.com` to test.                  |
| A rebase seems stuck mid-way           | It is paused on a conflict. `git status` says what to do; `--abort` exits.     |

For anything genuinely lost, work through
[Common Mistakes](/knowledge-base/git/common-mistakes), which is organised as a
recovery playbook.

---

## FAQ

**`switch`/`restore` or `checkout`?**
Use `switch` and `restore` for new muscle memory. `checkout` still works and is
not being removed, so old documentation stays valid.

**Should I use `git pull` at all?**
Yes, once you have configured what it does — `pull.rebase true` or
`pull.ff only`. The problem was never the command, it was not knowing which
integration it would perform.

**`merge --squash` or `rebase -i` to tidy a branch?**
Squash-merge if you want the branch as one commit on `main` and do not care
about its internal steps. Interactive rebase if the individual commits are
meaningful and worth keeping in order.

**How do I see what I am about to push?**
`git log --oneline @{u}..` — commits you have that the upstream does not.

**How do I undo a merge that is already pushed?**
`git revert -m 1 <merge-commit>`. The `-m 1` says "keep the first parent's line
of development". Note that re-merging that branch later needs care, because Git
considers it already merged.

---

## Check your understanding

<Quiz
question="You are reviewing a colleague's `feature` branch. `main` has had ten commits since the branch was created. Which command shows only what the branch itself changed?"
options={[
{
text: 'git diff main...feature',
correct: true,
why: 'Three dots diffs the merge base against the branch tip, so it shows exactly what feature added, ignoring the ten commits that landed on main afterwards.',
},
{
text: 'git diff main..feature',
why: 'Two dots compares the two tips directly, so the ten new commits on main appear as reversed changes — noise that hides the actual work.',
},
{
text: 'git diff feature',
why: 'Compares your working tree against the feature branch tip, which is about your uncommitted state, not the branch history.',
},
{
text: 'git log main..feature',
why: 'This correctly lists the commits unique to feature, but the question asks for the combined diff, not the commit list.',
},
]}
explanation={<>Confusingly, two- and three-dot mean roughly the opposite things for <code>log</code> and <code>diff</code>. For <code>diff</code>, three dots is nearly always what a reviewer wants.</>}
reference={{label: 'Inspecting state', href: '/knowledge-base/git/git-commands#inspecting-state'}}
/>

<Quiz
question="You pushed a commit to `main` yesterday and it turns out to be wrong. Other people have pulled it. What should you do?"
options={[
{
text: 'git revert <commit> — create a new commit that undoes it',
correct: true,
why: 'History stays intact, so nobody has to reconcile rewritten commits. This is the only safe way to undo published work.',
},
{
text: 'git reset --hard HEAD~~1 and force push',
why: 'This rewrites shared history. Everyone who pulled now has commits pointing at a parent that no longer exists upstream.',
},
{
text: 'git commit --amend and force push',
why: 'Same problem: amending creates a new hash, and force-pushing it over a commit others already have is disruptive.',
},
{
text: 'git rebase -i HEAD~~2 and drop the commit',
why: 'Also a history rewrite requiring a force push, with the same consequences for everyone who pulled.',
},
]}
explanation={<>The dividing line is publication. Before pushing, reshape history freely with reset, amend and rebase. After pushing, add commits rather than rewriting them.</>}
reference={{label: 'Undoing things', href: '/knowledge-base/git/git-commands#undoing-things'}}
/>

<Quiz
question="A test started failing sometime in the last 400 commits and you have a script that exits non-zero when it fails. What is the fastest way to find the commit that broke it?"
options={[
{
text: 'git bisect start HEAD <known-good-tag> then git bisect run npm test',
correct: true,
why: 'Binary search over history — about nine test runs for 400 commits, fully automated because bisect run uses the exit code.',
},
{
text: 'git log -S with the name of the failing function',
why: 'Good for finding when a specific string changed, but the breakage may come from any of hundreds of unrelated changes.',
},
{
text: 'git blame on the failing test file',
why: 'Shows who last touched the test, not which commit changed behaviour elsewhere and broke it.',
},
{
text: 'Check out each commit in turn and run the test',
why: 'That is linear search — 400 runs instead of about nine.',
},
]}
explanation={<><code>git bisect run</code> is one of Git's best features and one of its least used. Any deterministic pass/fail check can drive it.</>}
reference={{label: 'Finding a bug', href: '/knowledge-base/git/git-commands#finding-a-bug'}}
/>

<Quiz
question="Which of these commands can permanently destroy work that `git reflog` cannot recover?"
type="multiple"
options={[
{text: 'git restore <file>', correct: true, why: 'Discards uncommitted changes to a file. Uncommitted work was never an object, so there is nothing for the reflog to point at.'},
{text: 'git clean -fd', correct: true, why: 'Deletes untracked files and directories outright. Always dry-run with -nd first.'},
{text: 'git reset --hard HEAD~3', correct: true, why: 'The _commits_ are recoverable via reflog, but any uncommitted changes in the working tree are destroyed with no record.'},
{text: 'git branch -D feature', why: 'Deletes only the pointer. The commits stay in the object database and the reflog prints the hash as you delete it.'},
{text: 'git rebase -i main', why: 'Rewriting produces new commits; the originals remain reachable through the reflog until garbage collection.'},
]}
explanation={<>The pattern: Git protects <em>committed</em> work extremely well and offers almost no protection for <em>uncommitted</em> work. Committing early — even to a throwaway <code>wip</code> commit — is what makes Git forgiving.</>}
reference={{label: 'Undoing things', href: '/knowledge-base/git/git-commands#undoing-things'}}
/>

<Quiz
question="You are mid-refactor with uncommitted changes when an urgent production bug arrives. You need a clean checkout of `main` immediately. What is the cleanest approach?"
options={[
{
text: 'git worktree add ../hotfix main and work there',
correct: true,
why: 'A second working directory sharing the same object database. Your in-progress refactor is completely untouched, and nothing has to be stashed or committed.',
},
{
text: 'git stash -u, fix the bug, then git stash pop',
why: 'Workable and common, but it disturbs your working tree, and forgetting -u or popping onto the wrong branch are frequent mistakes.',
},
{
text: 'Commit the refactor as "wip" and switch branches',
why: 'Safe, and better than stashing for long interruptions — but it puts an incomplete commit on the branch that you must remember to clean up.',
},
{
text: 'Clone the repository again into a new directory',
why: 'It works, but it re-downloads the entire history and gives you a second repository whose branches drift out of sync with the first.',
},
]}
explanation={<>Worktrees are underused. They cost almost no disk because the object database is shared, and they remove the entire class of "I stashed it and then forgot" problems.</>}
reference={{label: 'Multiple working directories', href: '/knowledge-base/git/git-commands#multiple-working-directories'}}
/>

---

## References

- [Git reference manual](https://git-scm.com/docs) — the authoritative page for
  every command and flag.
- [git-rev-parse: Specifying ranges](https://git-scm.com/docs/git-rev-parse#_specifying_ranges)
  — the difference between `..` and `...`, precisely.
- [git-bisect documentation](https://git-scm.com/docs/git-bisect) — including
  `bisect run` and `--term-old` / `--term-new`.
- [git-worktree documentation](https://git-scm.com/docs/git-worktree) — multiple
  checkouts of one repository.
- [Pro Git: Git Tools](https://git-scm.com/book/en/v2/Git-Tools-Revision-Selection)
  — revision selection, interactive staging, rewriting history.
