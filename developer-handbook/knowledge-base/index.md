---
id: knowledge-base
title: All Topics
description: Every topic in the handbook on one page — a hundred guides covering fundamentals, tools, frontend, backend, databases, APIs, architecture, security, hosting and operations.
sidebar_position: 2
---

# All Topics

Every guide in the handbook, listed individually. Sections follow the life of a
project: what you need to know, what you build with, how you design it, and how
you ship and run it.

Section names link to an overview page; everything else links straight to the
guide.

## [Fundamentals](/knowledge-base/fundamentals)

- **[How Code Runs](/knowledge-base/general/how-code-runs)** — interpreters,
  JIT, transpilation, module systems, bundling and tree shaking.
- **[Data Representation](/knowledge-base/general/data-representation)** —
  Unicode, IEEE-754, timezones, and the serialisation limits that lose data.
- **[Concurrency & Async](/knowledge-base/general/concurrency)** — the event
  loop, microtask ordering, CPU-bound work and single-threaded races.
- **[Complexity & Cost](/knowledge-base/general/complexity-and-cost)** — Big-O
  in practice, the N+1 problem, and the latency numbers worth knowing.
- **[Idempotency & State](/knowledge-base/general/idempotency-and-state)** —
  what makes code safe to retry, test and scale horizontally.
- **[Designing for Change](/knowledge-base/general/designing-for-change)** —
  coupling, when not to abstract, error handling and naming.
- **[Versioning & Configuration](/knowledge-base/general/versioning-and-configuration)**
  — SemVer, lockfiles, environment config, secrets and feature flags.
- **[DOM](/knowledge-base/dom)** — how the browser turns HTML into a tree you
  can query, mutate and observe, and how to do it without wrecking performance.
- **[Testing](/knowledge-base/testing)** — what to test, at which level, with
  which tool, and the habits that keep a suite fast and trustworthy.

## [Developer Tools](/knowledge-base/developer-tools)

- **[Git](/knowledge-base/git)** — the object model, branching, and recovering
  from mistakes.
  · [Key Concepts](/knowledge-base/git/key-concepts)
  · [Commands](/knowledge-base/git/git-commands)
  · [Best Practices](/knowledge-base/git/best-practices)
  · [Common Mistakes](/knowledge-base/git/common-mistakes)
- **[npm](/knowledge-base/npm)** — registries, lockfiles, semver ranges and
  dependency hygiene.
  · [Key Concepts](/knowledge-base/npm/key-concepts)
  · [Commands](/knowledge-base/npm/npm-commands)
  · [Best Practices](/knowledge-base/npm/best-practices)
  · [Common Mistakes](/knowledge-base/npm/common-mistakes)
- **[pnpm](/knowledge-base/pnpm)** — the content-addressed store, strict
  resolution, and workspaces.
- **[Yarn](/knowledge-base/yarn)** — Berry, Plug'n'Play, and when the classic
  line still applies.
- **[Composer](/knowledge-base/composer)** — PHP dependency management and
  autoloading.
  · [Key Concepts](/knowledge-base/composer/key-concepts)
  · [Commands](/knowledge-base/composer/composer-commands)
- **[Docker](/knowledge-base/docker)** — images, layers, multi-stage builds and
  container security.
- **[Docker Compose](/knowledge-base/docker-compose)** — multi-service local
  environments and their production limits.
- **[SSH](/knowledge-base/ssh)** — keys, agents, config, tunnels and hardening.

## [Frontend](/knowledge-base/frontend)

- **[React](/knowledge-base/react-js)** — React 19, the Compiler, and the mental
  model behind rendering.
  · [Component Design](/knowledge-base/react-js/component-design)
  · [State Management](/knowledge-base/react-js/state-management)
  · [Best Practices](/knowledge-base/react-js/best-practices)
  · [Common Mistakes](/knowledge-base/react-js/common-mistakes)
- **[Next.js](/knowledge-base/next-js)** — the App Router, Server Components and
  the caching model.
  · [Folder Structure](/knowledge-base/next-js/folder-structure)
  · [Rendering & SSR](/knowledge-base/next-js/server-side-rendering)
  · [API Routes](/knowledge-base/next-js/api-routes)
  · [SEO](/knowledge-base/next-js/seo)
  · [Best Practices](/knowledge-base/next-js/best-practices)
  · [Common Misconceptions](/knowledge-base/next-js/common-misconceptions)
  · [Common Mistakes](/knowledge-base/next-js/common-mistakes)
- **[React Native](/knowledge-base/react-native)** — the New Architecture,
  navigation and platform differences.
- **[Flutter](/knowledge-base/flutter)** — widgets, state management and the
  rendering pipeline.

## [Backend](/knowledge-base/backend)

- **[Express](/knowledge-base/express)** — middleware, routing, error handling
  and what changed in Express 5.
- **[Laravel](/knowledge-base/laravel)** — Eloquent, the service container,
  queues and the framework's conventions.
- **[FastAPI](/knowledge-base/fastapi)** — type-driven validation, dependency
  injection and async Python.
- **[WordPress](/knowledge-base/wordpress)** — hooks, the block editor, custom
  types and the security surface.

## [Databases](/knowledge-base/databases)

- **[Data Modelling](/knowledge-base/databases/data-modelling)** —
  normalisation, keys, indexes, transactions, N+1 and migrations.
- **[PostgreSQL](/knowledge-base/databases/postgresql)** — the default choice,
  and the features that justify it.
- **[MySQL](/knowledge-base/databases/mysql)** — InnoDB, replication and where
  it differs from Postgres.
- **[SQLite](/knowledge-base/databases/sqlite)** — an embedded database that is
  production-grade more often than people assume.
- **[MongoDB](/knowledge-base/databases/mongodb)** — document modelling, and the
  schema decisions that decide performance.
- **[Redis](/knowledge-base/redis)** — data structures, persistence, eviction
  and the patterns built on them.

## [APIs](/knowledge-base/apis)

- **[REST APIs](/knowledge-base/apis/rest)** — resources, status codes,
  versioning and idempotency.
- **[GraphQL](/knowledge-base/apis/graphql)** — schemas, resolvers, N+1 and what
  it actually buys you.
- **[OpenAPI](/knowledge-base/apis/openapi)** — specification-first design and
  what you can generate from it.
- **[Pagination](/knowledge-base/apis/pagination)** — offset versus cursor, and
  why offset breaks under writes.
- **[Webhooks](/knowledge-base/apis/webhooks)** — signature verification,
  retries, replay protection and delivery.
- **[WebSockets](/knowledge-base/apis/websockets)** — persistent connections,
  scaling, reconnection and authentication.
- **[Server-Sent Events](/knowledge-base/apis/server-sent-events)** — one-way
  streaming, and when it beats WebSockets.

## [Architecture](/knowledge-base/architecture)

- **[MVC](/knowledge-base/architecture/mvc)** — what the pattern actually says,
  and how frameworks reinterpreted it.
- **[Clean Architecture](/knowledge-base/architecture/clean-architecture)** —
  dependency direction, boundaries and the cost of the indirection.
- **[SOLID Principles](/knowledge-base/architecture/solid)** — the five
  principles, with the misreadings that make them harmful.
- **[Design Patterns](/knowledge-base/architecture/design-patterns)** — the
  patterns that earn their place in application code.
- **[Dependency Injection](/knowledge-base/architecture/dependency-injection)** —
  inversion of control, with and without a container.
- **[Monoliths](/knowledge-base/architecture/monoliths)** — modular monoliths,
  and why topology is not quality.
- **[Microservices](/knowledge-base/architecture/microservices)** — the
  organisational problem they solve, and the distributed one they create.
- **[Event-Driven](/knowledge-base/architecture/event-driven)** — events,
  commands, the outbox pattern and eventual consistency.

## [Security](/knowledge-base/security)

- **[Authentication](/knowledge-base/security/authentication)** — password
  storage, MFA, passkeys and account recovery.
- **[Authorization](/knowledge-base/security/authorization)** — RBAC, ABAC,
  ownership checks and where to enforce them.
- **[Sessions & Cookies](/knowledge-base/security/sessions-and-cookies)** —
  cookie attributes, session lifetime and fixation.
- **[JWT](/knowledge-base/security/jwt)** — what tokens are for, and why they
  cannot be revoked.
- **[OAuth 2.1 & OIDC](/knowledge-base/security/oauth)** — flows, PKCE, and the
  difference between the two specifications.
- **[CORS](/knowledge-base/security/cors)** — what the same-origin policy
  restricts, and what it does not.
- **[XSS](/knowledge-base/security/xss)** — the three types, sinks, CSP and
  sanitisation.
- **[CSRF](/knowledge-base/security/csrf)** — tokens, `SameSite`, and where each
  is sufficient.
- **[SQL Injection](/knowledge-base/security/sql-injection)** — parameterisation,
  and the places ORMs still leave open.
- **[Checklist](/knowledge-base/security/checklist)** — an OWASP-aligned review
  pass for a real application.

## [Web Essentials](/knowledge-base/web)

- **[Performance](/knowledge-base/web/performance)** — Core Web Vitals, the
  loading pipeline, and a diagnostic workflow.
- **[Accessibility](/knowledge-base/web/accessibility)** — WCAG, semantic HTML,
  keyboard access and the European Accessibility Act.
- **[SEO](/knowledge-base/web/seo)** — crawling, rendering, indexing, canonicals
  and AI answer engines.
- **[File Uploads](/knowledge-base/web/file-uploads)** — pre-signed uploads,
  validation by magic bytes, and storage safety.
- **[Email Systems](/knowledge-base/web/email)** — SPF, DKIM, DMARC alignment,
  deliverability and transactional sending.
- **[Search](/knowledge-base/web/search)** — from `LIKE` to full-text to vector
  search, and keeping an index in sync.

## [Hosting & Deployment](/knowledge-base/hosting)

- **[DNS](/knowledge-base/hosting/dns)** — record types, TTL, and propagation as
  cache expiry.
- **[SSL/TLS](/knowledge-base/hosting/ssl-tls)** — the handshake, ACME, HSTS and
  shrinking certificate lifetimes.
- **[Nginx](/knowledge-base/hosting/nginx)** — configuration, `location`
  matching, proxying and rate limiting.
- **[Reverse Proxy](/knowledge-base/hosting/reverse-proxy)** — forwarded
  headers, buffering, timeouts and load balancing.
- **[CDN](/knowledge-base/hosting/cdn)** — cache keys, invalidation, edge
  compute, and the mistake that leaks data.
- **[Cloudflare](/knowledge-base/cloudflare)** — proxy modes, SSL modes, cache
  rules, WAF and Workers.
- **[VPS](/knowledge-base/hosting/vps)** — first-hour hardening, systemd,
  sizing, backups and deployment.
- **[AWS](/knowledge-base/hosting/aws)** — IAM, EC2, Lambda, S3, RDS,
  CloudFront, and where the money goes.
- **[DigitalOcean](/knowledge-base/hosting/digitalocean)** — Droplets, managed
  databases, Spaces and App Platform.
- **[Hetzner](/knowledge-base/hosting/hetzner)** — cloud and dedicated servers,
  and what you take on for the price.
- **[cPanel](/knowledge-base/hosting/cpanel)** — shared hosting constraints,
  databases, mail, AutoSSL and cron.
- **[CI/CD](/knowledge-base/hosting/ci-cd)** — pipelines, artefacts, deployment
  strategies, migrations and rollback.
- **[GitHub Actions](/knowledge-base/hosting/github-actions)** — workflows,
  caching, environments, OIDC and fork security.

## [Operations](/knowledge-base/operations)

- **[Logging](/knowledge-base/operations/logging)** — structure, levels,
  correlation IDs, redaction and retention.
- **[Monitoring](/knowledge-base/operations/monitoring)** — golden signals,
  SLOs, error budgets and alerts people act on.
- **[Observability](/knowledge-base/operations/observability)** — the three
  signals, cardinality and distributed tracing.
- **[OpenTelemetry](/knowledge-base/operations/opentelemetry)** — SDKs, the
  Collector, semantic conventions and sampling.
- **[Prometheus](/knowledge-base/operations/prometheus)** — the data model,
  PromQL, recording rules and Alertmanager.
- **[Grafana](/knowledge-base/operations/grafana)** — dashboards worth keeping,
  alerting, provisioning and the LGTM stack.
- **[Caching](/knowledge-base/operations/caching)** — layers, invalidation,
  stampedes, keys and when not to cache.
- **[Queues](/knowledge-base/operations/queues)** — delivery semantics,
  idempotency, dead-letter queues and the outbox.
- **[Background Workers](/knowledge-base/operations/background-workers)** —
  supervision, graceful shutdown, concurrency and scheduling.
- **[Apache Kafka](/knowledge-base/kafka)** — partitions, consumer groups,
  retention, and when not to use it.

:::tip Looking for one specific answer?
Search with <kbd>Ctrl</kbd> + <kbd>K</kbd> — it indexes the full text of every
page, not just titles.
:::
