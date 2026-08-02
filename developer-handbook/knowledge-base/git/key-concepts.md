---
id: key-concepts
title: Key Concepts
sidebar_position: 1
---

# Key Concepts

## Repository

A repository (or repo) is the core of Git. It is a directory that holds all the files and their version history for a project. There are two main types of repositories:

- **Local Repository:** This is stored on your local machine and includes your project's files along with a hidden `.git` directory. This directory contains all the commit history and configuration settings.

- **Remote Repository:** This is a version of your project hosted on a server like GitHub, GitLab, or Bitbucket. It facilitates collaboration by enabling you to push your changes and pull updates from other team members.

## .git Folder

The `.git` folder is a hidden directory at the root of every Git repository and is essential for Git’s functionality. It contains all the data and metadata necessary to manage your project’s version history, including commits, branches, tags, and configuration. Inside `.git`, you'll find directories like `objects` (storing commits and other data), `refs` (tracking branches and tags), and `config` (containing repository settings). If you delete the `.git` folder, you'll lose your entire commit history and the ability to manage version control for your project.

## Three Stage Architecture

Git uses a three-stage architecture to manage changes:

- **Working Directory:** The working directory is where you actively develop and modify your files. This is your local workspace where you can freely edit, delete, and create files as needed. Changes in the working directory are not yet tracked by Git, meaning they are in an uncommitted state. This stage allows you to experiment and make adjustments without immediately impacting the project’s tracked history.

- **Staging Area:** The staging area, also known as the index, acts as an intermediary between the working directory and the local repository. Here, you selectively stage changes that you intend to commit, giving you the ability to include only specific updates in your next commit. This tier provides a buffer, allowing you to organize and review changes before they become part of the repository’s permanent history.

- **Local Repository:** The local repository is where your committed changes are stored. Once changes are staged and committed, they move from the staging area to the local repository, where they are saved as a snapshot of your project at that point in time. The local repository keeps a full history of all commits, allowing you to track progress, revert changes, or collaborate with others by pushing commits to a remote repository.

## Commits

A commit in Git represents a snapshot of your project's files at a specific point in time. Each commit is a unique record of changes, identified by a SHA-1 hash, and includes a message describing the modifications. For example, if you fix a bug, your commit message might be "Fixed issue with login validation." Viewing the commit history with `git log` lets you track changes and understand the evolution of the project.

## HEAD

HEAD is a special pointer in Git that indicates the current commit or branch you are working on. It usually points to the latest commit on the current branch, but it can also point directly to a specific commit when in a "detached HEAD" state. When you make new commits, HEAD moves forward to point to the new commit, tracking the current state of your branch. HEAD plays a crucial role in various Git operations, such as switching branches (`git checkout`) or creating new branches, as it determines the base commit from which these actions are performed.

## Branches

A branch in Git represents a separate line of development. The default branch is usually named `main` or `master`. For instance, if you're adding a new feature, you might create a branch like `feature/search-function` instead of committing directly to `main`. This approach keeps the main branch stable and allows for organized development across different features or bug fixes. Common branch types include:

- **Master/Main Branch:** The stable, production-ready code.
- **Develop Branch:** Contains the next set of features to be tested and merged into the `main` branch.
- **Feature Branch:** Used for developing new features.
- **Bugfix Branch:** Used for fixing bugs in the `main` or `develop` branch.
- **Hotfix Branch:** Used for urgent fixes directly on the `main` branch.

## Merging

Merging is used to integrate changes from one branch into another. When you merge, Git combines the histories of both branches and creates a merge commit that includes all changes. For example, after completing a feature in the `feature/search-function` branch, you would merge it into `main` to include the new feature in the stable codebase. Merging preserves the commit history and is straightforward, but it can sometimes create a complex history with multiple branches.

## Rebasing

Rebasing rewrites the commit history by applying changes from one branch onto another base branch, creating a linear and clean history. For example, if you have a feature branch and want to update it with the latest changes from `main`, you would rebase it onto `main`. This eliminates unnecessary merge commits and simplifies the history but alters commit hashes, which can be risky if the branch has been shared. Rebasing is useful for cleaning up commit history before merging.

## Merge Conflicts

Merge Conflicts occur when Git encounters differences between the branches being merged or rebased that cannot be automatically reconciled. This typically happens when changes in the same part of a file have been made differently in each branch. Git will highlight these conflicts in the affected files and prompt you to manually resolve them. You need to edit the files to address the conflicts, choosing which changes to keep, and then mark the conflicts as resolved. Once resolved, you can complete the merge or rebase process.

## Fork

A fork is a personal copy of someone else's repository, allowing you to work on changes independently. If you want to contribute to an open-source project, you can fork the repository to create your own version. You can then make changes, test them, and propose them to the original project through a pull request. Forks are useful for experimenting with new features or making improvements without affecting the original project.

## PR (Pull Request)

A Pull Request (PR) is a request to merge changes from your branch into another branch, usually the `main` branch of the original repository. For example, after adding a new feature, you would create a PR to propose integrating your changes. PRs facilitate code review, discussion, and testing before merging. They ensure that contributions are reviewed and meet the project’s quality standards, helping maintain code integrity and fostering collaboration.

## Submodules

Submodules allow you to include and manage external repositories within your own project. If your project depends on a library maintained in another repository, you can add it as a submodule. This keeps the external code separate from your own project while tracking its specific version. Managing submodules requires careful synchronization, as each submodule has its own repository history and updates must be handled separately.

## Git Hooks

Git hooks are scripts that Git automatically runs before or after certain events, such as committing changes or pushing to a remote repository. They are used to enforce policies, automate tasks, or perform custom actions based on repository events. Hooks are stored in the `.git/hooks` directory of a Git repository and can be customized to fit specific project needs. For example, you can set up a hook to ensure that all commit messages follow a particular format or to run automated tests before allowing code to be pushed.

Here are some common Git hooks:

- **pre-commit:** This hook runs before a commit is finalized. It is commonly used for tasks like linting or formatting code to ensure that only well-formed code is committed.

- **commit-msg:** This hook runs after the commit message has been entered but before the commit is completed. It is often used to validate the format or content of the commit message to ensure consistency or adherence to guidelines.

- **pre-push:** This hook runs before changes are pushed to a remote repository. It can be used to perform tasks like running tests or checks to ensure that the changes being pushed do not introduce issues.

- **post-merge:** This hook executes after a successful merge. It is typically used to perform tasks such as updating dependencies or notifying team members of new changes.

- **pre-rebase:** This hook runs before a rebase operation. It is useful for ensuring that certain conditions are met before rebasing, such as running tests or checking for conflicts.
