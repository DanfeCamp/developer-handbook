---
id: common-mistakes
title: Common Mistakes
sidebar_position: 4
description: The Git mistakes everyone makes, each with why it happens, how to recover, and how to stop it happening again — plus a recovery playbook you can scan under pressure.
---

# Common Mistakes

## Introduction

Every mistake below has been made by every experienced Git user at least once.
This page is written to be read in two ways: straight through, to learn what to
avoid, and by symptom when something has already gone wrong.

Before anything else, internalise this:

:::tip Committed work is almost never lost
Git does not delete commits; it stops referencing them. `git reflog` records
every position `HEAD` and your branches have held for roughly 90 days. If you
have committed, you can get it back.

The exception is **uncommitted work**. `git reset --hard`, `git restore .` and
`git clean -fd` destroy changes that were never turned into an object, and no
amount of reflog will bring them back. This asymmetry is the single most useful
thing to know about recovering from mistakes — and the reason to commit early,
even to a throwaway `wip` commit.
:::

Jump to the [recovery playbook](#recovery-playbook) if something is currently on
fire.

---

## Mistakes While Committing

### Committing on the wrong branch

You finish the work and realise you have been on `main` all along.

Nothing is lost, and no history is broken. Move the commits:

```bash
# The commits are on main and should be on a feature branch.
git switch -c feature/correct-branch   # branch here, keeping the commits
git switch main
git reset --hard origin/main           # rewind main to the remote
```

If they were not committed yet, it is even easier — `git switch -c
feature/x` carries uncommitted changes with you.

**Prevent it:** show the branch in your shell prompt, and enable branch
protection so a push to `main` is rejected before it becomes a habit.

### Committing without reading the diff

`git add .` sweeps up debug statements, commented-out experiments, an
accidentally saved `.env`, and files from a different task.

```bash
git status -sb        # what is about to be included
git diff --cached     # what those changes actually are
```

**Prevent it:** use `git add -p`. Staging hunk by hunk means you cannot commit
something you have not read. This one habit prevents more embarrassment than any
review process.

### Vague commit messages

"fix", "update", "changes", "wip", "asdf". Six months later, `git log` is a wall
of noise and `git bisect` output tells you nothing.

The cost is real: a message that explains _why_ turns a thirty-minute
archaeology session into a ten-second read.

```bash
# Fix the most recent message (only if unpushed).
git commit --amend

# Fix older messages.
git rebase -i HEAD~5    # mark lines with `reword`
```

See [writing messages that explain why](/knowledge-base/git/best-practices#write-messages-that-explain-why).

### Commits that are too large

One commit containing a refactor, a feature and a formatting pass cannot be
reverted, cannot be reviewed properly, and defeats `git bisect`.

Split it before pushing:

```bash
git reset --soft HEAD~1    # undo the commit, keep everything staged
git restore --staged .     # unstage everything
git add -p                 # then rebuild it as several coherent commits
git commit -m "First logical change"
```

### Amending or rebasing a pushed commit

Rewriting produces new hashes. Anyone who pulled the old commits now has history
that diverges from the remote, and their next pull produces a confusing merge or
a wall of conflicts.

**The rule:** reshape history freely before pushing; after pushing, add commits
instead. To undo something published, use `git revert`.

If you must rewrite a shared branch — occasionally unavoidable — tell everyone
first, and have them recover with:

```bash
git fetch origin
git reset --hard origin/feature-branch   # discards their local divergence
```

---

## Mistakes With Secrets and Large Files

### Committing a secret

The most expensive mistake on this page, because **deleting the file in a later
commit does not remove it.** The old commit is still in history, in every clone,
in every fork, and in the forge's cache.

**Do this in order:**

1. **Rotate the credential now.** Before anything else. Assume it is
   compromised — public repositories are scraped within minutes.
2. **Purge it from history**, if the repository is private or the exposure
   window was short:

   ```bash
   pip install git-filter-repo

   # Replace the secret everywhere it appears in history.
   echo 'AKIAIOSFODNN7EXAMPLE==>REDACTED' > replacements.txt
   git filter-repo --replace-text replacements.txt

   # Or remove a whole file from every commit.
   git filter-repo --invert-paths --path config/secrets.yml
   ```

3. **Force-push** and have every collaborator re-clone. Rewriting does not
   update anyone's existing clone.

Use `git filter-repo`, not `git filter-branch` — the latter is deprecated,
dangerously slow, and easy to get subtly wrong.

**Prevent it:** `.env` in `.gitignore`, a `.env.example` with keys but no
values, forge push protection enabled, and a `gitleaks protect --staged`
pre-commit hook.

### Committing large files

A 200 MB video committed once lives in the repository forever. Every clone
downloads it. Deleting it in a later commit does not help, because the object is
still reachable from the commit that added it.

Find what is inflating the repository:

```bash
git count-objects -vH

# The ten largest objects in history, with their paths.
git rev-list --objects --all |
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
  awk '/^blob/ {print substr($0, 6)}' |
  sort -k2 -n -r | head -10
```

Removing them requires rewriting history with `git filter-repo`, exactly as for
a secret.

**Prevent it:** [Git LFS](https://git-lfs.com/) for assets that must be
versioned, object storage for everything else, and a `pre-commit` hook rejecting
files over a size threshold.

### A file is tracked despite being in .gitignore

`.gitignore` only applies to files Git is **not already tracking**. Adding a rule
for a committed file does nothing.

```bash
git rm --cached path/to/file        # stop tracking, keep it on disk
git rm -r --cached node_modules/    # for a directory
git commit -m "Stop tracking build output"
```

`git check-ignore -v <path>` tells you which rule matches — or that none does,
which is the answer when a file you expected to be ignored is not.

---

## Mistakes With Remotes

### Force-pushing over a colleague's work

`git push --force` overwrites the remote branch unconditionally. If someone
pushed while you were rebasing, their commits are gone from the remote.

They are recoverable — the commits still exist in that person's local clone and
reflog — but it is disruptive and entirely avoidable:

```bash
git push --force-with-lease --force-if-includes
```

`--force-with-lease` refuses if the remote moved since your last fetch.
`--force-if-includes` additionally verifies that you have actually seen the
commits you are about to overwrite, which closes a gap where a background fetch
makes the lease look valid.

Alias it so the safe form is the one that is easy to type:

```bash
git config --global alias.pushf "push --force-with-lease --force-if-includes"
```

### Merge bubbles from plain `git pull`

Every `git pull` that cannot fast-forward creates a commit called
`Merge branch 'main' of github.com:org/repo`. Dozens of them turn history into
an unreadable braid, and none of them carries information.

```bash
git config --global pull.rebase true   # replay your commits on top instead
# …or refuse to guess:
git config --global pull.ff only       # fail, and let you decide
```

### Assuming `origin/main` is live

`origin/main` is a local record of where the remote was **at your last fetch**.
"Your branch is up to date with origin/main" can be hours stale.

```bash
git fetch --all --prune       # then the comparison means something
git log HEAD..origin/main     # what is incoming
```

### Pushing to a branch someone else rebased

Your push is rejected; you pull, and get conflicts on commits you already have.
This is the mirror image of the force-push problem. Resolve it by resetting to
their version and re-applying your own work:

```bash
git fetch origin
git reset --hard origin/feature   # take their rewritten history
git cherry-pick <your-commits>    # replay only what is genuinely yours
```

---

## Mistakes While Merging and Rebasing

### Resolving a conflict by taking one whole side

Under pressure it is tempting to run `git checkout --ours <file>` and move on.
That silently discards the other side's change, and the loss usually surfaces
days later as a mysteriously reverted bug fix.

A conflict means _both_ sides changed the same region. The correct resolution is
frequently neither side verbatim, but a combination.

```bash
git config --global merge.conflictStyle zdiff3
```

`zdiff3` adds the common ancestor to the markers, so you can see what each side
changed _from_, which usually makes the right answer obvious.

Always build and test after resolving. A conflict resolution that compiles is
not necessarily correct.

### Rebasing a shared branch

Covered above under [amending a pushed commit](#amending-or-rebasing-a-pushed-commit),
and worth repeating because it is the most disruptive routine mistake in Git.
If two or more people have a branch checked out, merge into it — do not rebase
it.

### Getting lost mid-rebase

An interactive rebase pauses on each conflict, and it is easy to forget which
commit is being applied or which side is "ours".

```bash
git status              # states the operation and the current step
git rebase --abort      # return to exactly the pre-rebase state
git rebase --skip       # drop the commit currently causing trouble
git rebase --continue   # after git add on the resolved files
```

`--abort` is always available and always safe. Use it rather than fighting
through a rebase you have lost track of.

Remember that during a rebase, **"ours" is the branch you are replaying onto**
and "theirs" is your own commit — the reverse of a merge. See
[merge conflicts](/knowledge-base/git/key-concepts#merge-conflicts).

---

## Mistakes That Lose Uncommitted Work

### `git reset --hard` with a dirty working tree

The commits it rewinds past are recoverable through the reflog. The
**uncommitted edits in your working tree are not** — they were never objects.

```bash
git stash push -u        # take a snapshot first, always
git reset --hard <ref>
```

### `git clean -fd` without a dry run

Deletes every untracked file and directory. That includes new files you have
written but not yet added.

```bash
git clean -nd            # ALWAYS dry-run first: lists what would go
git clean -fd            # then, if the list is right
```

### `git restore <file>` / `git checkout -- <file>`

Overwrites the file with the committed version. There is no undo and no reflog
entry.

### Losing commits made in detached HEAD

You checked out a hash to investigate, made a couple of commits, then switched
branches. No branch was following you, so the commits are unreachable.

```bash
git reflog                        # find the hashes
git switch -c rescued <hash>      # give them a branch
```

**Prevent it:** the moment you decide to keep work from a detached HEAD, run
`git switch -c <name>`.

### Deleting a branch with unmerged commits

`git branch -D` deletes regardless of merge status — but it prints the hash it
just deleted, precisely so you can undo it:

```bash
Deleted branch feature/x (was a1b2c3d).

git switch -c feature/x a1b2c3d   # restored
```

If you did not keep the output, `git reflog` still has it.

### Stash surprises

Two recurring problems: `git stash` **does not include untracked files** unless
you pass `-u`, and a stash entry is not associated with a branch, so popping it
somewhere unexpected produces confusing conflicts.

```bash
git stash push -u -m "descriptive message"
git stash list
git stash show -p stash@{1}       # look before you pop
```

For anything longer than a few minutes, a `wip` commit on a branch is clearer:
it is named, visible in `git log`, and cannot be popped onto the wrong branch.

---

## Cross-Platform Mistakes

### The whole file shows as modified

Line endings. Someone on Windows saved the file with CRLF, or a tool rewrote
them. `git diff` shows every line changed, and the real change is invisible.

Fix it for everyone by committing a `.gitattributes`:

```gitattributes title=".gitattributes"
* text=auto
*.sh text eol=lf
```

Then renormalise once:

```bash
git add --renormalize .
git commit -m "Normalise line endings"
```

`git diff -w` ignores whitespace and helps while you sort it out.

### Case-only renames

macOS and Windows filesystems are case-insensitive by default, so renaming
`User.ts` to `user.ts` may not register at all — and can produce a repository
containing both, which Linux CI sees as two files.

```bash
git mv --force User.ts user.ts    # two-step it explicitly
```

Better, avoid the situation: agree on a filename casing convention and enforce
it with a lint rule.

---

## Recovery Playbook

Scan this column first.

| Symptom                                          | Recovery                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Committed to the wrong branch                    | `git switch -c right-branch`, then reset the wrong one              |
| Bad message on the last (unpushed) commit        | `git commit --amend`                                                |
| Bad message on an older unpushed commit          | `git rebase -i HEAD~n`, mark `reword`                               |
| Need to undo the last commit, keep the changes   | `git reset --soft HEAD~1`                                           |
| Need to undo a **pushed** commit                 | `git revert <commit>`                                               |
| Need to undo a **pushed merge**                  | `git revert -m 1 <merge-commit>`                                    |
| Bad `reset --hard`, need the commits back        | `git reflog`, then `git reset --hard HEAD@{n}`                      |
| Deleted a branch by mistake                      | `git switch -c <name> <hash>` (hash is in the delete output/reflog) |
| Lost commits from a detached HEAD                | `git reflog`, then `git switch -c rescued <hash>`                   |
| Rebase has gone wrong                            | `git rebase --abort`                                                |
| Merge has gone wrong                             | `git merge --abort`                                                 |
| Committed a secret                               | **Rotate it**, then `git filter-repo --replace-text`                |
| Repository is enormous                           | Find big blobs, then `git filter-repo --invert-paths --path <file>` |
| A file is tracked but should be ignored          | `git rm --cached <file>`                                            |
| Restore one file from an old commit              | `git restore -s <commit> -- <file>`                                 |
| Nothing above works; commits seem gone           | `git fsck --lost-found`                                             |
| Local branch diverged after someone force-pushed | `git fetch && git reset --hard origin/<branch>` ⚠️ discards local   |

---

## Do's and Don'ts

### Do

- Commit early — the reflog only protects work that became a commit.
- `git status -sb` and `git add -p` before every commit.
- Dry-run destructive commands: `git clean -nd`.
- Alias `--force-with-lease --force-if-includes` and use only that.
- Set `pull.rebase true` and `merge.conflictStyle zdiff3` once, globally.
- Rotate a credential the moment it touches a commit.
- Read the hash Git prints when you delete a branch.

### Don't

- Don't run `git reset --hard` with uncommitted changes you care about.
- Don't `git push --force` to a shared branch.
- Don't rebase a branch other people have checked out.
- Don't resolve a conflict by taking one whole side without reading both.
- Don't assume `.gitignore` will untrack an already-committed file.
- Don't commit binaries or dependencies.
- Don't panic and re-clone — check `git reflog` first.

---

## FAQ

**I ran `git reset --hard` and lost a day's work. Is it really gone?**
If it was committed, no — `git reflog` will find it. If it was only in the
working tree, yes. Some editors keep local history (VS Code's Timeline, JetBrains'
Local History), which is occasionally a last resort.

**How long does the reflog keep things?**
90 days for reachable entries, 30 for unreachable ones, by default. It is local
and is neither pushed nor cloned.

**`git revert` or `git reset` to undo?**
`revert` for anything pushed — it adds a commit and rewrites nothing. `reset`
for local commits you have not shared.

**Someone force-pushed and my branch is a mess. What now?**
`git fetch`, then `git reset --hard origin/<branch>` to take their version — but
note the hash of your own tip first (`git rev-parse HEAD`) so you can
cherry-pick anything of yours that was lost.

**Can I recover a stash I dropped?**
Often. `git fsck --unreachable | grep commit` lists dangling commits; a dropped
stash is among them. `git stash apply <hash>` restores it.

**Should I just delete the repository and re-clone?**
Almost never. It throws away your reflog — the very thing that can recover the
situation — along with any local branches and stashes.

---

## Check your understanding

<Quiz
question="You run `git reset --hard HEAD~3`. You had three commits and also some uncommitted edits in your working tree. What is recoverable?"
options={[
{
text: 'The three commits, via git reflog — but the uncommitted edits are gone',
correct: true,
why: 'Commits are objects in the database and the reflog still names them. Uncommitted changes were never objects, so nothing references them and nothing can restore them.',
},
{
text: 'Everything, via git reflog',
why: 'The reflog records where refs pointed. It has no record of working-tree state that was never committed.',
},
{
text: 'Nothing — --hard is irreversible',
why: 'The commits are unreachable, not deleted. git reflog plus git reset --hard HEAD@{1} restores them.',
},
{
text: 'Only the most recent commit',
why: 'The reflog entry restores the branch to its previous position, bringing back all three at once.',
},
]}
explanation={<>This asymmetry is the core of Git recovery: committed work is nearly indestructible, uncommitted work has no protection at all. <code>git stash push -u</code> before any <code>--hard</code> costs a second and removes the risk.</>}
reference={{label: 'Recovery playbook', href: '/knowledge-base/git/common-mistakes#recovery-playbook'}}
/>

<Quiz
question="An AWS key was committed and pushed to a public repo an hour ago, then removed in a follow-up commit. What is the correct first action?"
options={[
{
text: 'Rotate the key immediately',
correct: true,
why: 'Public repositories are scraped continuously, often within minutes. The key must be assumed compromised, and no amount of history rewriting can un-publish it.',
},
{
text: 'Run git filter-repo to purge it from history',
why: 'Necessary as a second step, but it does nothing about the hour the key was public, or about forks and forge caches.',
},
{
text: 'Force-push a rewritten history and notify the team',
why: 'Same problem — this addresses future clones, not the exposure that has already happened.',
},
{
text: 'Delete the repository and recreate it',
why: 'Forks and cached views may persist, and it destroys the project history. The key is still compromised.',
},
]}
explanation={<>Order matters: rotate, then clean history, then prevent recurrence with push protection and a gitleaks hook. Treat "removed in a later commit" as meaning nothing at all.</>}
reference={{label: 'Committing a secret', href: '/knowledge-base/git/common-mistakes#committing-a-secret'}}
/>

<Quiz
question="Which of these actually protect a colleague's commits when you rewrite a shared branch?"
type="multiple"
options={[
{text: 'git push --force-with-lease', correct: true, why: 'Refuses the push if the remote ref has moved since your last fetch, so an unseen commit blocks the overwrite.'},
{text: 'git push --force-if-includes', correct: true, why: 'Verifies that the commits you are overwriting are actually part of your local history — closing the gap where a background fetch makes the lease look valid.'},
{text: 'git push --force', why: 'Overwrites unconditionally. This is the command the other two exist to replace.'},
{text: 'Enabling branch protection to block force pushes on the forge', correct: true, why: 'A server-side rule cannot be bypassed by a local flag, which makes it the strongest protection of the four.'},
{text: 'Running git fetch immediately before the force push', why: 'This makes things worse: fetching updates your remote-tracking ref, so --force-with-lease now considers the overwrite legitimate.'},
]}
explanation={<>The last option is a genuine trap — a fetch immediately before a lease-protected push defeats the lease. <code>--force-if-includes</code> exists specifically to catch that case.</>}
reference={{label: 'Force-pushing over a colleague', href: '/knowledge-base/git/common-mistakes#force-pushing-over-a-colleagues-work'}}
/>

<Quiz
question="You added `secrets.yml` to .gitignore, but Git still shows it as modified whenever you edit it. Why?"
options={[
{
text: '.gitignore only applies to untracked files, and this one is already tracked',
correct: true,
why: 'Once a file is in the index, ignore rules are irrelevant. Run git rm --cached secrets.yml to stop tracking it while keeping it on disk.',
},
{
text: 'The .gitignore entry needs a leading slash',
why: 'A leading slash anchors the pattern to the repository root. It changes which paths match, not whether tracked files are ignored.',
},
{
text: 'You must run git update-index --assume-unchanged',
why: 'That flag hides local modifications to a tracked file and is widely misused — it does not untrack the file and breaks in confusing ways on branch switches.',
},
{
text: '.gitignore does not work in subdirectories without its own file',
why: 'Patterns in a root .gitignore apply to the whole tree.',
},
]}
explanation={<>Note that <code>git rm --cached</code> only stops future tracking — the file's previous contents remain in history, so if it contained secrets you still need to rotate and purge.</>}
reference={{label: 'Tracked despite .gitignore', href: '/knowledge-base/git/common-mistakes#a-file-is-tracked-despite-being-in-gitignore'}}
/>

<Quiz
question="During a rebase of `feature` onto `main`, a conflict appears. You run `git checkout --ours config.ts` to resolve it quickly. What did you just keep?"
options={[
{
text: "main's version — during a rebase, 'ours' is the branch being replayed onto",
correct: true,
why: 'Rebase checks out the upstream branch and replays your commits on top, so "ours" is main and "theirs" is your own commit. You have just discarded your own change.',
},
{
text: "feature's version, because that is the branch you are on",
why: 'The intuitive reading, and precisely why this mistake is so common. It is correct for a merge, not for a rebase.',
},
{
text: 'A merged combination of both sides',
why: '--ours takes one side verbatim. It performs no combination at all.',
},
{
text: 'The version from the merge base',
why: 'The base is a third version, shown only with conflictStyle diff3 or zdiff3. Neither --ours nor --theirs selects it.',
},
]}
explanation={<>Two habits remove this class of error: check <code>git status</code> for which operation is running, and set <code>merge.conflictStyle = zdiff3</code> so you can see what each side changed from and resolve on the merits instead of by side.</>}
reference={{label: 'Resolving a conflict by taking one side', href: '/knowledge-base/git/common-mistakes#resolving-a-conflict-by-taking-one-whole-side'}}
/>

---

## References

- [git-reflog documentation](https://git-scm.com/docs/git-reflog) — expiry
  behaviour and syntax.
- [git-filter-repo](https://github.com/newren/git-filter-repo) — the supported
  history-rewriting tool, with a purpose-built secrets guide.
- [GitHub: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
  — includes the forge-side caveats about forks and caches.
- [git-push: --force-with-lease and --force-if-includes](https://git-scm.com/docs/git-push#Documentation/git-push.txt---no-force-if-includes)
  — exactly what each guarantees.
- [Pro Git: Rewriting History](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History)
  — amend, rebase, filter and their consequences.
- [gitattributes documentation](https://git-scm.com/docs/gitattributes) — line
  endings, `text=auto`, and renormalisation.
