---
id: key-concepts
title: Key Concepts
sidebar_position: 1
description: composer.json, version constraints, the lockfile, PSR-4 autoloading, stability flags and repositories — including the operators that behave differently from npm.
---

# Key Concepts

## Introduction

Composer looks enough like npm that developers arriving from JavaScript assume
they already know it. Three things catch them out: the `~` operator means
something different, `composer update` is far more disruptive than `npm update`,
and the autoloader is a generated artefact that can be stale.

This page covers the model properly, flagging the npm differences where they
matter.

---

## composer.json

```json title="composer.json"
{
  "name": "acme/storefront",
  "type": "project",
  "description": "Acme storefront application",
  "license": "proprietary",

  "require": {
    "php": ">=8.4",
    "ext-intl": "*",
    "monolog/monolog": "^3.9"
  },
  "require-dev": {
    "phpunit/phpunit": "^12.0"
  },

  "autoload": {
    "psr-4": {"Acme\\Storefront\\": "src/"},
    "files": ["src/helpers.php"],
    "classmap": ["database/seeders"]
  },
  "autoload-dev": {
    "psr-4": {"Acme\\Storefront\\Tests\\": "tests/"}
  },

  "config": {
    "sort-packages": true,
    "platform": {"php": "8.4.0"},
    "allow-plugins": {"phpstan/extension-installer": true}
  },

  "minimum-stability": "stable",
  "prefer-stable": true
}
```

**Package names are `vendor/package`, always lowercase**, matching the Packagist
namespace: `monolog/monolog`, `symfony/http-foundation`.

**`type`** affects how a package is installed. `library` (the default) goes into
`vendor/`; `project` marks an application; `composer-plugin` extends Composer
itself; framework-specific types such as `wordpress-plugin` are handled by
installer plugins.

**`require` vs `require-dev`** behaves as you would expect: `require-dev` is
installed for the project itself but never for consumers. PHPUnit, PHPStan and
CS-Fixer belong there, and the production install is
`composer install --no-dev`.

### Platform packages

Composer's genuinely distinctive feature. Alongside real packages you can
require the runtime itself:

```json
{
  "require": {
    "php": ">=8.4",
    "ext-pdo_mysql": "*",
    "ext-intl": "*",
    "lib-openssl": ">=3.0"
  }
}
```

These participate in the dependency graph. If a library requires `ext-gd` and
the server lacks it, the install fails with a clear message instead of the
application throwing a fatal error on the first image upload.

`composer check-platform-reqs` verifies the current machine against everything
required in the graph — a worthwhile deployment pre-flight check.

---

## Version Constraints

| Constraint       | Resolves to        | Note                                         |
| ---------------- | ------------------ | -------------------------------------------- |
| `3.9.1`          | exactly 3.9.1      | Pinned                                       |
| `^3.9.1`         | `>=3.9.1 <4.0.0`   | Caret — same as npm                          |
| `^0.9.1`         | `>=0.9.1 <0.10.0`  | Below 1.0 the minor is the breaking position |
| `~3.9.1`         | `>=3.9.1 <3.10.0`  | Tilde with three digits — same as npm        |
| **`~3.9`**       | **`>=3.9 <4.0.0`** | **Differs from npm — see below**             |
| `>=3.9 <4.2`     | that range         | A space means AND                            |
| `3.9.*`          | `>=3.9 <3.10`      | Wildcard                                     |
| `^3.9 \|\| ^4.0` | either major       | `\|\|` means OR                              |
| `*`              | anything           | Never do this                                |

:::warning `~` does not mean what it means in npm
Composer's tilde allows the **last specified digit** to increase.

- `~3.9.1` → `>=3.9.1 <3.10.0` (patch only) — same as npm.
- `~3.9` → `>=3.9 <4.0.0` (minor **and** patch) — npm reads this as `3.9.x`.

In Composer, `~3.9` is therefore equivalent to `^3.9`. A JavaScript developer
writing `~3.9` and expecting patch-only updates will receive minor releases.
:::

**Use `^` for almost everything.** It expresses "compatible with", follows
SemVer, and is what the ecosystem assumes. Reach for `~` only when you
deliberately want patch-only updates — and then always write all three digits.

### Stability

Composer models release stability as a first-class concept, which npm has no
equivalent for:

```text
dev  <  alpha  <  beta  <  RC  <  stable
```

```json
{
  "minimum-stability": "stable",
  "prefer-stable": true,
  "require": {
    "acme/experimental": "^2.0@beta",
    "acme/wip": "dev-main"
  }
}
```

- **`minimum-stability`** sets the floor for the whole project. Leave it at
  `stable`.
- **`@beta` on a single constraint** relaxes the floor for that package alone,
  which is far safer than lowering it globally.
- **`prefer-stable: true`** means a stable release wins whenever one satisfies
  the constraint.
- **`dev-main`** tracks a branch. It is not a version and offers no
  reproducibility beyond the lockfile — acceptable for an internal package
  during development, never in a published library.

Lowering `minimum-stability` to `dev` in order to install one package is a
common mistake: it silently permits dev versions of _everything_.

---

## The Lockfile

`composer.json` declares intent. `composer.lock` records the outcome — the exact
version, source URL and commit reference of every package in the resolved tree,
plus a hash of the `composer.json` it came from.

```json title="composer.lock (excerpt)"
{
  "content-hash": "a1b2c3…",
  "packages": [
    {
      "name": "monolog/monolog",
      "version": "3.9.0",
      "source": {"type": "git", "url": "…", "reference": "a1b2c3d…"},
      "dist": {"type": "zip", "url": "…", "shasum": "…"}
    }
  ]
}
```

### install vs update — the distinction that matters most

|                       | `composer install` | `composer update` |
| --------------------- | ------------------ | ----------------- |
| Reads                 | `composer.lock`    | `composer.json`   |
| Resolves versions     | No                 | Yes               |
| Writes the lockfile   | Only if absent     | Always            |
| Deterministic         | Yes                | No                |
| Correct in production | **Yes**            | **Never**         |

`composer update` re-resolves **every** dependency to the newest version each
constraint allows, then rewrites the lockfile. Running it on a production server
is how a deployment picks up a library release from twenty minutes ago that
nobody has tested.

Update one package instead:

```bash
composer update monolog/monolog                    # just this one
composer update monolog/monolog --with-dependencies
composer update --dry-run                          # preview the whole resolution
```

If `composer install` warns that the lockfile is out of date with
`composer.json`, someone edited the manifest without updating the lock. Refresh
only the hash with `composer update --lock` when nothing else should change.

---

## Autoloading

Composer generates `vendor/autoload.php`. One `require` at your entry point
gives you every class in your project and in every dependency.

```php
require __DIR__ . '/vendor/autoload.php';
```

### PSR-4

The standard mapping: a namespace prefix maps to a directory, and the rest of
the namespace maps to the path beneath it.

```json
{
  "autoload": {
    "psr-4": {
      "Acme\\Storefront\\": "src/",
      "Acme\\Storefront\\Admin\\": "modules/admin/src/"
    }
  }
}
```

With that mapping, `Acme\Storefront\Order\Repository` must live at
`src/Order/Repository.php`. The rules are strict:

- One class per file, named exactly as the file.
- The namespace prefix ends with `\\`; the path ends with `/`.
- **Directory casing must match namespace casing.** This works on macOS and
  Windows regardless of case, then fails on a Linux server — one of the most
  common "works locally, 500 in production" causes in PHP.

### The other autoload types

```json
{
  "autoload": {
    "psr-4": {"Acme\\": "src/"},
    "classmap": ["database/seeders", "legacy/"],
    "files": ["src/helpers.php"],
    "exclude-from-classmap": ["/tests/"]
  }
}
```

- **`classmap`** scans directories and builds an explicit class-to-file map. Use
  it for legacy code that does not follow PSR-4.
- **`files`** are loaded eagerly on _every_ request, before anything runs. Use
  it only for procedural helper functions, which cannot be autoloaded. Each
  entry is a fixed per-request cost.

### The autoloader is generated

`composer dump-autoload` regenerates it. You need it after adding a namespace
mapping, or after adding classes to a `classmap` directory — a common source of
"class not found" errors that later disappear mysteriously.

```bash
composer dump-autoload                              # regenerate
composer dump-autoload -o                           # optimised: PSR-4 → classmap
composer dump-autoload -o --classmap-authoritative
composer dump-autoload -o --apcu                    # cache lookups in APCu
```

**In production, always dump an optimised autoloader.** Unoptimised PSR-4 does a
filesystem check for every class load. `--classmap-authoritative` goes further:
a class not in the map is not looked for at all — faster still, and correct as
long as nothing generates classes at runtime.

---

## Scripts and Events

```json
{
  "scripts": {
    "test": "phpunit",
    "analyse": "phpstan analyse --memory-limit=1G",
    "check": ["@analyse", "@test"],
    "post-install-cmd": ["@php artisan package:discover"],
    "post-autoload-dump": ["@php artisan filament:upgrade"]
  },
  "scripts-descriptions": {
    "check": "Run static analysis and the test suite"
  }
}
```

- `@` references another script; `@php` runs the same PHP binary Composer is
  using, avoiding version mismatches.
- `vendor/bin` is on the PATH inside scripts, so `phpunit` resolves locally.
- Events include `pre-install-cmd`, `post-install-cmd`, `post-update-cmd`,
  `post-autoload-dump` and `post-create-project-cmd`.
- Arrays run in sequence and stop at the first failure.

Scripts run with your user's permissions, which is why `--no-scripts` exists and
why `allow-plugins` should be an allowlist rather than `true`.

---

## Repositories

Composer resolves from Packagist by default. Add others for private or patched
code:

```json
{
  "repositories": [
    {"type": "vcs", "url": "https://github.com/acme/internal-lib"},
    {"type": "composer", "url": "https://repo.packagist.com/acme/"},
    {"type": "path", "url": "../shared-lib", "options": {"symlink": true}},
    {"packagist.org": false}
  ]
}
```

- **`vcs`** — read `composer.json` directly from a Git repository, with tags as
  versions.
- **`composer`** — a full registry (Private Packagist, Satis).
- **`path`** — a local directory, symlinked by default. This is Composer's
  answer to monorepo development: edit the library, see the change immediately.
- **`{"packagist.org": false}`** disables the default registry entirely, for
  air-gapped setups.

Order matters — the first repository providing a package wins, which is how you
override an upstream package with a patched fork.

---

## Do's and Don'ts

### Do

- Use `^` constraints and commit `composer.lock`.
- Run `composer install` in production and CI; never `update`.
- Set `config.platform.php` to your production PHP version.
- Dump an optimised autoloader when deploying.
- Keep `allow-plugins` an explicit allowlist.
- Use `@beta` on one constraint rather than lowering `minimum-stability`.
- Match directory casing to namespace casing exactly.

### Don't

- Don't assume `~3.9` means patch-only — in Composer it allows minors.
- Don't run `composer update` on a server.
- Don't set `minimum-stability: dev` to install a single package.
- Don't accumulate entries in `autoload.files`; they load on every request.
- Don't commit `vendor/` without a deliberate reason.
- Don't use `dev-main` constraints in a published library.

---

## FAQ

**Why did `composer install` upgrade something?**
It should not have. Either the lockfile was absent, or someone committed a
`composer.json` change without the matching lock update.

**Class not found, but the file exists.**
In order: is the namespace exactly right; does directory casing match; is the
path in `autoload.psr-4`; and have you run `composer dump-autoload`?

**Should a library commit its lockfile?**
Consumers ignore it, but it makes the library's own CI reproducible. Most
maintained libraries now commit it.

**How do I patch a dependency?**
`cweagans/composer-patches` applies patch files during install; alternatively
fork it and add a `vcs` repository pointing at the fork. Never edit `vendor/`
directly — the next install discards it.

**What does `--no-dev` actually change?**
It skips `require-dev` packages _and_ omits their classes from the generated
autoloader. It is the correct flag for a production install.

---

## Check your understanding

<Quiz
question="A deploy script runs `composer update` on the production server. What is the risk?"
options={[
{
text: 'It re-resolves every dependency to the newest allowed version, so production runs code that was never tested',
correct: true,
why: 'update reads composer.json, ignores the locked versions and rewrites the lockfile. A release published an hour ago can land straight in production.',
},
{
text: 'None, as long as constraints use the caret operator',
why: 'A caret still permits every future minor and patch, and minor releases do introduce regressions.',
},
{
text: 'It only reinstalls packages that are missing',
why: 'That is closer to what install does. update always re-resolves the whole graph.',
},
{
text: 'It fails without a network connection',
why: 'True but incidental — the real problem is non-determinism, which is present even when the network works.',
},
]}
explanation={<>Production and CI should run <code>composer install --no-dev --optimize-autoloader</code>. Updating dependencies is a development activity that produces a reviewed lockfile change.</>}
reference={{label: 'install vs update', href: '/knowledge-base/composer/key-concepts#install-vs-update--the-distinction-that-matters-most'}}
/>

<Quiz
question="A JavaScript developer writes `~3.9` in composer.json expecting patch-only updates, as in npm. What does Composer actually allow?"
options={[
{
text: '>=3.9 <4.0.0 — minor and patch, because the tilde lets the last specified digit increase',
correct: true,
why: 'Composer’s tilde permits the last digit written to grow. With only two digits given, that digit is the minor, so ~3.9 behaves like ^3.9.',
},
{text: '>=3.9.0 <3.10.0 — patch only', why: 'That is npm’s reading of ~3.9. In Composer you would have to write ~3.9.0 to get it.'},
{text: 'Exactly 3.9', why: 'A bare version is an exact pin; the tilde explicitly widens it.'},
{text: '>=3.9 with no upper bound', why: 'The tilde always sets an upper bound; the only question is where it falls.'},
]}
explanation={<>Write all three digits when using a tilde — <code>~3.9.1</code> is unambiguous. Better still, use <code>^</code>, which behaves identically in both ecosystems.</>}
reference={{label: 'Version constraints', href: '/knowledge-base/composer/key-concepts#version-constraints'}}
/>

<Quiz
question="A class in namespace Acme\Storefront\Order lives at src/Order/Repository.php, and psr-4 maps the Acme\Storefront prefix to src/. It works on macOS but throws 'class not found' on the Linux server. Most likely cause?"
options={[
{
text: 'Directory casing does not match the namespace segment; macOS tolerates it and Linux does not',
correct: true,
why: 'macOS and Windows filesystems are case-insensitive by default, so src/order/ resolves locally. Linux is case-sensitive and PSR-4 lookup fails.',
},
{
text: 'composer.lock is missing on the production server',
why: 'A missing lockfile affects which dependency versions install, not how your own classes are autoloaded.',
},
{
text: 'PSR-4 requires an explicit classmap entry for each class',
why: 'PSR-4 derives the path from the namespace. Classmaps exist for code that does not follow PSR-4.',
},
{
text: 'The namespace prefix must not end with a backslash',
why: 'It must — the trailing separator is required by the PSR-4 mapping syntax.',
},
]}
explanation={<>The second most likely cause is a stale autoloader: after adding a namespace mapping or a class in a classmap directory, run <code>composer dump-autoload</code>. Both failure modes present identically as "class not found".</>}
reference={{label: 'PSR-4', href: '/knowledge-base/composer/key-concepts#psr-4'}}
/>

<Quiz
question="Which of these are true about Composer's platform requirements?"
type="multiple"
options={[
{text: 'A package can require an extension such as ext-intl, and the install fails if it is absent', correct: true, why: 'Extensions and PHP itself participate in resolution, so a missing extension is an install-time error rather than a runtime fatal.'},
{text: 'config.platform.php pins the version Composer resolves against, independent of the PHP running Composer', correct: true, why: 'This is what stops a developer on 8.5 resolving packages that cannot install on an 8.4 production server.'},
{text: 'composer check-platform-reqs verifies the current machine against the graph', correct: true, why: 'A useful deployment pre-flight check.'},
{text: 'Platform requirements are advisory and produce only warnings', why: 'They are enforced. --ignore-platform-reqs exists to bypass them and should be used sparingly.'},
{text: 'npm has an equivalent that resolves Node versions the same way', why: 'npm engines is advisory unless engine-strict is set, and it plays no part in dependency resolution.'},
]}
explanation={<>Platform requirements are one of Composer's real advantages: they convert a class of production runtime failure into an install-time error.</>}
reference={{label: 'Platform packages', href: '/knowledge-base/composer/key-concepts#platform-packages'}}
/>

<Quiz
question="You need one package at a beta version. What is the safest way to allow it?"
options={[
{
text: 'Append @beta to that single constraint and leave minimum-stability at stable',
correct: true,
why: 'A stability flag on one constraint relaxes the floor for that package only. Everything else still resolves to stable releases.',
},
{
text: 'Set minimum-stability to beta',
why: 'That lowers the floor for the entire project, so any dependency may resolve to a beta — usually without anyone noticing.',
},
{
text: 'Set minimum-stability to dev with prefer-stable true',
why: 'prefer-stable only prefers. Where no stable release satisfies a constraint you can still get dev versions of unrelated packages.',
},
{
text: 'Require the package with a dev-main constraint',
why: 'That tracks a moving branch rather than a tested beta release — less stable still.',
},
]}
explanation={<>Per-constraint stability flags are the right tool whenever the answer is "just this one package". Global stability changes are almost always broader than intended.</>}
reference={{label: 'Stability', href: '/knowledge-base/composer/key-concepts#stability'}}
/>

---

## References

- [composer.json schema](https://getcomposer.org/doc/04-schema.md) — every
  field, authoritatively.
- [Versions and constraints](https://getcomposer.org/doc/articles/versions.md) —
  the exact semantics of `^`, `~` and stability flags.
- [Autoloader optimisation](https://getcomposer.org/doc/articles/autoloader-optimization.md)
  — what each optimisation level does, and its trade-offs.
- [PSR-4: Autoloader](https://www.php-fig.org/psr/psr-4/) — the specification.
- [Repositories](https://getcomposer.org/doc/05-repositories.md) — VCS, path and
  private registries.
- [Scripts](https://getcomposer.org/doc/articles/scripts.md) — the full event
  list.
