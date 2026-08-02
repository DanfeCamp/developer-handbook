---
id: git-commands
title: Git Commands
sidebar_position: 2
---

# Git Commands

## Basic Commands

1. `git init`
   - **Usage:** `git init`
   - **Description:** Initializes a new Git repository in the current directory.

2. `git clone`
   - **Usage:** `git clone <repository-url>`
   - **Description:** Creates a copy of an existing repository from a remote location.

3. `git add`
   - **Usage:** `git add <file>`
   - **Description:** Stages changes to the specified file for the next commit. Use `git add .` to stage all changes.

4. `git commit`
   - **Usage:** `git commit -m "Commit message"`
   - **Description:** Records the staged changes in the repository with a commit message.

5. `git status`
   - **Usage:** `git status`
   - **Description:** Displays the state of the working directory and the staging area.

6. `git log`
   - **Usage:** `git log`
   - **Description:** Shows the commit history for the repository.

7. `git diff`
   - **Usage:** `git diff`
   - **Description:** Displays the differences between the working directory and the index (staging area).

## Branching and Merging

1. `git branch`
   - **Usage:** `git branch`
   - **Description:** Lists all local branches. Use `git branch <branch-name>` to create a new branch.

2. `git checkout`
   - **Usage:** `git checkout <branch-name>`
   - **Description:** Switches to the specified branch. Can also be used with `-b` to create and switch to a new branch.

3. `git merge`
   - **Usage:** `git merge <branch-name>`
   - **Description:** Merges changes from the specified branch into the current branch.

4. `git rebase`
   - **Usage:** `git rebase <branch-name>`
   - **Description:** Re-applies commits from the current branch on top of another branch.

## Remote Repositories

1. `git remote`
   - **Usage:** `git remote`
   - **Description:** Lists remote repositories. Use `git remote add <name> <url>` to add a new remote repository.

2. `git fetch`
   - **Usage:** `git fetch <remote>`
   - **Description:** Retrieves updates from a remote repository without merging them.

3. `git pull`
   - **Usage:** `git pull <remote> <branch>`
   - **Description:** Fetches and integrates changes from a remote repository into the current branch.

4. `git push`
   - **Usage:** `git push <remote> <branch>`
   - **Description:** Uploads local branch commits to a remote repository.

## Undoing Changes

1. `git reset`
   - **Usage:** `git reset <file>`
   - **Description:** Unstages changes from the staging area. Use `--hard` to discard all changes and reset the working directory.

2. `git revert`
   - **Usage:** `git revert <commit>`
   - **Description:** Creates a new commit that undoes the changes from a specified commit.

3. `git clean`
   - **Usage:** `git clean -f`
   - **Description:** Removes untracked files from the working directory.

## Viewing Changes

1. `git show`
   - **Usage:** `git show <commit>`
   - **Description:** Displays detailed information about a specific commit.

2. `git blame`
   - **Usage:** `git blame <file>`
   - **Description:** Shows who last modified each line of a file.
