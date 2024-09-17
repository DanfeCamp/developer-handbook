---
id: key-concepts
title: Key Concepts
sidebar_position: 1
---

# Key Concepts

## Composer.json

The `composer.json` file is the heart of a Composer-managed project. It defines all the dependencies your project requires, along with metadata such as the project’s name, version, description, and authors. It also supports defining autoloading rules, scripts to run during the installation or update process, and configuration options for how Composer behaves. You can specify version constraints for each package in the `require` section, ensuring that only compatible versions are installed. This file ensures that developers working on the same project are aware of and use the same set of dependencies. Managing this file carefully is essential for maintaining the stability and portability of your project.

## Packagist

Packagist is the main repository used by Composer to search for PHP packages. It acts as a vast library of reusable PHP code, making it easy for developers to find, install, and share packages. Packagist hosts thousands of open-source packages, ranging from small utilities to large frameworks like Symfony or Laravel. When you install a package via Composer, it fetches the package from Packagist and installs it into your project. Developers can also publish their own packages to Packagist, allowing others to benefit from their work. This centralized repository is a key part of Composer’s ecosystem, helping reduce duplication of effort and speeding up PHP development.

## Autoloading

One of Composer’s key features is autoloading, which eliminates the need to manually include or require PHP files throughout your project. Composer generates an autoloader script that adheres to standards like PSR-4, which map class names to file paths, ensuring that the right files are loaded automatically when needed. This feature is especially useful for large projects with complex directory structures. By simply using `require 'vendor/autoload.php';`, you can enable autoloading for all your dependencies. Composer also supports custom autoloading rules, allowing developers to specify how their project’s files should be organized and loaded.

## Version Constraints

Composer’s versioning system allows developers to define specific version constraints for the libraries their project depends on. These constraints follow semantic versioning, which means you can specify major, minor, or patch versions depending on the stability and compatibility you need. For example, using `"^1.0"` ensures compatibility with all minor versions, while `">=1.0, <2.0"` ensures that no major changes are introduced. Version constraints are important for maintaining project stability, as they prevent incompatible updates from breaking your project while still allowing bug fixes and new features in safe versions.

## Composer.lock

The `composer.lock` file is automatically generated when you install or update dependencies. It records the exact versions of all installed packages, ensuring that anyone working on the project will use the same versions of each dependency. While the `composer.json` file specifies version ranges, `composer.lock` locks the versions down to the precise package versions that were installed. This file is crucial for consistency across different environments, preventing issues caused by variations in dependency versions. For this reason, it’s recommended to commit the `composer.lock` file to version control to ensure every developer and deployment uses the exact same setup.

## PSR (PHP Standards Recommendations)

Composer is designed to follow PHP Standards Recommendations (PSRs), particularly PSR-4 for autoloading. PSR-4 defines how to map fully-qualified class names to file paths, ensuring that classes are loaded automatically and predictably. For instance, a class named `App\Controllers\HomeController` would be stored in a file like `src/Controllers/HomeController.php`. Composer’s integration with PSR-4 makes it easier to organize and maintain code by following consistent standards. Other PSRs, like PSR-1 and PSR-2 for coding standards and PSR-7 for HTTP message interfaces, also align with Composer’s focus on best practices for building modular and maintainable PHP projects.

The PSRs are listed below:

1. Basic Coding Standard
2. Coding Style Guide
3. Logger Interface
4. Autoloading Standard
5. PHPDoc Standard
6. Caching Interface
7. HTTP Message Interface
8. Huggable Interface
9. Security Advisories
10. Security Reporting Process
11. Container Interface
12. Extended Coding Style Guide
13. Hypermedia Links
14. Event Dispatcher
15. HTTP Handlers
16. Simple Cache
17. HTTP Factories
18. HTTP Client
19. PHPDoc tags
20. Clock
21. Internationalization
22. Application Tracing

## Composer Install vs. Composer Update

`composer install` and `composer update` are two core commands in Composer with distinct purposes. `composer install` reads the `composer.lock` file and installs the exact versions of dependencies listed there, ensuring consistent behavior across different environments. It’s typically used after cloning a project or pulling changes from version control. In contrast, `composer update` fetches the latest versions of dependencies based on the constraints in `composer.json` and updates both `composer.json` and `composer.lock` with the new versions. This is useful when you want to upgrade your project’s dependencies, but it’s recommended to use it carefully to avoid introducing breaking changes unexpectedly.

## Vendor Directory

When Composer installs packages, they are placed inside a directory called `vendor`, located at the root of your project. The `vendor` directory contains all the code for the third-party packages your project depends on, along with a generated autoloader script. The structure of this directory organizes packages by their vendor namespace, which helps avoid conflicts between packages with similar names. Composer automatically handles the installation, updating, and removal of packages in this directory. The `vendor` directory should not be committed to version control, as it can be regenerated on other environments using the `composer install` command, based on the `composer.lock` file.