---
title: "Docker Compose"
description: "Defining and running multi-container applications — services, health-gated startup, environment overrides, profiles, watch mode and where Compose stops being appropriate."
---

# Docker Compose

## Introduction

Compose describes a set of services — application, database, cache, queue — in a
single YAML file, so the whole stack starts with one command.

**The problem it solves** is onboarding and parity. Without it, "run the project
locally" means a README with fourteen steps, a Postgres version that drifts from
production, and a new developer losing a day. With it, `docker compose up` gives
everyone the same stack, and the file is reviewed in pull requests like any other
code.

Compose is also the natural stopping point for a lot of production deployments.
A single server running four services behind a reverse proxy does not need
Kubernetes, and Compose handles it perfectly well.

:::note Compose v2
`docker compose` (a Go plugin, invoked with a **space**) replaced the Python
`docker-compose` v1, which is end-of-life. This page is written against
**Compose v2.40**. The `version:` key at the top of the file is obsolete — v2
ignores it and warns.
:::

---

## Core Concepts

A Compose file declares four kinds of thing:

- **Services** — containers to run, and how to build or pull them.
- **Networks** — how services reach each other. One default network is created
  automatically, and every service joins it.
- **Volumes** — named storage that survives `docker compose down`.
- **Configs and secrets** — files injected into containers.

**Service names are hostnames.** On the default network, Docker's embedded DNS
resolves `db`, `redis` and `api` to the right container. This is why Compose
files rarely mention IP addresses.

**A project namespaces everything.** By default the project name is the
directory name, and it prefixes container, network and volume names. Two clones
of the same repository in differently named directories run side by side without
colliding — and, less happily, renaming the directory orphans your volumes. Pin
it explicitly:

```yaml
name: acme-storefront
```

---

## A Complete Example

```yaml title="compose.yaml"
name: acme-storefront

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: development # stop at the dev stage of a multi-stage build
    ports:
      - '3000:3000'
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://app:secret@db:5432/app
      REDIS_URL: redis://cache:6379
    env_file:
      - .env
    volumes:
      - .:/app # live source
      - /app/node_modules # keep the image's node_modules
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    restart: unless-stopped
    develop:
      watch:
        - action: sync
          path: ./src
          target: /app/src
        - action: rebuild
          path: package.json

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app -d app']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    # No ports: — reachable from `api`, not from the internet.

  cache:
    image: redis:8-alpine
    command: ['redis-server', '--save', '60', '1', '--loglevel', 'warning']
    volumes:
      - redisdata:/data

  worker:
    build: .
    command: ['node', 'dist/worker.js']
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
    depends_on:
      db:
        condition: service_healthy
    profiles: [full] # only starts with --profile full

volumes:
  pgdata:
  redisdata:
```

Bring it up:

```bash
docker compose up -d          # start in the background
docker compose logs -f api    # follow one service
docker compose ps             # what is running, and health status
docker compose down           # stop and remove containers and networks
docker compose down -v        # ⚠️ also delete named volumes — destroys the database
```

---

## Startup Ordering and Health

`depends_on` in its short form only controls _start order_, not readiness. A
container being "started" says nothing about whether Postgres has finished
initialising, so your API cheerfully connects to a database that is not
listening yet.

The long form with `condition: service_healthy` waits for the health check to
pass:

```yaml
db:
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U app -d app']
    interval: 5s
    timeout: 3s
    retries: 10
    start_period: 10s

api:
  depends_on:
    db:
      condition: service_healthy
```

Conditions available:

| Condition                        | Waits until                                  |
| -------------------------------- | -------------------------------------------- |
| `service_started`                | The container has started (the weak default) |
| `service_healthy`                | Its health check passes                      |
| `service_completed_successfully` | It ran and exited 0 — ideal for migrations   |

That last one is how to run migrations before the application starts:

```yaml
migrate:
  build: .
  command: ['npm', 'run', 'migrate']
  depends_on:
    db:
      condition: service_healthy

api:
  depends_on:
    migrate:
      condition: service_completed_successfully
```

**Even with health gating, applications should retry their connections.**
Compose ordering does not exist in production, and a database can restart at any
time. Health checks make local startup reliable; retry logic makes the
application correct.

---

## Configuration and Environments

### Variable substitution

Compose interpolates `${VAR}` from the shell environment and from a `.env` file
sitting next to the Compose file:

```yaml
services:
  api:
    image: myapp:${TAG:-latest} # default if unset
    ports:
      - '${API_PORT:?API_PORT is required}' # fail fast if missing
```

```ini title=".env — gitignored"
TAG=1.4.0
API_PORT=3000
POSTGRES_PASSWORD=local-dev-only
```

Two different things share the name "env" and are worth separating clearly:

- **`.env` next to `compose.yaml`** is read by Compose itself, for substitution
  into the YAML.
- **`env_file:`** lists files passed into the _container_ as environment
  variables.

They are not the same file, and confusing them produces variables that are
mysteriously empty in one place and present in the other.

### Overrides per environment

`compose.override.yaml` is merged automatically on top of `compose.yaml` when
present. The convention is a base file with what is common, and overrides per
environment:

```yaml title="compose.yaml — shared"
services:
  api:
    image: myrepo/api:${TAG:-latest}
    restart: unless-stopped
```

```yaml title="compose.override.yaml — local development, auto-loaded"
services:
  api:
    build: .
    ports: ['3000:3000']
    volumes: ['.:/app', '/app/node_modules']
    environment:
      NODE_ENV: development
```

```yaml title="compose.prod.yaml — explicit"
services:
  api:
    deploy:
      resources:
        limits: {cpus: '2', memory: 1g}
    logging:
      driver: json-file
      options: {max-size: '10m', max-file: '3'}
```

```bash
docker compose up                                     # base + override
docker compose -f compose.yaml -f compose.prod.yaml up -d
docker compose -f compose.yaml -f compose.prod.yaml config   # print the merged result
```

`docker compose config` is the debugging tool for this: it prints the fully
merged, fully interpolated file, which settles most "why is that value not
applied?" questions immediately.

### Profiles

Profiles keep optional services out of the default `up`:

```yaml
services:
  worker:
    profiles: [full]
  mailhog:
    profiles: [full, debug]
```

```bash
docker compose up                      # core services only
docker compose --profile full up       # plus worker and mailhog
```

Useful for keeping the everyday startup light while still describing the whole
stack in one file.

### Reusing configuration

YAML anchors avoid repeating blocks:

```yaml
x-app-common: &app-common
  build: .
  env_file: [.env]
  depends_on:
    db: {condition: service_healthy}
  restart: unless-stopped

services:
  api:
    <<: *app-common
    command: ['node', 'dist/server.js']
    ports: ['3000:3000']

  worker:
    <<: *app-common
    command: ['node', 'dist/worker.js']
```

Compose also supports `extends` and, since v2, `include` for composing several
Compose files across repositories.

---

## Development Workflow

### Watch mode

`docker compose watch` is the modern alternative to bind-mounting your whole
source tree. It syncs changed files into the container and can rebuild when
dependencies change:

```yaml
develop:
  watch:
    - action: sync # copy the file in; no restart
      path: ./src
      target: /app/src
      ignore: ['**/*.test.ts']
    - action: sync+restart # copy in, then restart the service
      path: ./config
      target: /app/config
    - action: rebuild # rebuild the image entirely
      path: package.json
```

```bash
docker compose watch
```

It is noticeably faster than bind mounts on macOS and Windows, where every
filesystem event crosses a VM boundary, and it avoids the `node_modules`
shadowing problem entirely.

### Everyday commands

```bash
docker compose up -d --build          # rebuild images, then start
docker compose up --force-recreate    # recreate containers even if unchanged
docker compose restart api
docker compose stop                   # stop without removing
docker compose down --remove-orphans  # tidy up containers from removed services

docker compose logs -f --tail=100 api
docker compose exec api sh            # shell in a running service
docker compose run --rm api npm test  # one-off container, then discard
docker compose ps
docker compose top
docker compose config                 # merged, interpolated configuration
docker compose pull                   # refresh images
```

**`exec` vs `run`.** `exec` enters an already-running container; `run` starts a
new one from the same service definition. Use `run --rm` for one-off tasks such
as tests, migrations or a REPL — and note that `run` does not publish ports
unless you add `--service-ports`.

---

## Compose in CI

Compose is a convenient way to bring up real dependencies for integration tests:

```yaml title=".github/workflows/test.yml"
- name: Start dependencies
  run: docker compose -f compose.yaml -f compose.ci.yaml up -d --wait

- name: Run tests
  run: docker compose run --rm api npm run test:integration

- name: Dump logs on failure
  if: failure()
  run: docker compose logs

- name: Tear down
  if: always()
  run: docker compose down -v
```

`--wait` is the flag that makes this reliable: it blocks until every service
with a health check reports healthy, so tests do not start against a database
that is still initialising. Without it you get intermittent CI failures that
look like flaky tests.

For test dependencies driven from _inside_ the test suite,
[Testcontainers](/knowledge-base/testing#integration-tests-against-a-real-database)
is often a better fit — the lifecycle is owned by the tests rather than by the
pipeline.

---

## Production

Compose is a reasonable production tool on a single host. What to change from
your development file:

```yaml
services:
  api:
    image: myrepo/api:1.4.0 # a pinned tag or digest — never `build:` in production
    restart: unless-stopped
    deploy:
      resources:
        limits: {cpus: '2', memory: 1g}
    logging:
      driver: json-file
      options: {max-size: '10m', max-file: '3'}
    healthcheck:
      test: ['CMD', 'node', 'healthcheck.js']
      interval: 30s
    secrets: [db_password]

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

- **Never `build:` on the production host.** Build in CI, push to a registry,
  pull a pinned tag.
- **Set `restart: unless-stopped`** so services survive a reboot.
- **Cap the logs.** The default `json-file` driver is unbounded, and filling the
  disk with logs is a classic single-host outage.
- **Use `secrets`** rather than `environment` for credentials — environment
  variables appear in `docker inspect` and in crash dumps.
- **Set resource limits**, or one runaway service takes down the host.

### Where Compose stops being appropriate

Move to an orchestrator when you need:

- **More than one host** — Compose has no scheduler.
- **Zero-downtime rolling deploys** — `up` recreates containers with a gap.
- **Autoscaling** on load.
- **Self-healing across node failure.**

Until then, Compose on one well-sized server is dramatically simpler than
Kubernetes, and the complexity saving is real. See
[Microservices](/knowledge-base/architecture/microservices) for the wider
trade-off.

---

## Debugging

| Symptom                                       | Cause and fix                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| API cannot reach the database                 | Using `localhost`. Use the service name (`db`) — inside a container localhost is itself.                                            |
| Service starts before its dependency is ready | `depends_on` short form only orders starts. Add a health check and `condition: service_healthy`.                                    |
| Environment variable is empty                 | Confusing Compose's `.env` (substitution into YAML) with `env_file:` (into the container). `docker compose config` shows the truth. |
| Changes to code are not picked up             | The image was rebuilt but the container was not recreated: `up -d --build`. Or use `docker compose watch`.                          |
| Database is empty after `down`                | `down -v` deletes named volumes. Without `-v` the data survives.                                                                    |
| Volumes vanished after renaming the folder    | The project name defaults to the directory name and namespaces volumes. Set `name:` explicitly.                                     |
| `port is already allocated`                   | Another process or an older project holds the host port. `docker compose down --remove-orphans`.                                    |
| Orphan containers warning                     | A service was removed from the file. `--remove-orphans`.                                                                            |
| `node_modules` disappears in the container    | A bind mount over `/app` shadows it. Add the anonymous `/app/node_modules` volume.                                                  |
| Works locally, fails in CI                    | Missing `--wait`, so tests started before dependencies were healthy.                                                                |

```bash
docker compose config              # merged and interpolated — start here
docker compose ps                  # status and health of every service
docker compose logs --tail=200
docker compose exec api env        # what the container actually received
docker compose events              # live stream of lifecycle events
```

---

## Do's and Don'ts

### Do

- Set an explicit `name:` so volumes survive a directory rename.
- Gate startup with health checks and `condition: service_healthy`.
- Keep databases off the host network — omit `ports:` entirely.
- Use named volumes for data, and understand that `down -v` destroys them.
- Use `docker compose config` to debug merges and interpolation.
- Use `--wait` in CI.
- Pin image tags in production and build in CI.
- Cap log size in production.

### Don't

- Don't use the obsolete `version:` key.
- Don't rely on `depends_on` alone for readiness.
- Don't put secrets in `environment:` in production.
- Don't run `docker compose down -v` casually — it deletes your local database.
- Don't build images on the production host.
- Don't reach for Kubernetes for a single-host deployment.
- Don't use `docker-compose` (hyphenated); it is end-of-life.

---

## FAQ

**`compose.yaml` or `docker-compose.yml`?**
`compose.yaml` is the current preferred name. Both are recognised; Compose
checks `compose.yaml` first.

**Why is there no `version:` key any more?**
It described the v1 file-format schema. Compose v2 ignores it and warns; delete
it.

**How do I scale a service?**
`docker compose up --scale worker=3`. It works for stateless workers, but there
is no load balancing for published ports — that is where an orchestrator starts
to earn its keep.

**Can Compose deploy to multiple hosts?**
Not on its own. Docker Swarm reads Compose files and can; realistically, the
choice at that point is between Swarm and Kubernetes.

**How do I connect from the host to a Compose database?**
Publish the port (`5432:5432`) in your override file only. Keep it out of the
production file.

**Should development and production share one Compose file?**
Share a base and layer overrides. Trying to serve both from one file with
conditionals produces something nobody can read.

---

## Check your understanding

<Quiz
question="Your API service intermittently crashes on startup with 'connection refused' to Postgres, even though `depends_on: [db]` is set. Why?"
options={[
{
text: 'The short form of depends_on only orders container starts; it does not wait for Postgres to finish initialising',
correct: true,
why: 'A container is "started" as soon as its process launches. Postgres takes seconds more to accept connections. Add a healthcheck and depends_on with condition: service_healthy.',
},
{
text: 'The services are on different networks',
why: 'Then it would fail every time with a DNS error, not intermittently with connection refused.',
},
{
text: 'Postgres needs its port published for the API to reach it',
why: 'Publishing exposes a port to the host. Container-to-container traffic on the shared network does not need it.',
},
{
text: 'restart: unless-stopped is missing',
why: 'A restart policy would mask the race by retrying, but it does not address the ordering problem.',
},
]}
explanation={<>Health gating fixes local startup. The application should <em>also</em> retry its connection, because Compose ordering does not exist in production and databases restart.</>}
reference={{label: 'Startup ordering and health', href: '/knowledge-base/docker-compose#startup-ordering-and-health'}}
/>

<Quiz
question="A developer renames the project directory and finds the local database empty. What happened?"
options={[
{
text: 'The project name defaults to the directory name and namespaces volumes, so Compose created new, empty volumes',
correct: true,
why: 'Volumes are prefixed with the project name. Renaming the directory changes the prefix, so the old volume is orphaned rather than deleted — the data still exists under the old name.',
},
{
text: 'docker compose down deleted the volumes',
why: 'down removes containers and networks. Only down -v removes named volumes.',
},
{
text: 'Named volumes are always recreated on every up',
why: 'Named volumes persist across up and down precisely so data survives.',
},
{
text: 'The database image was updated to a new major version',
why: 'That would produce an incompatible-data-directory error, not a silently empty database.',
},
]}
explanation={<>Set <code>name:</code> at the top of the Compose file. The old data is recoverable — <code>docker volume ls</code> shows the volume under the previous prefix.</>}
reference={{label: 'Core concepts', href: '/knowledge-base/docker-compose#core-concepts'}}
/>

<Quiz
question="Which changes are appropriate when moving a Compose file from development to a single production host?"
type="multiple"
options={[
{text: 'Replace `build:` with a pinned image tag from a registry', correct: true, why: 'Production should run an artefact that CI built and tested, not one compiled on the server from whatever is on disk.'},
{text: 'Add restart: unless-stopped', correct: true, why: 'Services must come back after a crash or a host reboot.'},
{text: 'Cap log size with the json-file driver options', correct: true, why: 'The default is unbounded. Filling the disk with logs is a classic single-host outage.'},
{text: 'Move credentials from environment: to secrets:', correct: true, why: 'Environment variables are visible in docker inspect and in crash dumps.'},
{text: 'Bind-mount the source directory so hotfixes can be applied live', why: 'That makes the running code diverge from the image, which is untraceable and unreproducible. Build, push, redeploy.'},
]}
explanation={<>The through-line is that production runs a fixed, reviewed artefact. Anything that lets the running system drift from what CI built belongs in development only.</>}
reference={{label: 'Production', href: '/knowledge-base/docker-compose#production'}}
/>

<Quiz
question="An environment variable set in your `.env` file is empty inside the container. What is the most likely explanation?"
options={[
{
text: 'The `.env` beside compose.yaml is used for substituting ${VAR} into the YAML; it is not automatically passed into containers unless referenced or listed via env_file',
correct: true,
why: 'The two mechanisms are separate: Compose-level interpolation and container-level environment. Confusing them is the most common Compose configuration bug.',
},
{
text: 'Compose does not support .env files',
why: 'It does — it reads .env next to the Compose file automatically for interpolation.',
},
{
text: 'The variable name must be uppercase',
why: 'Convention, not a requirement, and unrelated to whether the value reaches the container.',
},
{
text: 'Variables only apply after docker compose down',
why: 'They apply when a container is created; recreating is enough.',
},
]}
explanation={<><code>docker compose config</code> prints the fully merged and interpolated configuration, and <code>docker compose exec api env</code> shows what the container actually received. Between them they settle this in seconds.</>}
reference={{label: 'Variable substitution', href: '/knowledge-base/docker-compose#variable-substitution'}}
/>

<Quiz
question="Integration tests in CI fail roughly one run in five with database connection errors. The pipeline runs `docker compose up -d` then immediately runs the tests. What is the fix?"
options={[
{
text: 'Use `docker compose up -d --wait` so the command blocks until every service with a health check is healthy',
correct: true,
why: '--wait is exactly this: it returns only once health checks pass, removing the race between startup and the test run.',
},
{
text: 'Add a sleep 30 before running the tests',
why: 'Slower than needed on fast runs and still too short on slow ones. Wait for a condition, not a duration.',
},
{
text: 'Retry the whole CI job on failure',
why: 'Hides the race and doubles CI time, while also masking genuine intermittent product bugs.',
},
{
text: 'Run the tests inside the same container as the database',
why: 'Couples unrelated concerns and does not address readiness at all.',
},
]}
explanation={<>The same reasoning as the <code>depends_on</code> question, one level up: wait for a health signal, never for a duration.</>}
reference={{label: 'Compose in CI', href: '/knowledge-base/docker-compose#compose-in-ci'}}
/>

---

## References

- [Docker Compose documentation](https://docs.docker.com/compose/) — the
  authoritative guide.
- [Compose file reference](https://docs.docker.com/reference/compose-file/) —
  every key, including `develop.watch`, `profiles` and `include`.
- [Compose CLI reference](https://docs.docker.com/reference/cli/docker/compose/)
  — commands and flags, including `--wait`.
- [Compose Specification](https://github.com/compose-spec/compose-spec) — the
  open specification Compose v2 implements.
- [Docker](/knowledge-base/docker) — images, layers and the Dockerfile these
  services are built from.
