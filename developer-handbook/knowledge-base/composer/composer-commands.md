---
id: composer-commands
title: Composer Commands
sidebar_position: 2
---

# Composer Commands

1. `install`

   - **Usage:** `composer install`
   - **Description:** Installs the project dependencies as specified in the `composer.lock` file. If `composer.lock` does not exist, it reads from `composer.json` and generates `composer.lock`. It ensures that every environment running the project has the same package versions.

2. `update`

   - **Usage:** `composer update [package-name]`
   - **Description:** Updates project dependencies based on the version constraints in `composer.json`. If no package is specified, it updates all dependencies. It also regenerates the `composer.lock` file with the updated versions.

3. `require`

   - **Usage:** `composer require vendor/package`
   - **Description:** Adds a new package to your project and updates the `composer.json` and `composer.lock` files. The package is downloaded and installed in the vendor directory. Version constraints can also be added, e.g., `composer require vendor/package:^2.0`.

4. `remove`

   - **Usage:** `composer remove vendor/package`
   - **Description:** Removes a package from your project, updating `composer.json` and `composer.lock` files. The package is also deleted from the `vendor` directory.

5. `dump-autoload`

   - **Usage:** `composer dump-autoload`
   - **Description:** Regenerates Composer’s autoloader files, ensuring that new classes and files are recognized without needing to run `composer install` again. This is useful when manually adding new files or classes to your project.

6. `show`

   - **Usage:** `composer show [package-name]`
   - **Description:** Displays information about installed packages in your project. You can view details about all installed packages or get more specific information about a single package by providing its name.

7. `outdated`

   - **Usage:** `composer outdated [package-name]`
   - **Description:** Lists all installed packages that have newer versions available, according to the version constraints defined in `composer.json`. It helps identify outdated dependencies without updating them.

8. `check-platform-reqs`

   - **Usage:** `composer check-platform-reqs`
   - **Description:** Checks if the installed PHP version and extensions meet the platform requirements of the installed packages. This ensures compatibility between your environment and the required packages.

9. `validate`

   - **Usage:** `composer validate`
   - **Description:** Validates the `composer.json` file, checking for syntax errors and adherence to Composer’s schema. It helps ensure the file is correctly structured and free of configuration issues.

10. `init`

    - **Usage:** `composer init`
    - **Description:** Walks you through creating a new `composer.json` file by prompting for basic project details such as the name, description, and required dependencies. It’s the starting point for setting up Composer in a new project.

11. `create-project`

    - **Usage:** `composer create-project vendor/project [directory]`
    - **Description:** Downloads and sets up a new project from an existing package or project skeleton. This command is often used to start new projects with frameworks like Laravel or Symfony, e.g., `composer create-project laravel/laravel my-app`.

12. `global require`

    - **Usage:** `composer global require vendor/package`
    - **Description:** Installs a package globally on your system rather than locally to a project. This is useful for installing tools and packages you want to use across multiple projects, such as PHPUnit or Laravel installer.
