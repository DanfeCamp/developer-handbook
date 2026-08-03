---
title: 'PostgreSQL'
description: 'A feature-rich, standards-compliant relational database — types, indexes, EXPLAIN, MVCC and vacuum, JSONB, and production operation.'
---

# PostgreSQL

## Introduction

PostgreSQL is the default choice for a new relational database, and has been for
some years. It is standards-compliant, extremely correct about data, and broad
enough that most applications never need a second store — it handles relational
data, JSON documents, full-text search, geospatial queries, time series and
job queues competently.

**What distinguishes it.** A rich type system that lets the database enforce
things other engines cannot; extensibility, so PostGIS, pgvector and TimescaleDB
are first-class rather than forks; and a planner that is genuinely good, which
means the fastest way to make Postgres fast is usually to give it the right
indexes and let it work.

**When something else fits better.** Extremely high write throughput on a single
table, an embedded or single-file requirement ([SQLite](/knowledge-base/databases/sqlite)),
or a hosting environment where MySQL is what you get.

:::note Version
Written against **PostgreSQL 18** (September 2025), which added an asynchronous
I/O subsystem (2–3× faster sequential scans in cold-cache cases), native
`uuidv7()`, OAuth 2.0 authentication, virtual generated columns, B-tree skip
scans, and statistics that survive a major-version upgrade.
:::

---

## Types Worth Knowing

Postgres's type system is a correctness tool. Using it well removes validation
code.

| Type                                  | Use for                                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| `bigint GENERATED ALWAYS AS IDENTITY` | Surrogate primary keys (the SQL-standard `serial`)           |
| `uuid` + `uuidv7()`                   | Generated-anywhere, time-ordered keys                        |
| `text`                                | **All** strings — `varchar(n)` offers no performance benefit |
| `numeric(12,2)`                       | Money and anything requiring exactness                       |
| `timestamptz`                         | **Always** — never `timestamp`                               |
| `jsonb`                               | Semi-structured data, indexable                              |
| `citext`                              | Case-insensitive text (emails, usernames)                    |
| `int4range`, `tstzrange`              | Ranges, with overlap constraints                             |
| `text[]`                              | Small arrays, when a join table is overkill                  |
| `ENUM`                                | A closed set that rarely changes                             |

Two of these prevent recurring bugs:

**`timestamptz`, always.** Despite the name, it does not store a timezone — it
stores an absolute instant in UTC and converts on the way in and out. `timestamp
without time zone` stores a wall-clock reading with no idea which clock, which
is almost never what anyone wants.

**`text`, not `varchar(n)`.** In PostgreSQL they are the same type internally,
and `text` is not slower. A length limit is a business rule; enforce it with a
`CHECK` if it genuinely matters, so changing it does not require rewriting the
table.

```sql
CREATE TABLE orders (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     bigint NOT NULL REFERENCES users(id),
  status      text NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  total_pence bigint NOT NULL CHECK (total_pence >= 0),
  metadata    jsonb NOT NULL DEFAULT '{}',
  placed_at   timestamptz NOT NULL DEFAULT now()
);
```

A `CHECK` constraint on `status` is often better than an `ENUM`: adding a value
is a one-line migration rather than an `ALTER TYPE`.

### Constraints do work for you

```sql
-- Uniqueness only among active rows.
CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL;

-- No two bookings may overlap for the same room. Enforced by the database.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (room_id WITH =, during WITH &&);
```

An **exclusion constraint** is Postgres-specific and genuinely powerful: it
makes an entire class of double-booking race impossible, with no application
locking at all.

---

## Indexes

B-tree is the default and correct for most cases. The others solve specific
problems:

| Index      | For                                                     |
| ---------- | ------------------------------------------------------- |
| **B-tree** | Equality and range on scalars. The default.             |
| **GIN**    | `jsonb` containment, arrays, full-text search           |
| **GiST**   | Geometric data, ranges, exclusion constraints           |
| **BRIN**   | Very large, naturally ordered tables (append-only logs) |
| **Hash**   | Equality only; rarely worth it over B-tree              |

```sql
-- Partial: index only the rows you query
CREATE INDEX idx_orders_pending ON orders (placed_at) WHERE status = 'pending';

-- Expression: match how you actually filter
CREATE INDEX idx_users_lower_email ON users (lower(email));

-- Covering: satisfy the query from the index alone
CREATE INDEX idx_orders_lookup ON orders (user_id, placed_at) INCLUDE (total_pence);

-- Always CONCURRENTLY on a live table — otherwise writes block
CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);
```

A **partial index** is often dramatically smaller than a full one. If 2 % of
orders are pending and that is what you query, index only those.

Find indexes nobody uses — they cost writes and disk for nothing:

```sql
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

See [Data Modelling](/knowledge-base/databases/data-modelling#indexes) for
composite index ordering and the things that silently disable an index.

---

## EXPLAIN

The single most valuable Postgres skill.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o.*, u.email
FROM orders o JOIN users u ON u.id = o.user_id
WHERE o.status = 'pending' AND o.placed_at > now() - interval '7 days';
```

`EXPLAIN` alone estimates; **`EXPLAIN ANALYZE` actually runs the query** and
reports real timings. `BUFFERS` shows how much came from cache versus disk.

What to look for:

- **`Seq Scan` on a large table** — usually a missing index. On a small table it
  is correct and faster than an index.
- **A large gap between `rows=` estimated and actual** — stale statistics. Run
  `ANALYZE tablename`.
- **`Nested Loop` over many rows** — often fine for small inputs, pathological
  for large ones.
- **Sort with `external merge Disk`** — `work_mem` is too small for this query.
- **The actual time on each node**, which tells you where the time went rather
  than where you assumed.

[explain.dalibo.com](https://explain.dalibo.com/) visualises a plan and is far
easier to read than raw text output.

Note that `EXPLAIN ANALYZE` executes the statement — wrap a destructive one in a
transaction and roll back.

---

## MVCC and Vacuum

The concept that explains Postgres's most surprising operational behaviour.

**Multi-Version Concurrency Control**: an `UPDATE` does not overwrite a row. It
writes a new version and marks the old one dead. A `DELETE` only marks. This is
why readers never block writers and writers never block readers — everyone sees
a consistent snapshot.

The consequence is **dead tuples**, and the need for `VACUUM` to reclaim them.
Autovacuum handles this by default, and the failure modes are worth recognising:

- **Table bloat.** A heavily updated table grows far beyond its live data.
  `VACUUM FULL` rewrites it compactly but takes an exclusive lock — use
  `pg_repack` on a live system instead.
- **Long-running transactions block vacuum.** Postgres cannot reclaim a version
  that any open transaction might still need. One forgotten `BEGIN` in a
  `psql` session can bloat the entire database.
- **Transaction ID wraparound.** If vacuum falls far enough behind, Postgres
  refuses writes to protect data. It is rare, dramatic, and always preceded by
  weeks of warnings in the log.

```sql
-- Dead tuples and last autovacuum, per table
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 10;

-- Any transaction open for a long time is a problem
SELECT pid, state, now() - xact_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle' AND xact_start < now() - interval '5 minutes';
```

For a hot table, make autovacuum more aggressive rather than running it by hand:

```sql
ALTER TABLE events SET (autovacuum_vacuum_scale_factor = 0.02);
```

---

## JSONB

`jsonb` gives you document storage inside a relational database — parsed,
binary, and indexable. (`json` stores the raw text and is almost never what you
want.)

```sql
SELECT * FROM events WHERE payload @> '{"type": "purchase"}';
SELECT payload->>'email' FROM events;               -- text
SELECT payload->'items'->0->>'sku' FROM events;      -- nested
SELECT * FROM events WHERE payload ? 'refund_id';    -- key exists

CREATE INDEX idx_events_payload ON events USING gin (payload);
-- Smaller, if you only use containment:
CREATE INDEX idx_events_payload ON events USING gin (payload jsonb_path_ops);
```

**Use it for genuinely variable data** — third-party webhook payloads, audit
detail, user preferences. **Do not use it to avoid designing a schema.** If you
filter, join or sort on a field, it should be a column: columns get statistics
and the planner can reason about them, JSONB fields largely do not.

A good middle path is a generated column, which gives you a real indexable
column derived from the document:

```sql
ALTER TABLE events
  ADD COLUMN event_type text
  GENERATED ALWAYS AS (payload->>'type') STORED;
```

PostgreSQL 18 also supports **virtual** generated columns, computed on read
rather than stored — cheaper writes, no disk cost, and now the default for new
generated columns.

---

## Setup

```bash
brew install postgresql@18 && brew services start postgresql@18   # macOS
sudo apt install postgresql-18                                     # Debian/Ubuntu
docker run -d -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:18-alpine
```

```bash
psql -U postgres
\l              # list databases      \dt   list tables
\d orders       # describe a table    \di   list indexes
\x              # expanded output — essential for wide rows
\timing         # show query durations
```

Settings that matter most on a dedicated server:

```ini title="postgresql.conf"
shared_buffers = 4GB              # ~25% of RAM
effective_cache_size = 12GB       # ~75% of RAM; a planner hint, not an allocation
work_mem = 32MB                   # PER SORT, per connection — multiply carefully
maintenance_work_mem = 1GB        # index builds, vacuum
random_page_cost = 1.1            # SSDs: the 4.0 default assumes spinning disks
io_method = io_uring              # PG18 async I/O on modern Linux

log_min_duration_statement = 500ms   # log slow queries
```

`random_page_cost = 1.1` is the highest-value one-line change on SSD hardware:
the default assumes a random read is four times more expensive than a sequential
one, which was true of spinning disks and badly wrong for SSDs — it makes the
planner avoid indexes it should be using.

Extensions worth knowing:

```sql
CREATE EXTENSION pg_stat_statements;  -- aggregate query statistics. Install this first
CREATE EXTENSION pg_trgm;             -- fuzzy text matching, LIKE '%x%' indexes
CREATE EXTENSION postgis;             -- geospatial
CREATE EXTENSION vector;              -- embeddings and similarity search
```

---

## Performance Workflow

1. **Find the expensive queries.** `pg_stat_statements` ranks by total time,
   which is the right metric — a 20 ms query run a million times matters more
   than a 4 s report run daily.

   ```sql
   SELECT calls, round(mean_exec_time::numeric, 2) AS avg_ms,
          round(total_exec_time::numeric) AS total_ms, query
   FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
   ```

2. **`EXPLAIN (ANALYZE, BUFFERS)`** the worst offender.
3. **Add or fix an index**, or rewrite the query.
4. **Re-measure.** Confirm it helped and did not slow writes elsewhere.

Common wins, in rough order:

- Fix the N+1 in the application before tuning anything in the database.
- Add the missing index, `CONCURRENTLY`.
- Use a partial index when you always filter on the same predicate.
- Replace `OFFSET` pagination with keyset pagination — `OFFSET 100000` makes the
  database count and discard 100,000 rows. See
  [Pagination](/knowledge-base/apis/pagination).
- Raise `work_mem` for a specific reporting session rather than globally.
- Consider a materialised view for an expensive aggregate that tolerates being
  slightly stale.

---

## Backups and Operations

```bash
pg_dump -Fc mydb > mydb.dump          # custom format: compressed, parallel restore
pg_restore -d mydb -j 4 mydb.dump
pg_basebackup -D /backup -Fp -Xs -P   # physical base backup for PITR
```

- **Test your restores.** An untested backup is a hypothesis. Restore into a
  scratch environment on a schedule.
- **Point-in-time recovery** needs WAL archiving as well as a base backup — that
  is what lets you recover to the moment before a bad `DELETE`.
- **Replication**: streaming physical replicas for high availability and read
  scaling; logical replication for major-version upgrades with minimal downtime
  and for replicating a subset of tables.
- **Monitor** connection count, replication lag, cache hit ratio, dead tuples,
  and the age of the oldest transaction.

```sql
-- Cache hit ratio: below ~0.99 on an OLTP workload suggests shared_buffers is small
SELECT sum(blks_hit)::float / nullif(sum(blks_hit) + sum(blks_read), 0)
FROM pg_stat_database;
```

---

## Security

- **Least privilege.** The application user needs `SELECT`, `INSERT`, `UPDATE`,
  `DELETE` — not `DROP`, and not superuser. Migrations can run as a different,
  higher-privileged user.
- **Parameterise every query.** All drivers support it; string interpolation is
  how [SQL injection](/knowledge-base/security/sql-injection) happens.
- **`scram-sha-256`** authentication, never `md5` or `trust`.
- **TLS for connections** that cross a network boundary.
- **Row-level security** when several tenants share a table:

  ```sql
  ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.tenant_id')::bigint);
  ```

  RLS is enforced by the database, so a forgotten `WHERE tenant_id = …` in one
  query cannot leak another tenant's data. It is one of Postgres's strongest
  features for multi-tenant applications.

---

## Do's and Don'ts

### Do

- Use `timestamptz`, `text` and `numeric` for money.
- Let constraints enforce invariants — including exclusion constraints.
- Create indexes `CONCURRENTLY` on live tables.
- Install `pg_stat_statements` and use it to find real problems.
- Read `EXPLAIN (ANALYZE, BUFFERS)` rather than guessing.
- Set `random_page_cost = 1.1` on SSDs.
- Watch dead tuples and long-running transactions.
- Test restores, not just backups.

### Don't

- Don't use `timestamp` without time zone.
- Don't use `varchar(n)` for arbitrary strings.
- Don't use `jsonb` for fields you filter or join on.
- Don't run `VACUUM FULL` on a live table.
- Don't leave transactions open — they block vacuum.
- Don't use `OFFSET` for deep pagination.
- Don't give the application user superuser.
- Don't raise `work_mem` globally to fix one query; it is per sort, per
  connection.

---

## Debugging

| Symptom                        | Cause and fix                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Query suddenly slow            | Stale statistics after bulk changes. `ANALYZE tablename`.                        |
| Index exists but is not used   | Function on the column, type mismatch, or the planner judges a seq scan cheaper. |
| Table far larger than its data | Bloat from MVCC. Check `n_dead_tup`; consider `pg_repack`.                       |
| Autovacuum never completes     | A long-running transaction is holding back the horizon.                          |
| "Too many connections"         | Pool oversized or leaked. Add PgBouncer.                                         |
| Deadlock detected              | Two transactions locking rows in different orders. Lock consistently.            |
| `CREATE INDEX` hangs           | Waiting on a lock behind a long transaction. Use `CONCURRENTLY`.                 |
| Sort spills to disk            | `work_mem` too low for that query. Raise it for the session only.                |

```sql
SELECT pid, now() - query_start AS runtime, wait_event_type, left(query, 80)
FROM pg_stat_activity WHERE state = 'active' ORDER BY runtime DESC;

SELECT pg_cancel_backend(pid);   -- politely cancel a query
SELECT pg_terminate_backend(pid); -- kill the connection
```

---

## FAQ

**PostgreSQL or MySQL?**
PostgreSQL for correctness, richer types, extensions and complex queries. MySQL
where hosting or an existing stack dictates it. For a greenfield project,
Postgres is the stronger default. See [MySQL](/knowledge-base/databases/mysql).

**Can Postgres replace Redis, Elasticsearch and my queue?**
For a great many applications, yes — `UNLOGGED` tables for cache-like data,
full-text search with `tsvector`, and `SELECT … FOR UPDATE SKIP LOCKED` for a
job queue. One store you operate well beats three you operate badly. At scale,
the specialists earn their place.

**How do I upgrade a major version?**
`pg_upgrade` for short downtime, logical replication for near-zero downtime.
PostgreSQL 18 preserves planner statistics across the upgrade, which removes the
post-upgrade performance cliff earlier versions had.

**Is `SERIAL` deprecated?**
Not removed, but `GENERATED ALWAYS AS IDENTITY` is the SQL-standard form and
handles permissions and sequence ownership more cleanly.

**When should I shard?**
Later than you think. A single well-tuned Postgres instance handles far more
than most applications ever need. Exhaust vertical scaling, read replicas and
partitioning first.

---

## Check your understanding

<Quiz
question="A table's on-disk size keeps growing although the row count is stable. Autovacuum is enabled. What is the most likely cause?"
options={[
{
text: 'A long-running open transaction is preventing vacuum from reclaiming dead tuples',
correct: true,
why: 'MVCC keeps old row versions until no transaction could still need them. One forgotten open transaction pins the horizon and blocks reclamation database-wide.',
},
{text: 'Autovacuum is disabled for that table', why: 'Possible, but the premise says it is enabled — and a blocked horizon is the far more common cause.'},
{text: 'The table has too many indexes', why: 'Indexes add size, but they do not make the table grow while the row count is stable.'},
{text: 'VACUUM FULL has never been run', why: 'Routine vacuum should keep bloat in check. Needing VACUUM FULL is a symptom, not the cause.'},
]}
explanation={<>Check <code>pg_stat_activity</code> for transactions older than a few minutes. Idle-in-transaction connections from an application that forgot to commit are the usual culprit; <code>idle_in_transaction_session_timeout</code> guards against it.</>}
reference={{label: 'MVCC and vacuum', href: '/knowledge-base/databases/postgresql#mvcc-and-vacuum'}}
/>

<Quiz
question="Which choices does PostgreSQL let you make that meaningfully reduce application-level validation code?"
type="multiple"
options={[
{text: 'A CHECK constraint restricting status to a known set of values', correct: true, why: 'The database rejects anything else, whatever writes it — including a migration script or a psql session.'},
{text: 'An exclusion constraint preventing overlapping bookings', correct: true, why: 'Makes a whole class of double-booking race impossible with no application locking at all.'},
{text: 'A partial unique index enforcing uniqueness only among non-deleted rows', correct: true, why: 'Expresses "unique among active records" declaratively, which application code cannot do race-free.'},
{text: 'Row-level security policies for tenant isolation', correct: true, why: 'A forgotten WHERE tenant_id clause can no longer leak data, because the database applies the filter.'},
{text: 'Using text instead of varchar(n)', why: 'A good default, but it removes a length limit rather than adding a guarantee.'},
]}
explanation={<>The general principle: every invariant the database enforces is one that cannot be broken by a bug in code that does not exist yet.</>}
reference={{label: 'Constraints do work for you', href: '/knowledge-base/databases/postgresql#constraints-do-work-for-you'}}
/>

<Quiz
question="A query on a large table has an appropriate index, but EXPLAIN shows a sequential scan. The server runs on SSDs with default settings. What is worth checking first?"
options={[
{
text: 'random_page_cost is still 4.0, which tells the planner random reads are far more expensive than they are on SSD',
correct: true,
why: 'The default assumes spinning disks. On SSD it systematically biases the planner away from index scans; 1.1 reflects reality.',
},
{text: 'The index needs rebuilding', why: 'Possible with heavy bloat, but far less common than the planner cost defaults being wrong for the hardware.'},
{text: 'shared_buffers is too small', why: 'Affects caching, not the relative cost model that drives index-versus-seq-scan choice.'},
{text: 'The table needs VACUUM FULL', why: 'Bloat can influence the estimate, but it is not the first thing to check on an otherwise healthy table.'},
]}
explanation={<>Also confirm the statistics are current with <code>ANALYZE</code>, and check that the query is not wrapping the indexed column in a function or comparing mismatched types — both silently prevent index use.</>}
reference={{label: 'Setup', href: '/knowledge-base/databases/postgresql#setup'}}
/>

<Quiz
question="A team stores webhook payloads in a jsonb column and now filters by payload->>'customer_id' on every request. It is slow. What is the best fix?"
options={[
{
text: 'Promote customer_id to a real column — a generated column works well — and index it',
correct: true,
why: 'Columns get statistics the planner can reason about. Fields you filter, join or sort on should be columns; jsonb is for genuinely variable data.',
},
{text: 'Add a GIN index over the whole payload column', why: 'Helps containment queries, but is large and not the best structure for equality on one scalar field.'},
{text: 'Switch the column type from jsonb to json', why: 'json stores raw text and cannot be indexed usefully — strictly worse.'},
{text: 'Move the whole table to MongoDB', why: 'A large migration to solve a problem that a generated column and an index fix in one migration.'},
]}
explanation={<>PostgreSQL 18 makes this cheaper still: virtual generated columns compute on read, so you get an indexable expression without the write and storage cost of a stored column.</>}
reference={{label: 'JSONB', href: '/knowledge-base/databases/postgresql#jsonb'}}
/>

<Quiz
question="You need to add an index to a 200-million-row table in production. Which command is safe?"
options={[
{
text: 'CREATE INDEX CONCURRENTLY — it builds without blocking writes',
correct: true,
why: 'A plain CREATE INDEX takes a lock that blocks writes for the entire build, which on a table that size is an outage.',
},
{text: 'CREATE INDEX inside a transaction so it can be rolled back', why: 'CONCURRENTLY cannot run inside a transaction, and a plain build in one still holds the write lock throughout.'},
{text: 'CREATE INDEX during off-peak hours', why: 'Reduces the blast radius without removing the write lock. Still an outage for anyone writing.'},
{text: 'VACUUM FULL first, then CREATE INDEX', why: 'VACUUM FULL takes an exclusive lock — worse than the problem being avoided.'},
]}
explanation={<>CONCURRENTLY is slower and can leave an invalid index if it fails, so check <code>pg_index.indisvalid</code> afterwards and drop-and-retry if needed. That is a much better failure mode than blocked writes.</>}
reference={{label: 'Indexes', href: '/knowledge-base/databases/postgresql#indexes'}}
/>

---

## References

- [PostgreSQL documentation](https://www.postgresql.org/docs/current/) — genuinely
  excellent, and worth reading rather than searching.
- [PostgreSQL 18 release notes](https://www.postgresql.org/docs/18/release-18.html)
  — async I/O, `uuidv7()`, skip scan, virtual generated columns.
- [Use The Index, Luke](https://use-the-index-luke.com/) — indexing from first
  principles.
- [Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
  — MVCC, bloat and wraparound.
- [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)
  — find the queries that actually cost you.
- [explain.dalibo.com](https://explain.dalibo.com/) — visualise a query plan.
- [PGTune](https://pgtune.leopard.in.ua/) — a sane starting configuration for
  your hardware.
