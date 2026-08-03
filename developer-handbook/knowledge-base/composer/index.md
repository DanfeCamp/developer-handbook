---
title: Composer
description: "Dependency management for PHP: what Composer does, how to install and configure it, and where to go for concepts and commands."
---

# Composer

## Introduction

Composer is the dependency manager for PHP. It reads a `composer.json`
declaring what your project needs, resolves a compatible set of versions,
downloads them into `vendor/`, and generates an autoloader so you never write
`require` for a class again.

It arrived in 2012 and changed PHP more than any language feature of the same
era. Before it, PHP libraries were distributed as tarballs or PEAR packages,
every project invented its own include strategy, and sharing code between
frameworks was largely impractical. Composer plus the PSR autoloading standards
turned PHP into an ecosystem where Symfony components run inside Laravel
applications without anyone thinking about it.

**What it manages:**

- **Dependency resolution** — finding one set of versions that satisfies every
  constraint in the graph, including PHP itself and required extensions.
- **Reproducibility** — `composer.lock` records the exact resolved set so every
  machine and deploy installs the same code.
- **Autoloading** — a generated PSR-4 autoloader covering your code and all
  dependencies.
- **Scripts and events** — hooks that run at defined points of the install
  lifecycle.

**Composer resolves platform requirements too**, which npm does not. A package
can require `php: >=8.2` and `ext-intl`, and Composer will refuse to install if
the machine cannot satisfy it. This catches at install time what would otherwise
be a fatal error in production.

:::note Global, not per-project
Unlike npm, Composer is installed once on the machine and used across all
projects. There is no "Composer bundled with PHP".
:::

---

## Installation & Setup

### Install Composer

```bash
# macOS
brew install composer

# Debian / Ubuntu — the distro package is usually old; prefer the installer
sudo apt install php-cli unzip
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer

# Windows
winget install --id Composer.Composer
```

```bash
composer --version   # 2.10.x at the time of writing
php --version        # 8.4 or 8.5
```

Verify the installer signature if you are scripting the install — Composer
publishes a checksum for exactly this reason, and piping an unverified installer
into `php` is the same class of risk as `curl | bash`.

```bash
composer self-update             # Composer updates itself
composer self-update --rollback  # if a release breaks something
```

**Use Composer 2.** Composer 1 is unsupported and dramatically slower — version
2 rewrote the solver and parallelised downloads, turning multi-minute installs
into seconds.

### Starting a project

```bash
composer init                    # interactive: name, description, requirements
composer require monolog/monolog # add a dependency
composer require --dev phpunit/phpunit

# Or scaffold from a template
composer create-project laravel/laravel my-app
composer create-project symfony/skeleton my-api
```

### A `composer.json` worth copying

```json title="composer.json"
{
  "name": "acme/storefront",
  "description": "Acme storefront application",
  "type": "project",
  "license": "proprietary",

  "require": {
    "php": ">=8.4",
    "ext-intl": "*",
    "ext-pdo": "*",
    "monolog/monolog": "^3.9"
  },
  "require-dev": {
    "phpunit/phpunit": "^12.0",
    "phpstan/phpstan": "^2.1",
    "friendsofphp/php-cs-fixer": "^3.75"
  },

  "autoload": {
    "psr-4": {"Acme\\Storefront\\": "src/"}
  },
  "autoload-dev": {
    "psr-4": {"Acme\\Storefront\\Tests\\": "tests/"}
  },

  "config": {
    "sort-packages": true,
    "optimize-autoloader": true,
    "platform": {"php": "8.4.0"},
    "allow-plugins": {
      "composer/package-versions-deprecated": false
    }
  },

  "scripts": {
    "test": "phpunit",
    "analyse": "phpstan analyse",
    "check": ["@analyse", "@test"]
  },

  "minimum-stability": "stable",
  "prefer-stable": true
}
```

Three settings in there do real work:

**`config.platform.php`** pins the PHP version Composer _resolves against_,
independent of the PHP running Composer. Without it, a developer on PHP 8.5 can
resolve packages that will not install on a production server running 8.4. Set
it to your production minimum.

**`config.allow-plugins`** is a security control. Composer plugins execute
arbitrary code during install, and since Composer 2.2 each must be explicitly
allowed. Do not blanket-enable it with `true` — list the plugins you actually
trust.

**`prefer-stable: true`** means that even if `minimum-stability` is relaxed,
Composer still prefers stable releases where one satisfies the constraint.

### Global tools

```bash
composer global require laravel/installer
```

Add `~/.composer/vendor/bin` (or `~/.config/composer/vendor/bin`) to your PATH.
Keep global installs to a minimum — a project-local dev dependency is
reproducible, a global one is not.

---

## The Ecosystem

**[Packagist](https://packagist.org)** is the default registry: metadata only,
pointing at the Git repositories where packages actually live. Anyone can
publish by submitting a public repository URL.

**Private Packagist** and self-hosted **Satis** serve private packages. You can
also point Composer straight at a VCS repository:

```json
{
  "repositories": [
    {"type": "vcs", "url": "https://github.com/acme/internal-lib"},
    {"type": "composer", "url": "https://repo.packagist.com/acme/"}
  ]
}
```

Composer 2.9 added a `composer repo` command to list, add and remove these from
the CLI rather than editing JSON by hand.

**PSR standards** from PHP-FIG are what make the ecosystem interoperable:
PSR-4 (autoloading), PSR-7 (HTTP messages), PSR-11 (containers), PSR-12 (coding
style), PSR-3 (logging). Composer distributes; PSRs make the pieces fit.

---

## Security

Composer 2.9 introduced **automatic security blocking**: installing without a
lockfile, or updating, now _fails_ when a dependency has a known advisory. It
can also be configured to fail on abandoned packages.

```bash
composer audit                  # check the installed tree against advisories
composer audit --abandoned=fail # treat abandoned packages as failures
```

The advisory data comes from the
[PHP Security Advisories Database](https://github.com/FriendsOfPHP/security-advisories),
and running `composer audit` in CI is the minimum bar.

The same supply-chain reasoning as npm applies: scripts and plugins execute
during install. `composer install --no-scripts` exists, and `allow-plugins`
should be an allowlist rather than `true`.

---

## What is in this section

```mdx-code-block
import DocCardList from '@theme/DocCardList';
import {useCurrentSidebarCategory} from '@docusaurus/theme-common';

<DocCardList items={useCurrentSidebarCategory().items}/>
```

- **[Key Concepts](/knowledge-base/composer/key-concepts)** — `composer.json`,
  version constraints (which differ from npm in one important way), the
  lockfile, autoloading, stability and repositories.
- **[Commands](/knowledge-base/composer/composer-commands)** — a task-oriented
  reference, including the `install`/`update` distinction that causes most
  Composer incidents.

---

## FAQ

**Composer or npm — how similar are they?**
Conceptually close: a manifest, a lockfile, a registry, scripts. The differences
that matter are that Composer resolves PHP and extension requirements as part of
the graph, its `~` operator means something different, and `composer update`
is far more disruptive than `npm update`.

**Do I commit `composer.lock`?**
For an application, always. For a library, it is ignored by consumers, but
committing it still makes your own CI reproducible — most maintained libraries
now do.

**Is `vendor/` committed?**
Normally no. Some teams commit it for deployment environments with no network
access; if you do, commit the whole thing consistently and never partially.

**Why is Composer using so much memory?**
`composer update` on a large graph is genuinely memory-hungry. `COMPOSER_MEMORY_LIMIT=-1`
lifts the cap. In production you should be running `composer install`, which is
far lighter.

**What replaced PEAR?**
Composer did, completely. If documentation tells you to use PEAR, it predates 2012.

---

## References

- [Composer documentation](https://getcomposer.org/doc/) — the authoritative
  reference.
- [composer.json schema](https://getcomposer.org/doc/04-schema.md) — every field.
- [Packagist](https://packagist.org) — the default registry.
- [PHP-FIG standards](https://www.php-fig.org/psr/) — PSR-4 autoloading and the
  rest.
- [PHP Security Advisories Database](https://github.com/FriendsOfPHP/security-advisories)
  — the data behind `composer audit`.
