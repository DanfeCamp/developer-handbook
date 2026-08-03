---
id: composer-commands
title: Composer Commands
sidebar_position: 2
description: A task-oriented Composer reference — installing, updating one package safely, inspecting the graph, auditing, autoloading and deploying.
---

# Composer Commands

## Introduction

Organised by task. For what these commands operate on — constraints, the
lockfile, autoloading — read
[Key Concepts](/knowledge-base/composer/key-concepts) first.

Examples assume Composer 2.10 and PHP 8.4 or later.

---

## Starting a project

```bash
composer init                              # interactive manifest creation
composer create-project laravel/laravel my-app
composer create-project symfony/skeleton my-api
composer create-project acme/template my-app 2.1.0 --no-dev
```

`create-project` clones a package, installs its dependencies and runs its
`post-create-project-cmd` scripts. It is the standard scaffolding mechanism in
PHP.

---

## Installing and updating

```bash
composer install                     # install exactly what composer.lock records
composer install --no-dev            # skip require-dev — for production
composer install --no-scripts        # skip lifecycle scripts
composer install --prefer-dist       # download archives (default, fast)
composer install --prefer-source     # clone repositories (for contributing)

composer require monolog/monolog                 # add, resolve, install, update lock
composer require monolog/monolog:^3.9            # with an explicit constraint
composer require --dev phpunit/phpunit
composer require --no-update monolog/monolog     # edit the manifest only

composer remove monolog/monolog
```

```bash
composer update                                  # ⚠️ re-resolves EVERYTHING
composer update monolog/monolog                  # just this package
composer update monolog/monolog --with-dependencies
composer update "symfony/*"                      # a pattern
composer update --dry-run                        # preview without writing
composer update --lock                           # refresh only the content hash
```

:::danger `composer install` in production, never `composer update`
`update` ignores the lockfile, re-resolves every constraint to its newest
allowed version, and rewrites the lock. Running it on a server means deploying
code nobody has tested. `install` is deterministic; that is the whole point of
committing the lockfile.
:::

`composer require` implicitly performs a partial update, which is why adding one
package can occasionally shift others. Use `--dry-run` first on a large graph.

---

## Inspecting the graph

```bash
composer show                        # every installed package
composer show --direct               # only what you required directly
composer show --tree                 # the full dependency tree
composer show monolog/monolog        # detail for one package
composer show monolog/monolog --all  # …including every available version

composer depends monolog/monolog     # who requires this? (alias: why)
composer depends monolog/monolog --tree
composer prohibits php:8.5           # what blocks this version? (alias: why-not)

composer outdated                    # what is behind
composer outdated --direct           # only direct dependencies — far less noise
composer outdated --major-only       # only breaking upgrades available

composer licenses                    # the licence of every dependency
composer validate                    # check composer.json is well formed
composer validate --strict           # …and warn about non-fatal issues
composer check-platform-reqs         # does this machine satisfy the graph?
```

Two of these earn their keep repeatedly:

**`composer prohibits`** answers "why can't I upgrade to PHP 8.5?" by naming the
package whose constraint blocks it. Without it, you are reading constraints by
hand across a hundred packages.

**`composer outdated --direct`** is the version to actually run. Unfiltered
`outdated` lists hundreds of transitive packages you do not control.

---

## Auditing

```bash
composer audit                       # known advisories in the installed tree
composer audit --no-dev              # only what ships to production
composer audit --abandoned=fail      # treat abandoned packages as a failure
composer audit --format=json         # for CI processing
```

Since **Composer 2.9**, security blocking is automatic: installing without a
lockfile, or running an update, fails when a dependency has a known advisory.
That is a meaningful default, and it does not replace running `composer audit`
in CI against your locked tree.

Advisory data comes from the
[PHP Security Advisories Database](https://github.com/FriendsOfPHP/security-advisories).

---

## Autoloading

```bash
composer dump-autoload                                # regenerate (alias: dumpautoload)
composer dump-autoload -o                             # optimised: PSR-4 → classmap
composer dump-autoload -o --classmap-authoritative    # fastest; no filesystem fallback
composer dump-autoload -o --apcu                      # cache lookups in APCu
composer dump-autoload --no-dev                       # exclude autoload-dev
```

Run a plain `dump-autoload` after adding a namespace mapping or after adding
classes to a `classmap` directory. Deploy with `-o` at minimum.

`--classmap-authoritative` means a class absent from the map is not searched for
at all. That is the fastest option and is correct unless something generates
classes at runtime — some ORMs and proxy generators do.

---

## Repositories and configuration

```bash
composer config --list                       # effective configuration
composer config --global --list
composer config repositories.acme vcs https://github.com/acme/lib
composer config platform.php 8.4.0
composer config allow-plugins.phpstan/extension-installer true
composer config --unset platform.php

# Composer 2.9+ — manage repositories without editing JSON
composer repo list
composer repo add acme composer https://repo.packagist.com/acme/
composer repo remove acme
```

`composer config` edits `composer.json` (or the global config) correctly rather
than by hand, which matters in scripts.

---

## Running scripts and binaries

```bash
composer run-script test             # run a named script (alias: composer test)
composer run-script --list           # list defined scripts
composer exec phpunit                # run a vendor/bin binary
composer exec -- phpunit --filter=OrderTest
./vendor/bin/phpunit                 # equivalent, and what CI usually does
```

Any script name that does not collide with a Composer command can be invoked
directly: `composer test`, `composer analyse`.

---

## Global packages

```bash
composer global require laravel/installer
composer global update
composer global show
composer global remove laravel/installer
composer global config bin-dir --absolute   # where the binaries went
```

Add that bin directory to your PATH. Keep global installs rare — a project-local
dev dependency is reproducible for the whole team; a global one is not.

---

## Diagnostics and maintenance

```bash
composer diagnose                    # check connectivity, config, permissions
composer self-update                 # update Composer itself
composer self-update --rollback      # revert a bad Composer release
composer clear-cache                 # clear the package cache
composer show --platform             # PHP version and extensions Composer sees

COMPOSER_MEMORY_LIMIT=-1 composer update    # lift the memory cap for big graphs
composer update -vvv                        # maximum verbosity
```

`composer diagnose` is the first thing to run when installs behave strangely —
it checks network access, proxy settings, disk permissions and whether Composer
itself is current.

---

## Deploying

```bash
composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist
```

Each flag earns its place:

| Flag                    | Why                                                     |
| ----------------------- | ------------------------------------------------------- |
| `--no-dev`              | Skips test and lint tooling; smaller and safer          |
| `--optimize-autoloader` | Classmap instead of filesystem lookups on every request |
| `--no-interaction`      | Never prompt — a prompt in CI is a hang                 |
| `--prefer-dist`         | Download archives rather than cloning repositories      |

Add `--classmap-authoritative` if nothing generates classes at runtime, and
`--no-scripts` if your deploy runs the equivalent steps itself.

```dockerfile
FROM composer:2 AS vendor
WORKDIR /app
# Copy manifests first so this layer caches until dependencies change.
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

FROM php:8.4-fpm-alpine
WORKDIR /app
COPY --from=vendor /app/vendor ./vendor
COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative
```

`--no-autoloader` in the first stage is deliberate: the autoloader must be
generated _after_ the application source is present, or it will not contain your
own classes.

---

## Cheat Sheet

```bash
# ── Everyday ────────────────────────────────────────────
composer install                     # exactly what the lockfile says
composer require vendor/pkg          # add a dependency
composer require --dev vendor/pkg    # add a dev dependency
composer update vendor/pkg           # update ONE package

# ── Inspect ─────────────────────────────────────────────
composer show --direct               # what you actually chose
composer outdated --direct           # what is behind
composer depends vendor/pkg          # who pulled this in
composer prohibits php:8.5           # what blocks this upgrade

# ── Health ──────────────────────────────────────────────
composer audit --no-dev              # advisories that reach production
composer validate --strict           # manifest sanity
composer check-platform-reqs         # does this machine qualify
composer diagnose                    # environment problems

# ── Deploy ──────────────────────────────────────────────
composer install --no-dev --optimize-autoloader --no-interaction
composer dump-autoload -o --classmap-authoritative
```

---

## Common Mistakes

**`composer update` in a deploy script.** The single most damaging Composer
mistake. Use `composer install`.

**Forgetting `dump-autoload` after adding a namespace.** "Class not found" for a
file that plainly exists.

**Deploying without `--optimize-autoloader`.** Every class load becomes a
filesystem check. It is a measurable, free performance win.

**Blanket `allow-plugins: true`.** Plugins execute arbitrary code during
install. Keep it an allowlist.

**`--ignore-platform-reqs` as a habit.** It exists for building on a machine
that differs from production. Used routinely, it defers a real incompatibility
to runtime.

**Editing files in `vendor/`.** The next `install` discards them. Use a patch
package or a fork.

**Not committing `composer.lock`.** Every environment resolves independently and
they drift.

---

## Debugging

| Symptom                                    | Cause and fix                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `Your requirements could not be resolved`  | Read the whole message — it names the conflicting constraints. `composer prohibits` narrows it. |
| `Class not found` for your own class       | Stale autoloader or a casing mismatch. `composer dump-autoload`; check directory case.          |
| Lockfile is out of date with composer.json | The manifest was edited without installing. `composer update --lock`, or a partial update.      |
| Allowed memory size exhausted              | `COMPOSER_MEMORY_LIMIT=-1 composer update`. Production should be running `install`.             |
| `requires ext-… but it is not present`     | Install the PHP extension, or set `config.platform` if the target really does have it.          |
| Works locally, fails on the server         | PHP version or extension difference. `composer check-platform-reqs` on both.                    |
| Install is very slow                       | Composer 1, or `--prefer-source`. Upgrade, and use `--prefer-dist`.                             |
| A plugin refuses to run                    | Not allow-listed. `composer config allow-plugins.<vendor>/<pkg> true`.                          |

```bash
composer diagnose
composer update --dry-run -vvv
composer show --platform
```

---

## FAQ

**Should CI run `install` or `update`?**
`install`. CI must test the committed lockfile. A separate scheduled job can run
`update` and open a pull request with the resulting lockfile change.

**How do I upgrade one package without touching anything else?**
`composer update vendor/package`. Add `--with-dependencies` if its own
requirements must move too.

**What is the difference between `--prefer-dist` and `--prefer-source`?**
`dist` downloads a zip — fast, and the default. `source` clones the Git
repository, which you want only when contributing to the dependency.

**Why is `composer require` slow?**
It performs a partial update and must re-check the graph. `--no-update` edits
the manifest alone if you intend to install later.

**Can I run Composer as root?**
It warns, and you should not. Plugins and scripts execute during install; as
root they execute as root.

**How do I make a private package installable?**
Add a `vcs` repository pointing at the Git URL, and ensure Composer has
credentials — an SSH key or a token in `auth.json`, which must not be committed.

---

## Check your understanding

<Quiz
question="Your deployment pipeline runs `composer update --no-dev` on the production host. Constraints all use the caret operator and the test suite passed in CI. What is wrong?"
options={[
{
text: 'update re-resolves every constraint, so production can install versions that CI never tested',
correct: true,
why: 'CI tested the locked tree. update discards it and resolves afresh, so any release published since CI ran can land in production untested.',
},
{
text: 'Nothing — --no-dev makes it safe',
why: '--no-dev only excludes require-dev packages. It has no effect on whether versions are re-resolved.',
},
{
text: 'Caret constraints are too strict and will cause the update to fail',
why: 'Carets are the recommended default, and they permit rather than prevent minor upgrades.',
},
{
text: 'update cannot run with --no-dev',
why: 'The combination is valid; it is simply the wrong command for a deploy.',
},
]}
explanation={<>The correct deploy command is <code>composer install --no-dev --optimize-autoloader --no-interaction</code>. Dependency updates belong in development, where the resulting lockfile change is reviewed.</>}
reference={{label: 'Installing and updating', href: '/knowledge-base/composer/composer-commands#installing-and-updating'}}
/>

<Quiz
question="You want to upgrade to PHP 8.5 but Composer refuses. Which command tells you which package is blocking it?"
options={[
{text: 'composer prohibits php:8.5', correct: true, why: 'prohibits (aliased why-not) reports exactly which packages have constraints incompatible with the requested version.'},
{text: 'composer depends php', why: 'depends shows what requires a package, but not which constraint blocks a specific target version.'},
{text: 'composer check-platform-reqs', why: 'Checks the current machine against the current graph. It does not answer a hypothetical about a different PHP version.'},
{text: 'composer show --platform', why: 'Lists the PHP version and extensions Composer can see, saying nothing about package constraints.'},
]}
explanation={<><code>prohibits</code> and <code>depends</code> are the two graph-interrogation commands worth memorising: one answers "why is this here", the other "why can't I have that".</>}
reference={{label: 'Inspecting the graph', href: '/knowledge-base/composer/composer-commands#inspecting-the-graph'}}
/>

<Quiz
question="In the multi-stage Dockerfile above, why does the first stage pass `--no-autoloader`?"
options={[
{
text: 'The application source is not present yet, so an autoloader generated there would omit the project’s own classes',
correct: true,
why: 'Only the manifests are copied at that point, deliberately, so the layer caches. The autoloader is generated in the later stage once src/ exists.',
},
{
text: 'Autoloader generation is not permitted in a multi-stage build',
why: 'It is permitted; it would simply produce an incomplete map at that point.',
},
{
text: 'It makes the vendor directory smaller',
why: 'The autoloader files are tiny. Size is not the motivation.',
},
{
text: 'The composer image lacks the PHP extensions needed to dump an autoloader',
why: 'Dumping an autoloader requires no extensions beyond what the composer image already has.',
},
]}
explanation={<>The general pattern — copy manifests, install dependencies, copy source, then generate derived artefacts — is what makes the expensive dependency layer cacheable across code changes.</>}
reference={{label: 'Deploying', href: '/knowledge-base/composer/composer-commands#deploying'}}
/>

<Quiz
question="Which commands are appropriate to run against a production deployment?"
type="multiple"
options={[
{text: 'composer install --no-dev --optimize-autoloader', correct: true, why: 'Deterministic install from the lockfile, without dev tooling, with a fast autoloader.'},
{text: 'composer check-platform-reqs', correct: true, why: 'Verifies the host satisfies every PHP and extension requirement — a sensible pre-flight check.'},
{text: 'composer audit --no-dev', correct: true, why: 'Reports advisories affecting the packages that actually ship.'},
{text: 'composer update --no-dev', why: 'Re-resolves the whole graph on the server. This is the mistake the install/update distinction exists to prevent.'},
{text: 'composer require --dev phpunit/phpunit', why: 'Modifies the manifest and installs dev tooling on a production host. Neither belongs there.'},
]}
explanation={<>Anything that <em>resolves</em> versions or <em>writes</em> the manifest belongs in development. Production only installs, verifies and reports.</>}
reference={{label: 'Deploying', href: '/knowledge-base/composer/composer-commands#deploying'}}
/>

<Quiz
question="After adding a new PSR-4 namespace mapping to composer.json, your new classes still throw 'class not found'. Dependencies are all installed. What is missing?"
options={[
{
text: 'composer dump-autoload — the autoloader is a generated file and does not know about the new mapping yet',
correct: true,
why: 'vendor/autoload.php and its maps are generated at install time. A manifest edit alone does not regenerate them.',
},
{
text: 'composer update, to refresh the lockfile',
why: 'The lockfile records dependency versions. Your own autoload mappings are not dependencies.',
},
{
text: 'composer install --no-dev',
why: 'Would reinstall dependencies and, incidentally, regenerate the autoloader — but it is a heavier command with an unrelated side effect.',
},
{
text: 'composer clear-cache',
why: 'Clears downloaded package archives. It has nothing to do with autoload maps.',
},
]}
explanation={<>The same regeneration is needed after adding classes to a <code>classmap</code> directory. Deploys should dump an optimised autoloader with <code>-o</code> after the source is in place.</>}
reference={{label: 'Autoloading', href: '/knowledge-base/composer/composer-commands#autoloading'}}
/>

---

## References

- [Composer CLI reference](https://getcomposer.org/doc/03-cli.md) — every
  command and flag.
- [Autoloader optimisation](https://getcomposer.org/doc/articles/autoloader-optimization.md)
  — what `-o`, `--classmap-authoritative` and `--apcu` each do.
- [composer audit](https://getcomposer.org/doc/03-cli.md#audit) — options and
  output formats.
- [Composer 2.9 release notes](https://getcomposer.org/changelog/2.9.0) —
  automatic security blocking and the `repo` command.
- [Deploying with Composer](https://getcomposer.org/doc/articles/autoloader-optimization.md)
  — production install guidance.
