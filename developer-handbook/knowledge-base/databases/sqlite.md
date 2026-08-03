---
title: 'SQLite'
description: 'An embedded, zero-configuration SQL database — WAL mode, type affinity, the concurrency model, and when a single file is the right architecture.'
---

# SQLite

## Introduction

SQLite is the most widely deployed database in the world — it is in every phone,
every browser, every operating system, most desktop applications and a great
many aircraft. It is also the most misunderstood, because "embedded" gets read
as "toy".

**What it is.** A C library, not a server. Your application calls into it
directly and it reads and writes a single file. There is no process to start, no
port, no user accounts, no network. A backup is a file copy.

**What that buys you.** Zero latency — a query is a function call, not a network
round trip. Zero operational surface. Trivial deployment. Excellent reliability;
SQLite's test suite is famously exhaustive, with more test code than library
code.

**The one real constraint:** **one writer at a time.** Readers are concurrent
and plentiful, writers serialise. That single fact determines whether SQLite
fits your problem.

**Where it fits:** mobile and desktop applications, CLI tools, browser storage,
test suites, edge deployments, IoT, on-disk caches, analytics files, and — with
WAL mode and a single application server — a surprising number of production web
applications. A read-heavy site serving tens of thousands of requests a minute
from SQLite is entirely normal.

**Where it does not:** several application servers needing to write to the same
database, write-heavy workloads, or anything requiring network access to the
data.

:::note Version
Written against **SQLite 3.46+**. SQLite's file format has been backwards
compatible since 2004 and the project commits to maintaining that through 2050.
:::

---

## Core Concepts

### The concurrency model

By default SQLite uses a rollback journal and locks the whole database during a
write, blocking readers. **WAL (write-ahead logging) mode changes this**, and is
the single most important setting:

```sql
PRAGMA journal_mode = WAL;
```

With WAL:

- **Readers do not block writers, and writers do not block readers.** Readers
  see a consistent snapshot from the last commit while a write is in progress.
- **Still one writer at a time.** A second concurrent write waits.
- Two extra files appear alongside the database: `-wal` and `-shm`.

`journal_mode` is persistent — set it once and it stays with the file. Every
other pragma below is per-connection and must be set on each one.

When a second writer arrives, SQLite returns `SQLITE_BUSY` immediately unless you
tell it to wait:

```sql
PRAGMA busy_timeout = 5000;   -- wait up to 5s for the write lock
```

**"Database is locked" is almost always a missing `busy_timeout`.** It is the
single most common SQLite error and the fix is one line.

### Type affinity

SQLite is dynamically typed. A column has an _affinity_ — a preference — rather
than a strict type, and by default you can store a string in an `INTEGER`
column.

```sql
CREATE TABLE t (n INTEGER);
INSERT INTO t VALUES ('hello');   -- accepted by default
```

Since 3.37 you can opt into strictness, and you should:

```sql
CREATE TABLE orders (
  id         INTEGER PRIMARY KEY,          -- rowid alias: fast, auto-assigned
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL CHECK (status IN ('pending','paid','shipped')),
  total_pence INTEGER NOT NULL CHECK (total_pence >= 0),
  placed_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
```

`STRICT` tables reject values of the wrong type, which is what most developers
assumed was happening all along.

Note the storage classes are only `INTEGER`, `REAL`, `TEXT`, `BLOB` and `NULL`.
There is **no date type** — store ISO-8601 text (`2026-08-03T14:30:00Z`) or a
Unix integer. Text sorts correctly and is readable; integers are compact.

**`INTEGER PRIMARY KEY` is special.** It aliases the internal `rowid`, making it
the fastest possible key. Any other primary key type creates a separate index.

### Foreign keys are off by default

For backwards compatibility, SQLite does not enforce foreign keys unless asked —
**per connection**:

```sql
PRAGMA foreign_keys = ON;
```

Forget this and your `REFERENCES` clauses are documentation. Most modern drivers
set it, but verify rather than assume.

---

## Setup

```bash
sqlite3 app.db        # the CLI; the library is already in your language
```

```sql
.tables
.schema orders
.headers on
.mode box              -- readable output
.timer on
.expert                -- suggests indexes for a query
```

The pragmas worth setting on every connection in a server application:

```sql
PRAGMA journal_mode = WAL;        -- persistent; set once
PRAGMA busy_timeout = 5000;       -- wait rather than failing instantly
PRAGMA foreign_keys = ON;         -- enforce referential integrity
PRAGMA synchronous = NORMAL;      -- safe with WAL, much faster than FULL
PRAGMA cache_size = -64000;       -- 64MB of page cache (negative = KiB)
PRAGMA temp_store = MEMORY;
```

`synchronous = NORMAL` with WAL is the standard production choice: it cannot
corrupt the database, and the worst case on an OS crash or power loss is losing
the last few committed transactions. `FULL` is slower and only protects that
final window.

```python
import sqlite3

conn = sqlite3.connect("app.db", isolation_level=None)  # manage transactions yourself
conn.executescript("""
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
""")
```

---

## Performance

SQLite is extremely fast when used correctly, and pathologically slow when not.

**Batch writes into transactions.** This is the biggest single factor by a wide
margin:

```python
# ❌ 10,000 implicit transactions, each with a durability flush
for row in rows:
    conn.execute("INSERT INTO events VALUES (?, ?)", row)

# ✅ One transaction — routinely 100× faster
with conn:
    conn.executemany("INSERT INTO events VALUES (?, ?)", rows)
```

Each statement outside an explicit transaction is its own transaction with its
own fsync. Wrapping a bulk load in one transaction turns minutes into seconds.

**Index the same way as any other engine** — see
[Data Modelling](/knowledge-base/databases/data-modelling#indexes). `EXPLAIN
QUERY PLAN` shows what happened:

```sql
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE status = 'pending';
-- SCAN orders            ← full scan; wants an index
-- SEARCH orders USING INDEX idx_status (status=?)   ← good
```

`ANALYZE` collects statistics so the planner chooses well; run it after bulk
loads.

**Other things that matter:**

- **Use prepared statements**, both for safety and to avoid re-parsing SQL.
- **`PRAGMA optimize`** on connection close is recommended by the project — it
  keeps statistics current automatically.
- **`VACUUM`** reclaims space after large deletes; the file never shrinks on its
  own.
- **Keep write transactions short.** They hold the single write lock, and
  everything else waits.

---

## Features People Do Not Expect

SQLite supports a great deal more than "simple SQL":

```sql
-- Window functions
SELECT name, total, RANK() OVER (ORDER BY total DESC) FROM orders;

-- CTEs, including recursive
WITH RECURSIVE tree AS (
  SELECT id, parent_id, name FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, c.name FROM categories c JOIN tree t ON c.parent_id = t.id
)
SELECT * FROM tree;

-- JSON, with operators since 3.38
SELECT payload ->> 'email' FROM events WHERE payload ->> 'type' = 'signup';

-- Full-text search
CREATE VIRTUAL TABLE docs_fts USING fts5(title, body);
SELECT * FROM docs_fts WHERE docs_fts MATCH 'sqlite AND performance';

-- UPSERT
INSERT INTO counters (key, n) VALUES ('hits', 1)
  ON CONFLICT (key) DO UPDATE SET n = n + 1;

-- Generated columns, partial indexes, RETURNING
```

FTS5 in particular is excellent and removes the need for Elasticsearch in many
applications.

---

## Backups

```bash
# Correct: a consistent copy of a live database
sqlite3 app.db ".backup backup.db"

# Also correct, and readable
sqlite3 app.db ".dump" > backup.sql

# ❌ NOT safe on a live database
cp app.db backup.db
```

Copying the file with `cp` while a write is in progress can capture a torn
state, and in WAL mode it misses the `-wal` file entirely. Use `.backup`, or the
backup API in your language binding.

**Litestream** streams the WAL to object storage continuously, giving
point-in-time recovery for a single-file database — it is the standard answer
for running SQLite in production and turns "one file on one disk" from a risk
into a manageable one.

---

## SQLite in Production Web Applications

This has become genuinely mainstream, and the reasoning is worth understanding.

**It works when:** one application server (or several sharing a filesystem
carefully), a read-heavy workload, and writes that are short and serialised.
Zero network latency to the database is a real advantage — a query is
microseconds, not milliseconds, so the N+1 problem that would cripple a
client-server database is merely inefficient.

**It does not when:** several servers must write concurrently, writes are heavy
or long-running, or you need the database reachable over a network.

The pieces to put in place:

- WAL mode and a `busy_timeout` on every connection.
- **Serialise writes through a single connection or a small write pool**, and
  keep a larger pool for reads. Many drivers now do this for you.
- Litestream or equivalent for continuous backup.
- Distributed variants — **Turso/libSQL**, **Cloudflare D1**, **rqlite** — when
  you need replicas or edge reads.

---

## Testing

SQLite's most universal use in web development: an in-memory database per test.

```python
conn = sqlite3.connect(":memory:")   # nothing on disk, torn down automatically
```

It is fast and isolated. **But do not test against SQLite while running
PostgreSQL or MySQL in production.** The differences are real — type affinity,
`ALTER TABLE` limitations, different `NULL` handling in unique constraints,
missing `RIGHT JOIN` in older versions, and no `SELECT … FOR UPDATE`. Tests pass
and production fails, which is worse than a slower test suite. Use
Testcontainers with the real engine; see
[Testing](/knowledge-base/testing#integration-tests-against-a-real-database).

---

## Limitations Worth Knowing

- **One writer at a time.** The defining constraint.
- **`ALTER TABLE` is limited.** Dropping and modifying columns arrived only
  recently; the traditional workaround is create-new, copy, drop, rename.
- **No `RIGHT`/`FULL OUTER JOIN`** before 3.39.
- **No user management or permissions.** File permissions are the access
  control.
- **No network protocol.** By design.
- **Limited `ALTER` on constraints.** Adding one usually means rebuilding the
  table.
- **No stored procedures.**

---

## Do's and Don'ts

### Do

- Enable WAL mode, once, per database.
- Set `busy_timeout` and `foreign_keys` on **every** connection.
- Use `STRICT` tables on anything new.
- Wrap bulk writes in a single transaction.
- Use `INTEGER PRIMARY KEY` for the fastest key.
- Use `.backup` or Litestream, never `cp`.
- Store dates as ISO-8601 text or Unix integers.
- Use FTS5 before reaching for a search engine.

### Don't

- Don't assume foreign keys are enforced — they are off by default.
- Don't insert 10,000 rows outside a transaction.
- Don't run it as the primary database behind several writing app servers.
- Don't copy a live database file with `cp`.
- Don't test on SQLite if you deploy on PostgreSQL.
- Don't expect `ALTER TABLE` to behave like Postgres's.
- Don't leave a write transaction open — everything else waits on it.

---

## Debugging

| Symptom                              | Cause and fix                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `SQLITE_BUSY` / "database is locked" | No `busy_timeout`, or a long write transaction. Set the pragma; shorten writes. |
| Foreign keys not enforced            | `PRAGMA foreign_keys = ON` is per connection, and off by default.               |
| Bulk insert takes minutes            | Each statement is its own transaction. Wrap them in one.                        |
| A string stored in an INTEGER column | Type affinity. Use a `STRICT` table.                                            |
| File never shrinks after deletes     | Pages are reused, not released. `VACUUM`.                                       |
| Query slow on a large table          | Missing index. `EXPLAIN QUERY PLAN`; try `.expert`.                             |
| Corruption after a copy              | The file was copied live. Use `.backup`.                                        |
| `-wal` file grows without bound      | A long-lived reader is preventing checkpointing.                                |

---

## FAQ

**Is SQLite a real database?**
Yes — fully ACID, with a test suite far larger than the library. The
architecture differs from a client-server database; the correctness does not.

**Can it handle production traffic?**
Read-heavy traffic, comfortably — tens of thousands of reads per second from one
file is unremarkable. Writes serialise, which is the limit to plan around.

**How large can the file get?**
The theoretical limit is 281 TB. Practically, multi-gigabyte databases are
routine.

**What about several application servers?**
Not over a network filesystem — locking on NFS is unreliable and corruption is a
genuine risk. Use libSQL/Turso, rqlite, or a client-server database.

**SQLite or Postgres for a small project?**
SQLite if it is single-server and read-heavy: no operational surface at all. Postgres if
you expect to scale horizontally, or want to avoid a migration later.

**Do I need an ORM?**
No, and the low latency makes hand-written SQL pleasant. Use one if your
language's ecosystem expects it.

---

## Check your understanding

<Quiz
question="A web application using SQLite intermittently fails with 'database is locked' under moderate load. WAL mode is enabled. What is the most likely fix?"
options={[
{
text: 'Set PRAGMA busy_timeout on every connection so a waiting writer retries instead of failing immediately',
correct: true,
why: 'SQLite allows one writer at a time. Without a busy timeout, a second concurrent write returns SQLITE_BUSY instantly rather than waiting for the lock.',
},
{text: 'Switch back to rollback journal mode', why: 'Strictly worse — the rollback journal blocks readers during writes as well.'},
{text: 'Increase cache_size', why: 'Affects read performance; it has nothing to do with write lock contention.'},
{text: 'Open a separate database file per request', why: 'That would fragment the data entirely and solve nothing.'},
]}
explanation={<>The other half of the fix is keeping write transactions short: a transaction that stays open while doing other work holds the single write lock for its whole duration.</>}
reference={{label: 'The concurrency model', href: '/knowledge-base/databases/sqlite#the-concurrency-model'}}
/>

<Quiz
question="A table declares `REFERENCES users(id)` but rows with non-existent user_ids keep appearing. Why?"
options={[
{
text: 'Foreign key enforcement is off by default and must be enabled per connection with PRAGMA foreign_keys = ON',
correct: true,
why: 'SQLite parses REFERENCES but does not enforce it unless the pragma is set — and the pragma is per connection, not stored in the file.',
},
{text: 'SQLite does not support foreign keys at all', why: 'It does, fully, including cascades — enforcement just has to be switched on.'},
{text: 'The referenced column needs a unique index', why: 'A primary key already satisfies that requirement.'},
{text: 'STRICT mode is required for foreign keys', why: 'STRICT governs type checking. It is unrelated to referential integrity.'},
]}
explanation={<>Because it is per connection, one code path that opens a connection without the pragma can insert orphans that every other path would have rejected. Set it in one place where all connections are created.</>}
reference={{label: 'Foreign keys are off by default', href: '/knowledge-base/databases/sqlite#foreign-keys-are-off-by-default'}}
/>

<Quiz
question="Inserting 50,000 rows one statement at a time takes four minutes. Wrapping them in a single transaction takes two seconds. Why the difference?"
options={[
{
text: 'Each statement outside a transaction is its own transaction with its own durability flush to disk',
correct: true,
why: '50,000 implicit commits means 50,000 fsyncs. One transaction means one — the dominant cost by a wide margin.',
},
{text: 'Transactions let SQLite skip index maintenance', why: 'Indexes are still maintained; the saving is in commit and flush overhead.'},
{text: 'Statement parsing is the bottleneck', why: 'Parsing costs something, which prepared statements address — but it is nowhere near the fsync cost.'},
{text: 'Transactions increase the page cache size', why: 'Cache size is a separate pragma and unrelated.'},
]}
explanation={<>The same principle applies to every engine, but SQLite makes it dramatic because there is no network round trip to hide the flush behind.</>}
reference={{label: 'Performance', href: '/knowledge-base/databases/sqlite#performance'}}
/>

<Quiz
question="Which of these are sound reasons to choose SQLite for a production web application?"
type="multiple"
options={[
{text: 'A single application server with a read-heavy workload', correct: true, why: 'The one-writer limit is irrelevant when writes are rare and short, and reads are concurrent under WAL.'},
{text: 'Query latency measured in microseconds, because there is no network hop', correct: true, why: 'An in-process function call rather than a round trip. This is a genuine architectural advantage.'},
{text: 'No database server to provision, secure, patch or monitor', correct: true, why: 'The operational surface is a file, which for a small team is a real saving.'},
{text: 'Several application servers all writing to the database over NFS', why: 'Network filesystem locking is unreliable and risks corruption. This is the documented failure case.'},
{text: 'A write-heavy ingestion workload with sustained concurrent writers', why: 'Writes serialise on a single lock, so concurrent writers queue.'},
]}
explanation={<>Pair it with Litestream for continuous backup, and the "one file on one disk" objection largely disappears — which is why the pattern has become mainstream.</>}
reference={{label: 'SQLite in production web applications', href: '/knowledge-base/databases/sqlite#sqlite-in-production-web-applications'}}
/>

<Quiz
question="A team runs PostgreSQL in production but uses SQLite for their test suite because it is faster. What is the risk?"
options={[
{
text: 'Behavioural differences — type affinity, ALTER TABLE limits, NULL handling in unique constraints, no SELECT … FOR UPDATE — mean tests can pass while production breaks',
correct: true,
why: 'The engines differ in ways that matter. A test suite that validates against a different database is validating something other than what you ship.',
},
{text: 'No real risk — SQL is standardised', why: 'Standardised in outline, divergent in exactly the details that cause production bugs.'},
{text: 'SQLite is too slow for large test suites', why: 'It is faster, which is precisely why the shortcut is tempting.'},
{text: 'SQLite cannot run migrations', why: 'It can, though ALTER TABLE is more limited — itself an example of the divergence.'},
]}
explanation={<>Use Testcontainers to run real PostgreSQL in tests. SQLite remains an excellent choice for unit tests of code that genuinely targets SQLite, and for in-memory fixtures with no schema coupling.</>}
reference={{label: 'Testing', href: '/knowledge-base/databases/sqlite#testing'}}
/>

---

## References

- [SQLite documentation](https://www.sqlite.org/docs.html) — unusually clear and
  candid about trade-offs.
- [Appropriate uses for SQLite](https://www.sqlite.org/whentouse.html) — the
  project's own honest assessment.
- [Write-Ahead Logging](https://www.sqlite.org/wal.html) — how WAL changes the
  concurrency model.
- [Quirks, caveats and gotchas](https://www.sqlite.org/quirks.html) — type
  affinity and the other surprises, from the source.
- [STRICT tables](https://www.sqlite.org/stricttables.html) — opting into type
  checking.
- [FTS5](https://www.sqlite.org/fts5.html) — full-text search.
- [Litestream](https://litestream.io/) — continuous replication to object
  storage.
