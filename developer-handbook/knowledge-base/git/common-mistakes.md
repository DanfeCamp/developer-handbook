---
id: common-mistakes
title: Common Mistakes
sidebar_position: 4
---

# Common Mistakes

## Making Changes Directly on the Main Branch

Making changes directly on the main branch can destabilize the codebase and complicate collaboration. Instead, use separate branches for features, bug fixes, or experiments. For example, if you’re adding a new search feature, create a branch like `feature/search-function`. This keeps the main branch stable and organized, allowing for easier integration and clearer tracking of development progress. Once changes are complete and tested, they can be safely merged into the main branch using `git merge feature/search-function`, supporting parallel development and better teamwork.

## Failing to Review Changes Before Committing

Failing to review changes before committing can lead to unintended or incorrect changes being included in the commit. Before committing, use `git status` to check the files that are staged for commit and `git diff` to review the differences. For example, if you’ve accidentally included temporary files or unintentional modifications, these commands help you ensure that only the intended changes are committed. This practice helps maintain code quality and prevents errors from being introduced into the codebase.

## Too Many Git Commits

Having too many Git commits, especially with small or insignificant changes, can clutter the commit history and make it difficult to trace the development process. For example, a series of commits like "fixed typo," "adjusted padding," and "updated comment" can overwhelm the commit log. Strive to make meaningful commits that encapsulate specific, logical changes. Consider using `git rebase -i` (interactive rebase) to squash commits into a single, coherent commit when necessary. This ensures a clear and concise record of development progress.

## Poor Git Commit Messages

Poor Git commit messages can lead to confusion and make it difficult to understand the history of a project. Avoid vague messages like "fixed issue" or "update." Instead, use descriptive messages such as "Added search functionality to improve user experience" or "Refactored user profile page layout." Clear, descriptive commit messages are essential for effective collaboration and project maintenance, as they explain the intent behind changes and make it easier to track progress, debug issues, and review code.

## Not Using .gitignore Properly

Not using `.gitignore` properly results in unnecessary files being tracked by Git. Files such as build artifacts, temporary files, and sensitive information like API keys should be excluded from version control. For example, include patterns like `node_modules/` and `*.log` in your `.gitignore` file to prevent these files from cluttering the repository. Configuring `.gitignore` correctly maintains a cleaner and more secure project by ensuring that only relevant files are versioned.

## Committing Large Files

Committing large files can lead to bloated repositories and slow performance. For example, committing binary files or large datasets can significantly increase the size of the repository. Instead, use `.gitignore` to exclude these files or leverage Git LFS (Large File Storage) to manage them separately. For instance, use `git lfs track "*.png"` to track large image files without affecting repository performance.

## Forgetting to Pull Before Pushing

Forgetting to pull before pushing or neglecting to update your local repository can lead to conflicts if the remote repository has new commits that your branch lacks. This mistake often results in merge conflicts or rejected pushes. Regularly pull changes using `git pull` to ensure your branch is up to date with the remote repository. For example, if someone else has pushed changes to the main branch, pulling those changes first reduces the risk of conflicts when you push your own updates.

## Overwriting History with Force Push

Overwriting history with force push (`git push --force`) can overwrite changes in the remote repository, potentially leading to the loss of work by other collaborators. Use force push cautiously, and typically only in scenarios like fixing mistakes in a feature branch. As a safer alternative, use `git push --force-with-lease` to ensure you don’t overwrite others’ changes. Always communicate with your team before force pushing to avoid disrupting their work.
