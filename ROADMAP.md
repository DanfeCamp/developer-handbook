# Developer Handbook — Content Roadmap

The single source of truth for documentation progress. Update this file whenever
content is added, reorganised, or completed.

- **Last reviewed:** 2026-08-03
- **Version baseline:** Node.js 24 LTS · React 19.2.8 · Next.js 16.2 LTS ·
  Express 5.2 · Laravel 13 (PHP 8.3+) · FastAPI 0.141 (Python 3.10+) ·
  WordPress 7.0 · Git 2.54 · npm 11 · Composer 2.10

---

## Status legend

| Symbol | Meaning                                                                |
| ------ | ---------------------------------------------------------------------- |
| ✅     | Complete — meets the page standard below, reviewed against latest docs |
| 🟡     | Partial — useful content exists, but incomplete or missing sections    |
| ⏳     | In progress this cycle                                                 |
| 📄     | Outline published — scope and references only, full guide pending      |
| ❌     | Not started                                                            |
| 🔍     | Needs accuracy review against current official docs                    |

**All 106 topics now have a full guide written to the page standard below.** The
📄 outline stage and its **soon** sidebar badge are gone; every sidebar entry
links to finished content. The symbols above remain for tracking future
additions — the topics under _Newly identified topics_ have not been started.

---

## Page standard

Every major technology page should cover the applicable subset of:

Introduction · Why it exists · When to use it · When **not** to use it ·
Installation · Project setup · Folder structure · Core concepts · Configuration ·
Important APIs · Lifecycle · Best practices · Do's · Don'ts · Common mistakes ·
Debugging · Testing · Performance · Security · Deployment · Production tips ·
Code examples (beginner → advanced) · Quiz · Cheat sheet · FAQ · References

Every page should answer: _What is it? Why use it? When to use it? When to avoid
it? How does it work? How do I implement, debug, test, optimise and deploy it?
What are the common mistakes? Where do I learn more?_

**Self-contained rule:** the explanation lives on the page. External links belong
under _References_ / _Further reading_ — not mid-sentence as a substitute for
explaining something.

---

## Progress summary

Sections match the eleven top-level groups in `sidebars.ts`, in sidebar order.

| Section              | Pages | ✅  | 🟡  | 📄  |
| -------------------- | ----- | --- | --- | --- |
| Fundamentals         | 9     | 9   | 0   | 0   |
| Developer Tools      | 18    | 18  | 0   | 0   |
| Frontend             | 15    | 15  | 0   | 0   |
| Backend              | 4     | 4   | 0   | 0   |
| Databases            | 6     | 6   | 0   | 0   |
| APIs                 | 7     | 7   | 0   | 0   |
| Architecture         | 8     | 8   | 0   | 0   |
| Security             | 10    | 10  | 0   | 0   |
| Web Essentials       | 6     | 6   | 0   | 0   |
| Hosting & Deployment | 13    | 13  | 0   | 0   |
| Operations           | 10    | 10  | 0   | 0   |
| **Total**            | 106   | 106 | 0   | 0   |

A page counts as ✅ only when it meets the page standard above — self-contained
explanation, do's and don'ts, common mistakes, debugging, quizzes and references
— and has been checked against current releases. Anything added later starts at
❌ and moves through the same bar.

**Tracking format.** Each section below carries a checklist, per-page notes on
what the page actually covers, a list of remaining improvements, and a
_Verified against_ line recording which versions and specifications the content
was checked against. Update the _Verified against_ line whenever a section is
revisited — it is what tells the next reader whether the page has gone stale.

---

## Fundamentals

**Status: complete (9/9)** · Last updated: 2026-08-03

- [x] How Code Runs
- [x] Data Representation
- [x] Concurrency & Async
- [x] Complexity & Cost
- [x] Idempotency & State
- [x] Designing for Change
- [x] Versioning & Configuration
- [x] DOM
- [x] Testing

**Notes**

The single **General Concepts** page was split into seven topic pages on
2026-08-03, and the combined page removed. It had grown to 739 lines covering
seven unrelated subjects, which made it undiscoverable in the sidebar and
impossible to link to precisely. Each successor is a standalone guide with its
own quizzes; the seven files live in `knowledge-base/general/`, so URLs are
`/knowledge-base/general/<topic>`.

- **How Code Runs** — interpreters vs AOT vs JIT and why a function speeds up
  after a few thousand calls, **transpilation with the erased-types
  consequence** (a type assertion is not validation), CommonJS vs ESM and why
  static analysis is the whole difference, bundling, tree shaking with its three
  breakers, minification and source maps.
- **Data Representation** — code points vs code units vs grapheme clusters with
  the `Intl.Segmenter` fix, Unicode normalisation as the cause of
  identical-looking distinct strings, IEEE-754 and money, timezones vs offsets
  and `Temporal`, and a table of what JSON silently loses.
- **Concurrency & Async** — the four conflated terms, the event loop with
  microtask draining, CPU-bound work and where to move it, `Promise`
  combinators with bounded concurrency, and **race conditions in
  single-threaded code**, since every `await` is a suspension point.
- **Complexity & Cost** — Big-O framed as "notice the nested loop over growing
  data", the N+1 problem with three fixes, the latency table, and a measuring
  section that puts counting queries first.
- **Idempotency & State** — idempotency keys with the point that **the client
  must generate them**, purity and the functional-core/imperative-shell
  pattern, immutability including the React identity consequence, and
  statelessness with its five disguises.
- **Designing for Change** — coupling forms including control coupling via
  boolean parameters, the rule of three and why a wrong abstraction costs more
  than duplication, exceptions vs result values with `cause` preservation, and
  naming as design work.
- **Versioning & Configuration** — SemVer ranges as statements of trust, **the
  lockfile as what actually pins the graph**, what counts as breaking (broader
  than people assume), startup configuration validation, secrets with the
  rotate-don't-delete rule, and feature-flag lifetimes.
- **DOM** — rewritten from three short sections into a complete guide: the
  bytes-to-pixels pipeline, node types, attributes vs properties, live vs static
  collections, script loading (`defer`/`module`), selection and mutation APIs,
  the full event model (phases, `AbortController` cleanup, delegation,
  `preventDefault` vs `stopPropagation`), `DocumentFragment`, `<template>`,
  Shadow DOM, the four observers, `moveBefore()`, `<dialog>`/popover, layout
  thrashing, XSS sinks and the Sanitizer API, jsdom testing, and a DevTools
  debugging table. Five quizzes.
- **Testing** — restructured from a glossary into a strategy guide: pyramid vs
  trophy, test doubles, Vitest 4 + Playwright setup, `node:test` in Node 24,
  AAA structure, Testing Library query priority, MSW, fake timers,
  Testcontainers integration tests, supertest, E2E with auth reuse, snapshot and
  property-based testing, coverage as a discovery tool, a debugging table, and a
  CI workflow. The original terminology is retained and expanded under
  _Terminology_. Five quizzes.

**Remaining improvements**

- No cheat-sheet block on any Fundamentals page.
- HTTP fundamentals have no page; the topic is referenced from Concurrency and
  APIs but never explained from first principles.
- The seven split pages still live under the `general/` directory, so URLs read
  `/knowledge-base/general/how-code-runs`. Renaming the directory would give
  cleaner URLs at the cost of breaking existing links.

**Verified against** — Node 24 (`node:test` stable, auto-awaited subtests),
Vitest 4.1.x (Browser Mode stable), Playwright 1.62, Jest 30, HTML Sanitizer API
(Firefox 148 / Chrome 146, not yet Baseline), `Node.prototype.moveBefore()`
(Chrome 133+).

## Developer Tools

**Status: complete (18/18)** · Last updated: 2026-08-02

### Git — complete

- [x] Introduction (`index.md`)
- [x] Key Concepts
- [x] Commands
- [x] Best Practices
- [x] Common Mistakes

**Notes**

- **Introduction** — rebuilt as an orientation and setup page: distributed VCS
  rationale, the snapshots-not-diffs correction, installation per platform, a
  recommended global config block (`pull.rebase`, `rerere`, `zdiff3`,
  `push.autoSetupRemote`, safe force-push alias), `.gitattributes` line endings,
  `includeIf` per-directory identities, SSH auth, a first-repository
  walkthrough, and a _Where Git is going_ section covering the SHA-256 and
  reftable transitions planned for Git 3.0.
- **Key Concepts** — rewritten around the model rather than the vocabulary: the
  four object types with real `cat-file` output, content addressing and its
  three consequences, refs as pointers, HEAD and detached HEAD,
  remote-tracking branches, the three trees with diff/reset tables derived from
  them, the DAG and ancestry syntax, merge vs rebase with diagrams, conflicts
  and `zdiff3`, reflog, stash, tags, submodules vs subtrees vs packages, hooks
  (including config-based hooks new in 2.54), and packfile storage.
- **Commands** — reorganised from an alphabetical list into task sections, with
  the `switch`/`restore` migration table up front. Adds `add -p`, three-dot
  diff, `log -S`, `blame -w -C`, `--fixup`/`--autosquash`, `bisect run`,
  worktrees, `check-ignore -v`, an undo decision table and a cheat sheet.
- **Best Practices** — commit granularity and message anatomy, Conventional
  Commits, branch naming, a four-way branching-strategy comparison recommending
  GitHub Flow (with the argument against defaulting to Git Flow), merge-strategy
  selection, PR sizing, branch protection, `.gitignore`/`.gitattributes` rules,
  Git LFS, tags and releases, a hook-versus-CI placement table, secret
  prevention, SSH commit signing, and maintenance for large repositories.
- **Common Mistakes** — restructured as a recovery playbook. Leads with the
  committed-vs-uncommitted asymmetry, then groups mistakes by phase (committing,
  secrets and large files, remotes, merging/rebasing, losing uncommitted work,
  cross-platform), each with cause, recovery and prevention. Ends with a
  scannable symptom-to-command table.

Five quizzes per page, each with per-option explanations and a `reference`
anchor. The four sub-topics the roadmap previously listed as separate pages
(_Branching Strategies_, _Rebase vs Merge_, _Recovering Mistakes_, _Hooks & CI_)
were folded into these five rather than added to the sidebar — see _Remaining
improvements_ if they outgrow their hosts.

**Remaining improvements**

- No cheat-sheet block on Key Concepts or Best Practices (Commands has one).
- If _Recovering Mistakes_ or _Branching Strategies_ grow further, split them
  into their own pages and add sidebar entries.
- `git history` (experimental, new in 2.54) is not covered; revisit when it
  stabilises.

**Verified against** — Git 2.54 (April 2026): config-based hooks, geometric
repacking by default, experimental `git history`. Git 3.0 breaking changes taken
from the official `BreakingChanges` document — SHA-256 default, reftable
default, `main` default, `safe.bareRepository=explicit`, removal of
`whatchanged`/grafts, and the explicit decision _not_ to deprecate
`git checkout`.

### npm — complete

- [x] Introduction (`index.md`)
- [x] Key Concepts
- [x] Commands
- [x] Best Practices
- [x] Common Mistakes

**Notes**

- **Introduction** — installation via a version manager, `engines` /
  `packageManager` / `.nvmrc` pinning, a recommended `.npmrc`, and a comparison
  table of npm vs pnpm vs Yarn vs Bun with a recommendation. Opens with an
  explicit supply-chain warning, because npm's defaults are convenient rather
  than safe.
- **Key Concepts** — `package.json` field by field (including `exports`,
  `files`, `sideEffects`, `private`), the five dependency types with the
  "does it execute in the deployed artefact?" test, `peerDependencies` and the
  wide-range rule, SemVer ranges including the pre-1.0 caret behaviour,
  resolution and hoisting with **phantom dependencies** explained, the lockfile
  and its integrity hashes, an `install` vs `ci` table, scripts and lifecycle
  hooks, workspaces, and the registry (scopes, dist-tags, the unpublish policy).
- **Commands** — task-oriented, covering `npm explain`, `npm query` selectors,
  `overrides`, `npm pkg set`, `npm sbom`, and a full OIDC trusted-publishing
  workflow. Includes a cheat sheet, a debugging table and a mistakes section.
- **Best Practices** — dependency hygiene (check the platform first), lockfile
  discipline, conventional script names, a substantial security section ordered
  by value, publishing checklist, CI workflow and a cached multi-stage
  Dockerfile.
- **Common Mistakes** — grouped by lockfile/install, dependency declaration,
  security, and script/environment, each with cause, symptom and fix, plus a
  symptom-to-cause debugging table.

**Verified against** — npm 11.13.0 (April 2026, bundled with Node 24). Security
material verified against npm's published timeline: classic tokens permanently
revoked 9 December 2025, granular tokens capped at 90 days, OIDC trusted
publishing as the recommended path, and the 20 May 2026 change requiring
trusted-publisher configurations to select allowed actions explicitly.

### Composer — complete

- [x] Introduction (`index.md`)
- [x] Key Concepts
- [x] Commands

**Notes**

- **Introduction** — installation, a full annotated `composer.json`, the
  `config.platform` / `allow-plugins` / `prefer-stable` settings that matter,
  the Packagist and PSR ecosystem, and Composer 2.9's automatic security
  blocking.
- **Key Concepts** — platform packages (Composer's genuine advantage over npm),
  a constraints table that **flags `~3.9` behaving differently from npm**,
  stability levels and per-constraint flags, the lockfile with an
  `install` vs `update` table, PSR-4 with the casing trap that only fails on
  Linux, classmap/files autoloading, autoloader optimisation levels, scripts and
  events, and the four repository types.
- **Commands** — task-oriented, including `depends` / `prohibits`,
  `outdated --direct`, `check-platform-reqs`, `composer repo` (2.9+), autoloader
  dump variants, a production deploy flag table and a multi-stage Dockerfile
  that explains why `--no-autoloader` belongs in the first stage.

Five quizzes per page throughout.

**Remaining improvements**

- Composer has no _Best Practices_ or _Common Mistakes_ page; the material is
  currently folded into the three existing pages. Add them if the sections
  outgrow their hosts.
- No cheat sheet on the npm or Composer key-concepts pages.

**Verified against** — Composer 2.10.2, with 2.9 features noted (automatic
security blocking, `composer repo`). PHP 8.4/8.5 baseline.

### Containers, remote access and the other package managers — complete

- [x] Docker
- [x] Docker Compose
- [x] SSH
- [x] pnpm
- [x] Yarn

**Notes**

- **Docker** — replaced the outline with a full guide: the container-vs-VM
  distinction, images/layers/containers with the additive-layer consequence
  (why `RUN rm` does not remove a secret), registries and digest pinning, the
  build context, Dockerfile instructions with the exec-form/shell-form signal
  trap, cache ordering, a complete multi-stage build using
  `RUN --mount=type=cache`, base-image comparison, volumes vs bind mounts vs
  tmpfs, user-defined network DNS, layout/size/runtime performance, a security
  section (non-root, `--cap-drop`, BuildKit secrets, SBOM/provenance
  attestations), an exit-code debugging table, and maintenance.
- **Docker Compose** — a full annotated `compose.yaml`, `depends_on` conditions
  including `service_completed_successfully` for migrations, the
  `.env`-vs-`env_file` distinction, override files and `docker compose config`,
  profiles, YAML anchors, `docker compose watch`, `exec` vs `run`, CI with
  `--wait`, a production section, and where Compose stops being appropriate.
- **SSH** — the two-way authentication model with a sequence diagram, key types
  (DSA removed in OpenSSH 10), `ssh-agent`, a complete `~/.ssh/config` covering
  `IdentitiesOnly`, `ControlMaster` and `ProxyJump`, `known_hosts` handling,
  local/remote/dynamic forwarding, an `sshd` hardening block with the
  keep-a-second-session warning, `authorized_keys` restrictions, why agent
  forwarding is worse than `ProxyJump`, and a debugging table.
- **pnpm** — the content-addressable store and store v11, strict resolution and
  phantom dependencies, the pnpm 11 configuration move out of `.npmrc`,
  workspaces with filtering and catalogs, and the new supply-chain defaults.
- **Yarn** — the Classic/Berry split as the first thing to establish, PnP and
  its compatibility cost, zero-installs, Corepack and `packageManager`, editor
  SDKs, workspaces with `foreach`, constraints, the resolution protocols
  including `patch:`, and a staged migration path.

**Verified against** — Docker Engine 29.7.1 (July 2026; containerd image store
default, legacy builder removed, Content Trust removed from the CLI, cgroup v1
deprecated) and Compose v2.40; OpenSSH 10.4 (July 2026; DSA removed in 10.0,
hybrid ML-KEM key exchange default, experimental ML-DSA signatures);
pnpm 11 (April 2026; Node 22+, pure ESM, `minimumReleaseAge` default 1440,
`blockExoticSubdeps` default on, `allowBuilds`, `.npmrc` reduced to
auth/registry); Yarn 4.11 (no Yarn 5 exists).

**Remaining improvements**

- No cheat-sheet block on Docker, Compose or SSH.
- Docker Compose and Docker could each justify a separate _Common Mistakes_
  page if their sections grow further.
- Kubernetes is still absent from the handbook entirely; see _Newly identified
  topics_.

## Frontend

**Status: complete (15/15)** · Last updated: 2026-08-03

### React

- [x] Introduction (`index.md`)
- [x] Component Design
- [x] State Management _(done in an earlier cycle)_
- [x] Best Practices
- [x] Common Mistakes

### Next.js

- [x] Introduction (`index.md`)
- [x] Folder Structure
- [x] Rendering & SSR _(earlier cycle)_
- [x] API Routes → Route Handlers
- [x] SEO
- [x] Best Practices _(earlier cycle)_
- [x] Common Misconceptions _(earlier cycle)_
- [x] Common Mistakes

### Mobile

- [x] React Native
- [x] Flutter

**Notes**

- **React — Introduction** rebuilt as the section's mental model: UI as a
  function of state, render vs reconcile vs commit, the two state rules
  (batching and identity), purity and why Strict Mode double-renders, keys, a
  full hook table, `useEffect` misuse, the React 19 additions (`ref` as a prop,
  Actions, `use()`, metadata hoisting) and React Compiler 1.0.
- **Component Design** was the 13-line page flagged as the top priority; now a
  full guide — when to split (and when not), composition over configuration,
  slots, discriminated-union props, controlled vs uncontrolled with the mode
  switch trap, custom hooks, compound components, error boundaries, patterns
  that have aged out (HOCs, render props, `forwardRef`, PropTypes) and feature
  folders.
- **React Best Practices** rewritten. It previously opened "At rtCamp, we
  adhere…" — a leftover from another organisation — and covered only three
  generic topics. Now: structure, data fetching, state, performance, forms,
  accessibility, testing, security and tooling.
- **React Common Mistakes** kept its strong existing content, with two code
  bugs corrected (`Math.random` missing its call parentheses in two places, and
  `setInterval(fn, [1000])` passing an array as the delay), a framing
  introduction, a note that Effect fetching is largely superseded, and five
  quizzes.
- **Next.js — Introduction** rebuilt around _what changed in v16_, then the
  App Router, Server vs Client Components, rendering strategies, Cache
  Components and Server Actions, with a security callout that a Server Action
  is a public endpoint.
- **Folder Structure** replaced a Medium-article-sourced tree with the actual
  conventions: special files, the `layout` vs `template` distinction, dynamic
  segments, route groups, private folders, colocation, parallel and
  intercepting routes, segment config, then a scalable project layout. The old
  page recommended `containers/`, a Redux-era split that no longer maps to
  anything.
- **API Routes** rewritten as Route Handlers: the Pages/App comparison,
  `await params`, request reading, validation, auth, webhook signature
  verification against the raw body, caching, streaming, CORS, `proxy.ts`, and
  a Route-Handler-vs-Server-Action decision table.
- **SEO** expanded from an outline to a full guide, and **corrected**: it
  recommended `rel="next"`/`rel="prev"` for pagination, which Google
  [stopped using as an indexing signal in 2019](https://developers.google.com/search/blog/2019/03/rel-next-prev).
  Adds `metadataBase`, `generateMetadata`, dynamic OG images with
  `ImageResponse`, `sitemap.ts`/`robots.ts`, canonical rules, JSON-LD and Core
  Web Vitals.
- **Next.js Common Mistakes** kept its existing content (all still accurate for
  the App Router), plus two new entries — async request APIs, and treating a
  Server Action as private — and five quizzes.
- **React Native** and **Flutter** written from outline to full guides, each
  covering architecture, setup, navigation, state, performance, testing,
  release and debugging.

**Remaining improvements**

- No cheat-sheet block on any Frontend page.
- The React sub-topics the roadmap previously listed as separate pages (Hooks
  reference, Server Components, Actions, Refs, Context & Performance, Suspense,
  Testing React) are covered within the five existing pages rather than split
  out. Same for the Next.js extras (Caching, Server Actions, `proxy.ts`,
  Turbopack, Deployment). Split them into their own pages, with sidebar
  entries, if they outgrow their hosts.
- Flutter and React Native have no dedicated Best Practices or Common Mistakes
  pages; that material is folded into the single page each.

**Verified against** — React 19.2.8 (July 2026; note the _React2Shell_
vulnerability affecting 19.0.0–19.2.0, fixed in 19.2.1), React Compiler 1.0
(October 2025), Next.js 16.2.11 Active LTS with 15.5.21 Maintenance LTS and
16.3 still canary, Vercel's monthly security release programme (July 2026
release patched 9 CVEs), React Native 0.86 / Expo SDK 57 (June 2026) with the
New Architecture mandatory since 0.82, and Flutter 3.44 with Dart 3.12 (Google
I/O 2026).

## Backend

**Status: complete (4/4)** · Last updated: 2026-08-03

- [x] Express
- [x] Laravel
- [x] FastAPI
- [x] WordPress

**Notes**

- **Express** — the middleware pipeline and its three rules, routing including
  the `path-to-regexp` v8 change that makes bare `*` routes silently stop
  matching, the Express 5 automatic async error propagation (and the
  four-parameter error-handler requirement), Zod validation at the edge, a
  layered structure whose central rule is that services never import `express`,
  security defaults Express does not ship, `supertest` testing, a production
  Dockerfile with graceful shutdown, and an Express/Fastify/Hono comparison.
- **Laravel** — request lifecycle, the service container, routing and route
  model binding, Eloquent with the N+1 problem treated as the headline issue
  (including `preventLazyLoading`), Form Requests, Gates and Policies, queues
  and idempotent jobs, scheduling, testing with Pest and factories, a
  performance order-of-operations, and the `env()`-after-`config:cache` trap.
- **FastAPI** — type hints as the single source of validation, response
  filtering and OpenAPI; parameter inference; dependency injection including
  `yield` cleanup and `dependency_overrides`; a substantial **async
  correctness** section (the `async def` + blocking call failure mode, and the
  three-way decision between `async def`, plain `def` and a queue); project
  layout keeping Pydantic schemas separate from ORM models; `lifespan`;
  security; testing; and deployment with `uv`.
- **WordPress** — hooks (with the missing-`return` filter trap), the template
  hierarchy, the Loop and `wp_reset_postdata()`, the six core tables and why
  `wp_postmeta` does not scale, block themes and `theme.json`, custom blocks,
  the REST API with mandatory `permission_callback`, headless trade-offs,
  Composer-managed installs, the five-part security rule (escape, sanitise,
  nonce, capability, prepare), and a performance section led by page caching.

Five quizzes per page.

**Remaining improvements**

- No cheat-sheet block on any Backend page.
- Each framework has a single page rather than the multi-page treatment Git,
  npm and React received. Split into Key Concepts / Best Practices / Common
  Mistakes if any outgrows its host.
- WooCommerce is not covered; it was part of the removed Courses section and
  has no sidebar entry.

**Verified against** — Express 5.2.1 (5.2 shipped December 2025; Express 4 in
support wind-down, Express 3 EOL), Laravel 13 (17 March 2026, PHP 8.3+),
FastAPI 0.141.1 (July 2026) with Pydantic v2 and Python 3.10+, and WordPress
7.0 "Armstrong" (20 May 2026, minimum PHP 7.4 — the page recommends 8.2+
because 7.4 is EOL upstream).

## Databases

**Status: complete (6/6)** · Last updated: 2026-08-03

- [x] Data Modelling
- [x] PostgreSQL
- [x] MySQL
- [x] SQLite
- [x] MongoDB
- [x] Redis

**Notes**

- **Data Modelling** — written first because the engine pages reference it:
  normal forms and deliberate denormalisation, natural vs surrogate keys, the
  UUIDv4-fragments-B-trees problem and UUIDv7/ULID as the fix, foreign keys,
  indexes (leftmost prefix, covering, what silently disables one), ACID and
  isolation levels with the check-then-act race, the N+1 problem, zero-downtime
  migrations step by step, and connection pooling arithmetic.
- **PostgreSQL** — the type system as a correctness tool (`timestamptz` always,
  `text` not `varchar(n)`), constraints including exclusion constraints, the
  five index types, reading `EXPLAIN (ANALYZE, BUFFERS)`, **MVCC and vacuum**
  including the long-transaction-blocks-vacuum failure, JSONB with the
  "promote it to a column if you filter on it" rule, configuration led by
  `random_page_cost = 1.1` on SSDs, a `pg_stat_statements` performance
  workflow, backups, and row-level security for multi-tenancy.
- **MySQL** — InnoDB's clustered index and its three consequences, the
  **`utf8` is not UTF-8** trap, `DATETIME` vs `TIMESTAMP`, strict mode,
  MySQL-specific index features (prefix, functional, descending, **invisible**),
  reading the `type` column in EXPLAIN, REPEATABLE READ and gap locks with
  deadlock retry, replication and read-after-write lag, and backups with
  `--single-transaction`.
- **SQLite** — the one-writer concurrency model and WAL, `busy_timeout` as the
  fix for "database is locked", type affinity and `STRICT` tables, foreign keys
  being **off by default per connection**, transaction batching (100× on bulk
  inserts), the features people do not expect (window functions, FTS5, JSON,
  UPSERT), safe backups and Litestream, when it is a legitimate production
  choice, and why testing on SQLite while deploying on Postgres is a trap.
- **MongoDB** — leads by correcting the "schemaless, no modelling needed"
  reputation; embed vs reference with the 16 MB limit as a design signal,
  extended references, JSON Schema validation, the **ESR rule** for compound
  indexes, aggregation pipeline ordering, transactions as a signal of wrong
  document boundaries, sharding key choice, and operator injection.
- **Redis** — single-threaded execution and why `KEYS *` is an outage, the six
  data types with the sorted set treated as the standout, cache-aside with the
  three failure modes (stampede, penetration, avalanche), atomic rate limiting
  via Lua, distributed locks with the three rules **and** an explicit warning
  that a Redis lock is not a correctness guarantee, eviction policies (the
  `noeviction` default surprise), persistence, cluster hash tags, pipelining,
  and security.

Five quizzes per page.

**Remaining improvements**

- No cheat-sheet block on any Databases page.
- No dedicated page for Elasticsearch or vector search; `pgvector` is mentioned
  on the PostgreSQL page only.
- Redis Streams are covered briefly; deeper queue material lives under
  Operations.

**Verified against** — PostgreSQL 18 (September 2025: async I/O, native
`uuidv7()`, virtual generated columns, B-tree skip scans, statistics preserved
across major upgrades), MySQL 9.7 LTS (July 2026, with the parallel calendar-
versioned Innovation track noted), SQLite 3.46+, MongoDB 8.2 (December 2025),
and Redis 8 / Valkey — including the 2024 licence change and the Linux
Foundation fork.

## APIs

**Status: complete (7/7)** · Last updated: 2026-08-03

- [x] REST
- [x] GraphQL
- [x] OpenAPI
- [x] Pagination
- [x] Webhooks
- [x] WebSockets
- [x] Server-Sent Events

**Notes**

- **REST** written first, since several existing pages link to it. Resources and
  URI conventions, method semantics with the safe/idempotent table, idempotency
  keys, a status-code section organised around the pairs teams confuse
  (401/403, 403/404, 400/422), RFC 9457 Problem Details, collections,
  versioning with an explicit is/is-not-breaking list, HTTP caching including
  `ETag` optimistic concurrency, and security led by per-object authorisation.
  States plainly that what the industry calls REST is resource-oriented HTTP,
  and that this is fine.
- **GraphQL** — leads with the honest ten-year assessment: the durable
  justification is **federation**, not over-fetching. Schema design for clients
  rather than tables, non-null propagation as a trap, resolvers, **DataLoader
  as mandatory** (with the per-request and key-order rules), security (depth vs
  complexity limits, persisted queries as a prerequisite, introspection),
  the **caching regression from REST**, and federation with its real costs.
- **OpenAPI** — a full annotated 3.2 document, design-first vs code-first with a
  recommendation, what an accurate description generates (typed clients, mocks,
  contract tests, request validation), and **governance** via Spectral rulesets
  plus `oasdiff` breaking-change checks in CI. Flags the 3.0 → 3.1 JSON Schema
  alignment (`nullable` removed) as the version boundary that matters.
- **Pagination** — the two defects of offset (linear degradation with depth, and
  duplicate/skipped rows under concurrent writes), cursor pagination with the
  **mandatory unique tie-break** and tuple comparison, cursor encoding and
  signing, a decision table, API conventions, and a section arguing against
  computing exact totals by reflex.
- **Webhooks** — covers both receiving and sending. Signature verification with
  the three details that are each a real vulnerability when omitted (raw body,
  signed timestamp, constant-time compare), respond-fast/process-async,
  idempotency on the provider's event id, not trusting payload contents,
  correct status codes, and — for senders — retries with jitter, ordering
  guarantees, and **SSRF protection on customer-supplied URLs**.
- **WebSockets** — the handshake, reconnection with backoff and jitter as the
  client's responsibility, heartbeats, authenticating at upgrade and
  authorising every message, **scaling (process-local connections, backplane,
  connection limits)**, message design, and security led by Cross-Site
  WebSocket Hijacking, since the same-origin policy does not apply.
- **Server-Sent Events** — the wire format and the two framing traps, automatic
  reconnection with `Last-Event-ID` replay, the `EventSource` header limitation
  and the `fetch` alternative, the HTTP/1.1 six-connection limit, a server
  implementation with the four required headers (including
  `X-Accel-Buffering: no`), LLM token streaming, and scaling including why
  thread-per-request servers cannot hold streams.

Five quizzes per page. The three real-time pages each carry the same decision
table from their own perspective, so a reader arriving at any one of them gets
the SSE-vs-WebSockets-vs-polling answer.

**Remaining improvements**

- No cheat-sheet block on any APIs page.
- gRPC is not covered and has no sidebar entry; it is mentioned only as an
  alternative on the REST page.
- No dedicated HTTP fundamentals page — status codes and caching are covered
  within REST. See _Newly identified topics_.

**Verified against** — OpenAPI 3.2.0 (September 2025: hierarchical tags,
first-class SSE/JSON Lines streaming, custom methods, OAuth device flow; no
breaking changes from 3.1), with **Moonwalk 4.0 still in design and no release
date** — the OpenAPI Initiative's own guidance is to use 3.x. RFC 9110 for HTTP
semantics, RFC 9457 for Problem Details, RFC 6455 for WebSockets, and the WHATWG
HTML Standard for SSE. GraphQL guidance reflects the current consensus that
persisted queries are a prerequisite rather than an optimisation.

## Architecture

**Status: complete (8/8)** · Last updated: 2026-08-03

- [x] MVC
- [x] Clean Architecture
- [x] SOLID Principles
- [x] Design Patterns
- [x] Dependency Injection
- [x] Monoliths
- [x] Microservices
- [x] Event-Driven

**Notes**

These pages are deliberately less prescriptive than the technology sections —
each states the trade-off and the conditions under which the idea pays, rather
than presenting it as a default.

- **MVC** — what each layer owns, why controllers bloat and the extraction order
  (validation → authorisation → business logic → data access → side effects),
  the service layer whose defining rule is that it never imports HTTP types,
  repositories including when they are not worth it over an active-record ORM, a
  framework comparison table noting Django's MTV naming, and MVVM/MVP/Flux.
  Ends on the single best diagnostic: if testing your business logic needs an
  HTTP request, it is in the wrong layer.
- **Clean Architecture** — the dependency rule, the four layers, a worked
  example where the **inner layer owns the port interface**, the composition
  root, and a substantial and deliberately unflattering **cost section**: more
  files, mapping fatigue, lost framework leverage, harder onboarding. Recommends
  a pragmatic middle path (service layer plus interfaces at external boundaries)
  for most applications.
- **SOLID** — each principle with its common misapplication, plus a
  _Where SOLID is weakest_ section noting that several principles predate
  first-class functions and that the set says nothing about data modelling,
  concurrency or operability. Includes a signal → principle → fix table.
- **Design Patterns** — the ones still worth knowing, a table of patterns
  **modern languages have absorbed** (Strategy is a function, Command is a
  closure, Visitor is pattern matching), architectural patterns including
  Outbox and Circuit Breaker, and an explicit warning about Singleton as global
  mutable state with a respectable name.
- **Dependency Injection** — the three forms, the composition root, the
  **service-locator anti-pattern**, manual wiring vs containers with a
  comparison table, **lifetimes including the singleton-capturing-scoped-state
  data leak**, what is and is not worth injecting (the clock and randomness are
  the commonly missed ones), and functional DI via plain function arguments.
- **Monoliths** — reclaims the term: a deployment topology, not a quality
  level. The modular monolith with **mechanically enforced boundaries** (lint
  rules and per-module database schemas), scaling including the under-used
  "same artefact, different process roles" technique, honest limits led by
  organisational scale, and a five-step extraction procedure.
- **Microservices** — states plainly that the problem solved is organisational.
  Boundaries by bounded context rather than technical layer, data ownership and
  its consequences, **sagas with compensating actions**, sync vs async
  communication, the dual-write problem and Outbox, resilience (timeouts,
  circuit breakers, bulkheads), observability as a prerequisite, and a full
  inventory of the operational cost.
- **Event-Driven** — events vs commands, event design and thin-vs-fat payloads,
  **delivery guarantees with the statement that exactly-once does not exist**
  end to end, ordering within a partition key, DLQs, the dual-write problem, a
  transport comparison flagging the **Redis Pub/Sub fire-and-forget trap**,
  Event Sourcing and CQRS as separate and optional, and the debugging cost.

Five quizzes per page. Monoliths and Microservices are written as two halves of
one decision and cross-link accordingly; the dual-write/Outbox problem appears
in Design Patterns, Microservices and Event-Driven from three angles.

**Remaining improvements**

- No cheat-sheet block on any Architecture page.
- No dedicated Domain-Driven Design page; bounded contexts are covered only
  where microservice boundaries are discussed.
- CQRS and Event Sourcing are summarised within Event-Driven rather than having
  their own pages. Split if they outgrow it.

**Verified against** — these are largely version-independent. Primary sources
used: the Gang of Four catalogue, Fowler's PoEAA and bliki, Cockburn on
Hexagonal Architecture, Martin's Clean Architecture article, Richardson's
microservices.io pattern catalogue, Newman's _Building Microservices_, Evans on
DDD, and Kleppmann on delivery guarantees.

## Security

**Status: complete (10/10)** · Last updated: 2026-08-03

- [x] Authentication
- [x] Authorization
- [x] Sessions & Cookies
- [x] JWT
- [x] OAuth 2.1 & OIDC
- [x] CORS
- [x] XSS
- [x] CSRF
- [x] SQL Injection
- [x] Security Checklist

**Notes**

The most cross-referenced section in the handbook — REST, WordPress, Express,
FastAPI, MongoDB, Laravel, the DOM page and several others link into it, and
those links now resolve to full content.

- **Authentication** — opens by recommending that most teams **do not build
  this**. Argon2id with OWASP parameters, NIST-aligned password policy
  (explicitly reversing composition rules and forced rotation), a login flow
  annotated with the four things that matter (generic errors, constant-ish
  timing, session regeneration, opportunistic rehashing), passkeys as
  phishing-resistant _by construction_, an MFA strength table, and account
  recovery treated as the weakest link.
- **Authorization** — leads with the fact that this is **A01 and usually just
  changing an id in a URL**. RBAC/ABAC/ReBAC, object-level checks, filtering in
  the query rather than after it, row-level security, mass assignment,
  a where-to-put-the-check table, multi-tenancy, and negative tests as the ones
  that matter most.
- **Sessions & Cookies** — the six attributes, `SameSite` values, the
  under-used `__Host-` prefix, server-side vs signed-cookie sessions, and a
  direct argument against `localStorage`: CSRF is fully solvable, XSS token
  exfiltration is not.
- **JWT** — opens with the two facts people miss (signed ≠ encrypted; cannot be
  revoked), then `alg: none`, **algorithm confusion**, missing claim
  validation, JWKS rotation, four revocation strategies, refresh-token rotation
  with reuse detection, and a JWT-or-session table that recommends sessions for
  browsers.
- **OAuth 2.1 & OIDC** — states clearly that **2.1 is still an IETF draft**,
  what it removes (implicit, password grant, wildcard redirects), the
  authorization code flow with PKCE and `state` explained as separate defences,
  ID token validation with `aud` as the critical check, the **BFF pattern**,
  and the confused-deputy attack from using an access token to authenticate.
- **CORS** — leads with the clarification that it restricts **reading**, not
  requests, and is not an access control. Simple vs preflighted, the headers
  including the commonly-missed `Expose-Headers`, the dangerous
  misconfigurations (origin reflection with credentials, substring matching,
  `null`), a debugging table, and the middleware-ordering cause of 401 on
  preflight.
- **XSS** — three types with DOM-based flagged as now the common form, an
  enumerated sink list, context-dependent escaping, framework opt-outs as
  greppable review triggers, sanitising **on output**, nonce-based CSP, and
  Trusted Types.
- **CSRF** — establishes precisely **when CSRF does and does not apply** (bearer
  tokens do not need it), `SameSite` with its four honest gaps, synchroniser
  tokens explained via the same-origin asymmetry, double-submit and why it is
  weaker, and an explicit correction that CORS does not prevent CSRF.
- **SQL Injection** — parameterisation as a complete fix, then the places it
  does not reach: identifiers and sort direction, ORM raw-query escape hatches,
  second-order injection, blind/time-based extraction, and defence in depth.
  Includes the O'Brien apostrophe as the cheapest available injection test.
- **Security Checklist** — organised as the OWASP Top 10:2025 mapped to
  concrete checkboxes, plus headers, secrets, file uploads, pre-launch and
  ongoing sections, and a _Frequently missed_ list ranked by how often each
  appears in real reviews.

Five quizzes per page. CSRF, CORS and Sessions deliberately cross-correct each
other, since the three are the most commonly conflated topics in web security.

**Remaining improvements**

- No cheat-sheet block on any Security page.
- No dedicated pages for SSRF (covered within Authorization and Webhooks) or
  for secrets management (covered within the Checklist and Git).
- Rate limiting is covered across several pages rather than having one home.

**Verified against** — the **OWASP Top 10:2025**, announced November 2025 and
released in final form January 2026. Two new categories (**A03 Software Supply
Chain Failures**, **A10 Mishandling of Exceptional Conditions**), **SSRF folded
into A01**, and Security Misconfiguration moved #5 → #2. Also: OWASP Password
Storage guidance placing **Argon2id first** (19 MiB / 2 iterations minimum),
NIST SP 800-63B password policy, **OAuth 2.1 still at draft-14** and not yet an
RFC, RFC 8725 for JWT best practices, and passkeys/WebAuthn as mainstream with
universal browser support in 2026.

## Web Essentials

**Status: complete (6/6)** · Last updated: 2026-08-03

- [x] Performance
- [x] Accessibility
- [x] SEO
- [x] File Uploads
- [x] Email Systems
- [x] Search

**Notes**

- **Performance** — Core Web Vitals with current thresholds and the
  **FID → INP** change explained (INP measures every interaction through to
  paint, which is why many sites regressed), field-vs-lab data as the
  distinction that decides whether numbers mean anything, the loading pipeline,
  JavaScript as the usual largest lever, images and fonts, caching, rendering,
  backend performance, and a six-step diagnostic workflow ending in a CI budget.
- **Accessibility** — reframed around the **European Accessibility Act being
  enforceable since 28 June 2025**, which makes this a compliance requirement
  for most commercial products. WCAG structure with a note that **EN 301 549
  still references 2.1 AA**, semantic HTML as the highest-leverage practice,
  keyboard access, focus management (including the SPA route-change problem),
  ARIA with "no ARIA is better than bad ARIA", forms, visual design, and testing
  that states plainly that automation catches only 30–40 %.
- **SEO** — the crawl → render → index pipeline, `robots.txt` vs `noindex` and
  why combining them is counterproductive, rendering as the decision that most
  often breaks JavaScript apps, canonicals, structured data, on-page signals,
  migrations, and a section on **AI answer engines** — where the technical
  requirements are unchanged but server rendering matters more, since most AI
  crawlers execute less JavaScript than Googlebot.
- **File Uploads** — leads with pre-signed direct-to-storage uploads as the
  architecture that solves the resource and reliability problems, then
  validation by magic bytes with an allowlist, decompression bombs and Zip Slip,
  storage and serving (**uploaded SVG on your origin is stored XSS**), multipart
  and resumable uploads, asynchronous processing, and the browser side.
- **Email Systems** — SPF/DKIM/DMARC with **alignment** explained as the part
  people miss, the SPF 10-lookup limit that fails silently, the **2024
  Gmail/Yahoo bulk sender requirements**, deliverability and reputation,
  transactional sending via a queue, HTML email constraints (Outlook renders
  with Word's engine), bounce and complaint webhooks, and testing without
  emailing real users.
- **Search** — the four-step progression from `LIKE` to vector search with the
  advice to start at the lowest level that works, Postgres full-text search
  covered properly (including `websearch_to_tsquery` and `pg_trgm`), an engine
  comparison, **keeping the index in sync** as the operational problem that
  makes a dedicated engine more work than expected, relevance and measurement,
  UX, and hybrid vector search.

Five quizzes per page. Performance and SEO cross-link on Core Web Vitals;
File Uploads and XSS cross-link on SVG; Search reuses the dual-write/outbox
material from Event-Driven.

**Remaining improvements**

- No cheat-sheet block on any Web Essentials page.
- Internationalisation and localisation have no page; `hreflang` is covered
  under SEO only.
- Analytics and privacy (cookie consent, GDPR) are not covered.

**Verified against** — Core Web Vitals thresholds current for 2026 (LCP ≤ 2.5 s,
INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile), **INP having replaced FID in
March 2024**; WCAG 2.2 published October 2023 with **EN 301 549 not yet updated,
so 2.1 AA remains the EAA benchmark**; the **EAA enforceable from 28 June 2025**
with member-state penalties; and the Gmail/Yahoo bulk sender requirements in
force since 2024.

## Hosting & Deployment

**Status: complete (13/13)** · Last updated: 2026-08-03

- [x] DNS
- [x] SSL/TLS
- [x] Nginx
- [x] Reverse Proxy
- [x] CDN
- [x] Cloudflare
- [x] VPS
- [x] AWS
- [x] DigitalOcean
- [x] Hetzner
- [x] cPanel
- [x] CI/CD
- [x] GitHub Actions

**Notes**

- **DNS** — resolution walked end to end, record types with the CNAME-at-apex
  problem and the ALIAS/ANAME workaround, TTL as the thing that decides how long
  a mistake lasts, propagation reframed as cache expiry rather than
  distribution, and `dig` as the diagnostic tool.
- **SSL/TLS** — framed around **shrinking certificate lifetimes making
  automation mandatory**: the CA/Browser Forum schedule of 200 days from March
  2026, 100 days in 2027 and 47 days by 2029, with Let's Encrypt already issuing
  6-day certificates. Handshake, chain of trust, ACME, TLS 1.3, HSTS with the
  preload warning, and OCSP stapling.
- **Nginx** — configuration model and the `location` matching order that causes
  most surprises, static serving, proxying, TLS, compression, rate limiting, and
  a debugging table anchored on `nginx -t` and the error log.
- **Reverse Proxy** — what the pattern buys, forwarded headers and **why
  trusting them unconditionally is a spoofable identity**, buffering, timeouts,
  WebSocket upgrade, health checks and load-balancing strategies.
- **CDN** — cache headers with `s-maxage` as the control that matters, cache
  keys and the `Vary: Cookie` hit-rate destroyer, invalidation by content
  hashing and cache tags, a dedicated section on **publicly caching
  authenticated responses**, provider comparison including egress pricing, and
  edge-compute constraints.
- **Cloudflare** — organised around the orange cloud, since proxied-vs-DNS-only
  explains nearly every support question. **Flexible SSL called out as
  dangerous** (padlock with a plaintext origin leg, plus redirect loops),
  protecting the origin IP, Cache Rules and `CF-Cache-Status`, WAF and Bot Fight
  Mode caveats, Workers and storage, `CF-Connecting-IP`, and a table of settings
  that break applications.
- **VPS** — the first-hour setup in order, with the two classic lockouts
  (disabling passwords before testing keys; enabling `ufw` before allowing SSH)
  called out at the point they occur. systemd with hardening directives, sizing
  where **memory not CPU is what runs out**, backups off the machine, deployment
  patterns, and monitoring.
- **AWS** — leads with IAM and cost as the two things that actually hurt.
  Roles and OIDC over long-lived keys, EC2/Lambda/Fargate trade-offs including
  **Lambda exhausting RDS connections**, S3 behind CloudFront with OAC rather
  than public buckets, RDS configuration, the `us-east-1` certificate
  requirement, and a table of where the money goes.
- **DigitalOcean** — positioned as predictable pricing and a comprehensible
  surface. Droplet types and steal time as the signal to move off shared CPU,
  managed databases with **trusted sources not configured by default**,
  transaction-vs-session pooling, Spaces, App Platform, and the doubled
  firewall.
- **Hetzner** — the price advantage stated plainly and the trade named: **no
  managed data services**. Instance lines including Arm64, dedicated servers and
  their rebuild window, private networks, Storage Box for backups, Terraform,
  and a cost comparison table.
- **cPanel** — written for the reality that developers inherit cPanel sites.
  The addon-domain duplicate-content trap, the three-step database creation
  people stop after two of, the inode limit presenting as a false "disk full",
  AutoSSL, PHP INI settings, cron as the substitute for workers, and `chmod 777`
  as a shared-hosting hazard specifically.
- **CI/CD** — build once and promote one artefact, fast pipelines, flaky tests
  and why blanket retries are worse than the flake, environments and secrets,
  deployment strategies with the note that **a canary without metrics is just a
  slower deploy**, expand–contract migrations, rollback, and pipeline security.
- **GitHub Actions** — the GitHub-specific implementation of the CI/CD page.
  Cache key mechanics, matrices, environments, **OIDC as the highest-value
  security change**, reusable workflows, and a security section covering SHA
  pinning, `pull_request_target`, and script injection through `github.event`.

Five quizzes per page. DNS, SSL/TLS, Nginx, Reverse Proxy, CDN and Cloudflare
form a chain from name resolution to the edge; VPS is the operational base that
Hetzner and DigitalOcean both reference; CI/CD and GitHub Actions are a
concept/implementation pair.

**Remaining improvements**

- No cheat-sheet block on any Hosting page.
- Docker-based deployment is referenced but not covered here — it lives under
  Developer Tools.
- Kubernetes, Terraform and infrastructure-as-code have no page; IaC is
  mentioned under AWS only.
- Vercel, Netlify, Fly.io and Railway are named in comparisons but have no
  coverage of their own.
- No page on load balancing or horizontal scaling as a topic in its own right.

**Verified against** — the CA/Browser Forum certificate-lifetime schedule (200
days from March 2026, 100 days 2027, 47 days 2029) and Let's Encrypt's 6-day
certificate option; current official action majors `actions/checkout@v7`,
`actions/setup-node@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`; and
**GitHub runners defaulting to Node 24 since 16 June 2026**, with Node 20
action majors now emitting deprecation warnings.

## Operations

**Status: complete (10/10)** · Last updated: 2026-08-03

- [x] Logging
- [x] Monitoring
- [x] Observability
- [x] OpenTelemetry
- [x] Prometheus
- [x] Grafana
- [x] Caching
- [x] Queues
- [x] Background Workers
- [x] Apache Kafka

**Notes**

- **Logging** — structure as the thing that separates useful logs from useless
  ones, field conventions, levels with the rule that **`error` means a human
  should look**, correlation via `AsyncLocalStorage` and W3C Trace Context,
  redaction configured at the logger rather than the call site, GDPR retention,
  stdout and aggregation, and cost. Includes the `JSON.stringify(err)` → `{}`
  trap that silently costs teams every stack trace.
- **Monitoring** — organised around **alert on symptoms, not causes**. Golden
  signals with the warning that mixing failed requests into latency makes it
  _improve_ during an outage, metric types, SLOs with an error-budget table,
  burn-rate alerting, what to monitor in priority order (external uptime check
  first, business metrics fourth), dashboards and on-call sustainability.
- **Observability** — the unknown-unknowns framing and the "which users?" test,
  the three signals linked rather than collected separately, **cardinality as
  the concept that decides cost and capability** (dangerous in metrics,
  essential in traces and logs), distributed tracing with head vs tail sampling,
  instrumenting a service, and a repeatable incident sequence.
- **OpenTelemetry** — API/SDK/Collector split, auto-instrumentation with the
  **load-before-the-app** rule that is the most common setup mistake, manual
  spans, semantic conventions **including the `http.method` → `http.request.method`
  and `db.system` → `db.system.name` renames** that make older examples wrong,
  context propagation through queues, Collector pipelines with processor
  ordering, and `parentbased` samplers.
- **Prometheus** — pull model and the dimensional data model as the two
  decisions that shape everything, exposition and naming, **cardinality with the
  note that series are not freed when they stop being written**, PromQL rules
  (`rate` before `sum`, keep `le`, never `irate` in alerts), recording and
  alerting rules including `predict_linear`, Alertmanager grouping and
  inhibition, and storage.
- **Grafana** — one dashboard per question, data source correlations, panels
  with **heatmaps as the underused answer to bimodal latency**, chained
  variables and `$__rate_interval`, incident dashboards with deploy annotations,
  Grafana vs Prometheus alerting, provisioning as code, and the LGTM stack with
  Alloy replacing the end-of-life Grafana Agent.
- **Caching** — leads with **not caching around a missing index**, layers and
  debugging top-down, cache-aside as the default, three invalidation strategies
  with delete-don't-update explained by the race it avoids, cache stampede with
  locking/SWR/jitter, key design where **a key missing the identity dimension is
  a data leak**, Redis `maxmemory` and `KEYS`, and hit-ratio interpretation.
- **Queues** — what a queue buys and what it costs (**failure moves somewhere
  nobody is looking**), acknowledgement and visibility timeouts, delivery
  semantics stating plainly that end-to-end exactly-once does not exist,
  idempotency patterns, backoff and DLQs, ordering by partition key, broker
  comparison, and **the dual-write problem with the transactional outbox**.
- **Background Workers** — the operational half of queues: supervision with a
  systemd template unit, graceful shutdown and `TimeoutStopSec`, concurrency
  matched to workload type (**CPU-bound at high concurrency in Node is actively
  harmful**), scheduled jobs with distributed locks and dead-man's-switch
  monitoring, deploy ordering with message-schema compatibility, and heartbeat
  metrics.
- **Apache Kafka** — the log-not-a-queue distinction driving the whole page, a
  comparison table against queues, partitions and consumer groups, producing
  with `acks`/idempotence, consuming with offset commits and the
  `max.poll.interval.ms` rebalance loop, retention and compaction, schema
  registry compatibility modes, and a direct **"when not to use Kafka"**
  section.

Five quizzes per page. Logging → Observability → OpenTelemetry is a chain;
Monitoring → Prometheus → Grafana is another; Queues → Background Workers →
Kafka is the third. Caching cross-links to CDN for the edge layer.

**Remaining improvements**

- No cheat-sheet block on any Operations page.
- Incident response and post-mortem practice are touched on under Monitoring but
  have no page of their own.
- Feature flags are referenced from CI/CD and Monitoring but not covered
  directly.
- Kubernetes-specific operations (probes, HPA, resource limits) are absent.
- RabbitMQ has no page; it appears only in the broker comparison.

**Verified against** — **Kafka 4.3.1 (25 June 2026)** as the current line, with
ZooKeeper removed entirely in 4.0 (March 2025) making KRaft the only mode, the
KIP-848 consumer group protocol stable since 4.0, and **Queues for Kafka
(KIP-932) still in preview** since 4.1; OpenTelemetry semantic conventions
current for HTTP and database attribute names; and Grafana Alloy having replaced
the end-of-life Grafana Agent.

## Newly identified topics

Worth adding, beyond the original brief:

- **Vite** — now the default build tool for non-framework React apps.
- **Bun** — runtime, package manager, and test runner.
- **Turborepo / Monorepos** — workspace tooling and task orchestration.
- **Kubernetes** and **Terraform** — infrastructure beyond single VPS hosting.
- **RabbitMQ** and **Elasticsearch** — queueing and search alternatives.
- **TypeScript** — deserves a first-class section; it underpins most others.
- **HTTP fundamentals** — methods, status codes, headers, caching semantics.
  Many security and API topics assume this knowledge.
- **Regular expressions** — small, high-leverage reference page.
- **Licensing** — practical open-source licence guidance for developers.

---

## Working notes

- **Quizzes** use the global `<Quiz>` component (`src/components/Quiz`),
  registered in `src/theme/MDXComponents.tsx`. No import needed in MDX. It
  supports single-answer and multi-select, per-option explanations for wrong
  answers, and an optional handbook reference link.
- **Sidebar is defined explicitly** in `sidebars.ts`, not generated from the
  filesystem. This allows grouping by domain without moving directories and
  changing URLs, and lets pages be ordered pedagogically rather than
  alphabetically. **Adding a page means adding a line to `sidebars.ts`** — it
  will not appear automatically, and Docusaurus will warn about any doc missing
  from the sidebar.
- **The eleven sections are top-level**, not nested under a single "Knowledge
  Base" parent — a parent containing every page adds indentation without adding
  information. They are ordered along the life of a project: know (Fundamentals,
  Developer Tools), build (Frontend, Backend, Databases, APIs), design
  (Architecture, Security, Web Essentials), ship and run (Hosting & Deployment,
  Operations).
- Because grouping is independent of the filesystem, a topic's directory and its
  section can differ: `knowledge-base/redis/` appears under Databases,
  `knowledge-base/kafka/` under Operations, `knowledge-base/cloudflare/` under
  Hosting & Deployment. Directories are not renamed, because they are the URL.
- Each section uses a `generated-index` landing page (`/knowledge-base/frontend`,
  `/knowledge-base/security`, and so on), which renders a card list automatically
  from its children. `/knowledge-base` itself is a hand-written map of the
  sections — update it only when a section is added or renamed.
- **Broken links and anchors fail the build** (`onBrokenLinks: 'throw'`,
  `onBrokenAnchors: 'throw'`), so cross-links and every `#heading` reference in a
  quiz are verified automatically. Run `npm run clear` before a verification
  build — webpack caching can make a rebuild look like it passed without
  reprocessing changed pages.
- **Page conventions established with the Fundamentals section**, to be followed
  by every page from here: an `## Introduction` explaining what/why/where; the
  standard sections that apply to the topic; a `### Do` / `### Don't` pair; a
  `## Common Mistakes` section in prose; a debugging table keyed by symptom; a
  `## FAQ`; three to five quizzes under `## Check your understanding`, rising in
  difficulty and each carrying a `reference` link; and a `## References` list of
  primary sources only. Quiz `reference` anchors must match a real heading slug
  on the target page.
- **Next.js content is the most version-sensitive.** Next.js 16 removed
  synchronous request APIs, renamed `middleware` → `proxy`, removed `next lint`
  and runtime config, and made Turbopack the default. Any Next.js page written
  before October 2025 should be assumed stale until re-verified.
- **React 19** made `ref` a regular prop; `forwardRef` is legacy. Existing React
  pages avoid `forwardRef` entirely, so no correction was needed there.

## Order of work

Working through the sidebar top to bottom, so that later pages can cross-link
into earlier ones rather than forward-referencing outlines.

1. ~~**Fundamentals** — the seven concept pages, DOM, Testing.~~ Done 2026-08-02; General Concepts split into seven pages 2026-08-03.
2. ~~**Developer Tools** — Git (5), npm (5), Composer (3), Docker, Docker
   Compose, SSH, pnpm, Yarn.~~ Done 2026-08-02.
3. **Frontend** — expand React _Component Design_ (still 13 lines), re-verify
   the remaining Next.js pages against v16 (`api-routes` → Route Handlers,
   `folder-structure`, `seo`), then React Native and Flutter.
4. **Backend** — Express 5, Laravel, FastAPI, WordPress.
5. **Databases** — Data Modelling first, since the engine pages reference it.
6. **APIs** — REST before the rest; several other sections link to it.
7. **Architecture**, then **Security** (highest value per page, mostly
   framework-agnostic), then **Web Essentials**.
8. **Hosting & Deployment**, then **Operations**.

Out-of-band, whenever a page is touched: backfill quizzes on any existing page
that lacks them, and add the cheat-sheet block the page standard calls for.
