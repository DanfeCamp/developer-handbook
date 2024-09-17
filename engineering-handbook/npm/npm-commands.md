---
id: npm-commands
title: NPM Commands
sidebar_position: 2
---

# NPM Commands

Here are a few npm commands; you can find the full list in the npm [documentation](https://docs.npmjs.com/cli/v10/commands).

1. `npm init`
    - **Usage:** `npm init`
    - **Description:** Initializes a new `package.json` file in your project directory. You can use the `-y` flag to skip prompts and use default values.

2. `npm install`
    - **Usage:** `npm install` or `npm i`
    - **Description:** Installs all dependencies listed in the `package.json` file. You can also install specific packages by specifying the package name (e.g., `npm install lodash`).

3. `npm install --save`
    - **Usage:** `npm install <package_name> --save` or `npm install <package_name> -S`
    - **Description:** Installs a package and adds it to the `dependencies` section of `package.json`.

4. `npm install --save-dev`
    - **Usage:** `npm install <package_name> --save-dev` or `npm i <package_name> -D`
    - **Description:** Installs a package and adds it to the `devDependencies` section of `package.json`, which is used for development tools that are not needed in production.

5. `npm install -g`
    - **Usage:** `npm install -g <package_name>`
    - **Description:** Installs a package globally on your system, making it available in the terminal across projects (e.g., `npm install -g nodemon`).

6. `npm uninstall`
    - **Usage:** `npm uninstall <package_name>`
    - **Description:** Uninstalls a package from your project and removes it from `package.json`.

7. `npm update`
    - **Usage:** `npm update`
    - **Description:** Updates all installed packages to the latest version that is allowed by the version ranges specified in `package.json`.

8. `npm outdated`
    - **Usage:** `npm outdated`
    - **Description:** Shows a list of installed packages that are outdated, indicating available updates, along with the installed, wanted, and latest versions.

9. `npm run <script_name>`
    - **Usage:** `npm run <script_name>`
    - **Description:** Executes a script defined in the `scripts` section of your `package.json`. For example, if you have `"build": "webpack"` in your `scripts`, you can run it with `npm run build`.

10. `npm test`
    - **Usage:** `npm test`
    - **Description:** Runs the test script defined in the `scripts` section of your `package.json`. It’s a shorthand for `npm run test`.

11. `npm audit`
    - **Usage:** `npm audit`
    - **Description:** Audits your project for security vulnerabilities and provides information on how to fix them. You can also use `npm audit fix` to automatically apply non-breaking security updates.

12. `npm ls`
    - **Usage:** `npm ls`
    - **Description:** Lists all the installed dependencies in your project along with their versions.

13. `npm cache clean --force`
    - **Usage:** `npm cache clean --force`
    - **Description:** Clears npm’s cache, which can be useful for resolving issues with corrupted cache data.

14. `npm config set`
    - **Usage:** `npm config set <key> <value>`
    - **Description:** Sets an npm configuration option (e.g., `npm config set registry https://custom-registry.com`).

15. `npm version`
    - **Usage:** `npm version <update_type>`
    - **Description:** Bumps the version number of your package according to semantic versioning. Use `patch`, `minor`, or `major` as `update_type` (e.g., `npm version minor`).

16. `npm publish`
    - **Usage:** `npm publish`
    - **Description:** Publishes your package to the npm registry. This requires that your `package.json` has the necessary metadata, and you are logged in to npm.

17. `npm login`
    - **Usage:** `npm login`
    - **Description:** Logs you into your npm account, enabling you to publish packages or access private packages.

18. `npm link`
    - **Usage:** `npm link <package_name>`
    - **Description:** Symlinks a package globally to your system. This is often used in development for testing local changes to a package across multiple projects.

19. `npm dedupe`
    - **Usage:** `npm dedupe`
    - **Description:** Simplifies the dependency tree by deduplicating modules, ensuring that modules with the same version are not installed multiple times.

20. `npx`
    - **Usage:** `npx <command>`
    - **Description:** Runs a package without installing it globally. This is useful for one-time use CLI tools (e.g., `npx create-react-app my-app`).

21. `npm rebuild`
    - **Usage:** `npm rebuild`
    - **Description:** Rebuilds native Node.js modules in your project, typically used when switching environments or Node.js versions.

22. `npm ci`
    - **Usage:** `npm ci`
    - **Description:** Installs dependencies from the lock file (`package-lock.json`) and removes existing `node_modules`. This is useful for automated environments like CI/CD pipelines to ensure a clean installation.

23. `npm whoami`
    - **Usage:** `npm whoami`
    - **Description:** Displays the npm username you are currently logged in as.