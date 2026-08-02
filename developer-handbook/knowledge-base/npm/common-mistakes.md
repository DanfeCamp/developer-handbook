---
id: common-mistakes
title: Common Mistakes
sidebar_position: 4
---

# Common Mistakes

## Not Locking Dependency Versions

One of the most frequent mistakes is failing to lock dependency versions, either by ignoring the `package-lock.json` file or manually setting loose version ranges in the `package.json` (e.g., using `*` or `latest`). This can lead to different environments installing slightly different versions of packages, resulting in unpredictable behavior and bugs that are difficult to replicate. Always commit your `package-lock.json` file and avoid overly permissive versioning, relying instead on semantic versioning ranges like `^` (minor updates) or `~` (patch updates).

## Installing Packages Globally

Installing packages globally (`npm install -g`) can cause version conflicts and lead to hard-to-debug issues, especially in teams where different developers may have different versions installed. It’s generally better to install packages locally to the project and reference them in your npm scripts. For example, instead of globally installing a CLI tool like `gulp`, install it locally and run it via `npm run gulp`. This ensures consistency across different environments, especially in CI/CD pipelines.

## Misusing dependencies and devDependencies

A common mistake is putting all dependencies into the `dependencies` field in `package.json` without distinguishing between runtime and development needs. Packages required only for development (e.g., testing libraries like `Mocha` or `Jest`) should be placed in `devDependencies`, while packages essential for running the application in production should be in `dependencies`. This keeps the production build clean and free of unnecessary development tools.

## Forgetting to Update Dependencies

Neglecting to update dependencies can lead to security vulnerabilities, incompatibility with newer tools, and missing out on performance improvements. Some developers overlook this step due to the fear of breaking changes. To mitigate this, use tools like `npm outdated` to check for updates regularly and `npm audit` to identify security risks. Be cautious with major version updates, but regularly update minor and patch versions for better security and performance.

## Not Using NPM Scripts

A common mistake is relying on external tools or task runners (like `Grunt` or `Gulp`) for automation tasks when npm scripts can handle most of these tasks effectively. Defining `build`, `test`, or `lint` commands directly in the `scripts` section of `package.json` not only simplifies the development process but also reduces the need for additional dependencies. For example:

```json
{
  "scripts": {
    "start": "node app.js",
    "test": "jest"
  }
}
```

This approach makes your project more self-contained and accessible to other developers.

## Manually Managing Node Modules

Some developers attempt to manually modify or delete files within the `node_modules` directory. This can lead to broken dependencies or missing files, causing your project to malfunction. The `node_modules` folder is managed by npm, and any manual modifications will be overridden the next time you run `npm install`. If you need to clean up or reset dependencies, use `npm ci` for a clean installation or delete `node_modules` and the `package-lock.json` file and reinstall.

## Publishing Sensitive Information

Accidentally publishing sensitive files, such as API keys, or environment configurations, can pose significant security risks. Always ensure you have a properly configured `.gitignore` file to exclude sensitive or unnecessary files from being published. Also, verify the contents of your package before publishing by using the `npm pack` command, which generates a tarball of your package, allowing you to inspect its contents before it’s uploaded to the registry.

## Ignoring NPM Audits

When npm identifies security vulnerabilities through `npm audit`, some developers might ignore the audit report, especially for low-priority issues. This can leave the project exposed to known security risks. It’s important to take every `npm audit` result seriously, applying fixes where appropriate or at least assessing whether the identified issue impacts your project. Run `npm audit fix` to automatically resolve any non-breaking updates and periodically recheck for vulnerabilities.

## Not Using .npmignore or files Field

When publishing packages to npm, many developers forget to exclude unnecessary files like tests, documentation, or large example files, making their package bloated. You can avoid this by creating a `.npmignore` file to exclude files and directories that aren’t necessary for the published package. Alternatively, use the `files` field in `package.json` to specify exactly which files should be included. This reduces the package size and ensures that only essential files are shipped.

## Using Global Packages in Local Scripts

Some developers mistakenly assume that globally installed packages are available in local scripts, which may lead to issues in CI environments or for other contributors. Global installations work in your local environment but may not be accessible on a different machine or server. To avoid this issue, always install required tools locally and reference them through npm scripts or via `npx`, which ensures the required package is used without needing a global install.

## Ignoring Peer Dependencies

Some packages require peer dependencies, which are packages that need to be installed alongside them. Developers often overlook peer dependency warnings during installation, leading to runtime errors or unexpected behavior. When you install a package that specifies peer dependencies, ensure that the correct versions of those dependencies are also installed in your project. For example, when using a package like `React`, the package may specify a range of compatible versions for peer dependencies like `react-dom`.
