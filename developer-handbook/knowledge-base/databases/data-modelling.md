---
title: 'Data Modelling'
description: 'Cross-cutting database concepts that apply regardless of engine — normalisation, keys, indexes, transactions, N+1, migrations and pooling.'
---

# Data Modelling

## Introduction

Most database problems are not engine-specific. Normalisation, key choice,
indexing strategy, the N+1 query problem, migration discipline and connection
pooling behave similarly across PostgreSQL, MySQL, SQLite and — with different
vocabulary — MongoDB. Getting them wrong produces the same symptoms everywhere.

**Why the schema matters more than the engine.** You can change a query in an
afternoon and swap an ORM in a week. A schema decision propagates into every
query, every migration, every integration and every backup, and it becomes
harder to reverse with each row added. This is the highest-leverage design work
in most applications, and it is usually done fastest and with least thought.

**The organising idea:** a database is not a place to put objects. It is a set
of facts with constraints that make contradictory facts impossible to store. The
more the database enforces, the less your application has to remember.

---

## Normalisation

Normalisation removes redundancy so a fact is stored exactly once. If a fact
lives in one place it cannot disagree with itself.

The forms that matter in practice:

**First normal form (1NF)** — no repeating groups; each column holds one value.

```sql
-- ❌ Comma-separated values in a column: unsearchable, unindexable, unjoinable
CREATE TABLE orders (id int, product_ids text);  -- '12,45,88'

-- ✅ A row per fact
CREATE TABLE order_items (order_id int, product_id int, quantity int);
```

**Second normal form (2NF)** — every non-key column depends on the _whole_
primary key, not part of it.

**Third normal form (3NF)** — non-key columns depend on the key and nothing
else. If `city` is determined by `postcode`, storing both in the same table
means they can disagree.

The practical rule: **normalise to 3NF by default.** It is the shape that makes
updates safe, and it is what every relational engine is optimised for.

### When to denormalise

Deliberately, with a reason, after measuring:

- **A computed aggregate that is read constantly** — `orders.item_count`,
  `posts.comment_count`. Recomputing on every read is expensive; keep it current
  with a trigger or in the same transaction as the write.
- **A historical snapshot.** An invoice line must record the price _at the time
  of purchase_. This is not denormalisation — it is a different fact from
  "today's price", and it must not be a join to `products.price`.
- **Read-heavy reporting**, where a materialised view or a separate read model
  serves queries that would otherwise join eight tables.

Every denormalisation creates a copy that can go stale. Write down what keeps it
correct, and prefer letting the database maintain it.

---

## Keys

### Natural or surrogate?

A **natural key** is data that identifies the row — an ISBN, an email address, a
country code. A **surrogate key** is a meaningless identifier generated for the
purpose.

**Use a surrogate primary key** for almost everything. Natural keys change:
people change email addresses, countries change codes, product SKUs get
restructured. When a primary key changes, every foreign key referencing it must
change too.

Add a **unique constraint** on the natural key so the database still enforces
uniqueness:

```sql
CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      citext NOT NULL UNIQUE,     -- natural key, enforced but not the PK
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### Integer, UUID or ULID?

| Type              | Pros                                    | Cons                                            |
| ----------------- | --------------------------------------- | ----------------------------------------------- |
| `bigint` identity | Small, fast, sequential, index-friendly | Enumerable; requires the DB to assign it        |
| **UUIDv4**        | Generated anywhere, non-enumerable      | 16 bytes, **random — fragments B-tree indexes** |
| **UUIDv7 / ULID** | Non-enumerable _and_ time-ordered       | 16 bytes; needs PG 18 or a library              |

The trap is UUIDv4 as a primary key at scale. Because the values are random,
every insert lands in a different part of the B-tree, so the index cannot be
appended to and pages split constantly. Write throughput degrades and the index
grows far larger than an equivalent integer index.

**UUIDv7 fixes this** by putting a timestamp in the high bits, so values are
roughly sequential and inserts cluster at the end of the index — the locality of
an integer with the generate-anywhere property of a UUID. PostgreSQL 18 added a
native `uuidv7()`; before that, use a library.

```sql
-- PostgreSQL 18+
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  ...
);
```

Choose an integer when ids never leave your system, and UUIDv7 when clients
generate ids, when you merge data across systems, or when a sequential id would
leak business volume to anyone who can see it.

### Foreign keys

Declare them. An application-level check cannot survive a concurrent write, a
bug in a second service, or someone at a `psql` prompt.

```sql
CREATE TABLE order_items (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity   int    NOT NULL CHECK (quantity > 0)
);
```

Note the deliberate difference: deleting an order should remove its items
(`CASCADE`); deleting a product that has been ordered should be _prevented_
(`RESTRICT`), because the history matters.

**Index your foreign keys.** Most engines do not do this automatically for the
referencing side, and an unindexed FK makes both joins and cascading deletes
slow.

---

## Indexes

An index is a sorted structure — almost always a B-tree — letting the engine
find rows without scanning the table.

### What to index

- Columns in `WHERE` clauses.
- Columns in `JOIN` conditions, on both sides.
- Columns in `ORDER BY`, when the sort is the expensive part.
- The referencing side of every foreign key.

### What indexes cost

They are not free. Every index must be updated on every `INSERT`, `UPDATE` and
`DELETE`, and it consumes disk and memory. A table with twelve indexes has slow
writes. The right number is "the ones that are used" — every engine can tell you
which indexes are never read.

### Composite indexes and column order

Order matters enormously. An index on `(status, created_at)` can serve:

- `WHERE status = 'pending'` ✅
- `WHERE status = 'pending' ORDER BY created_at` ✅
- `WHERE created_at > '2026-01-01'` ❌ — the leading column is missing

This is the **leftmost prefix rule**: an index can be used for any prefix of its
columns, starting from the first. Put the equality column first and the range or
sort column second.

PostgreSQL 18's _skip scan_ relaxes this somewhat, letting a multicolumn B-tree
be used in cases where the leading column is unconstrained but has few distinct
values. It is a mitigation, not a reason to stop thinking about order.

### Things that silently disable an index

```sql
-- ❌ A function on the column: the index on created_at cannot be used
WHERE DATE(created_at) = '2026-08-03'
-- ✅ A range instead
WHERE created_at >= '2026-08-03' AND created_at < '2026-08-04'

-- ❌ Leading wildcard: a B-tree cannot help
WHERE name LIKE '%smith'
-- ✅ Trailing wildcard is fine
WHERE name LIKE 'smith%'

-- ❌ Implicit type conversion (varchar column, integer literal)
WHERE account_number = 12345
```

If you must filter on an expression, index the expression:

```sql
CREATE INDEX idx_users_lower_email ON users (lower(email));
```

### Covering indexes

If an index contains every column a query needs, the engine never touches the
table — an _index-only scan_, and often several times faster:

```sql
CREATE INDEX idx_orders_status_created
  ON orders (status, created_at) INCLUDE (total);
```

### Read the plan

Never guess. `EXPLAIN ANALYZE` shows what the engine actually did:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE status = 'pending';
```

Look for `Seq Scan` on a large table, a large gap between estimated and actual
rows (stale statistics), and nested loops over big row counts.

---

## Transactions

A transaction groups statements so they all take effect or none do — the
canonical example being a transfer that must not debit one account without
crediting the other.

**ACID** is the guarantee set: **Atomicity** (all or nothing), **Consistency**
(constraints hold), **Isolation** (concurrent transactions do not corrupt each
other), **Durability** (a commit survives a crash).

### Isolation levels

Isolation is the one people get wrong, because the default is weaker than most
developers assume.

| Level               | Prevents                         | Default in         |
| ------------------- | -------------------------------- | ------------------ |
| Read uncommitted    | Nothing much                     | —                  |
| **Read committed**  | Dirty reads                      | **PostgreSQL**     |
| **Repeatable read** | + non-repeatable reads           | **MySQL (InnoDB)** |
| Serializable        | + phantoms; behaves as if serial | —                  |

Under **read committed** — PostgreSQL's default — two statements in the same
transaction can see different data, because another transaction committed in
between. This breaks the classic check-then-act pattern:

```sql
-- ❌ Racy: another transaction can insert between the SELECT and the INSERT
SELECT count(*) FROM bookings WHERE slot_id = 42;   -- returns 0
INSERT INTO bookings (slot_id) VALUES (42);          -- both transactions succeed
```

Three correct fixes, in order of preference:

1. **A unique constraint**, so the database makes the second insert impossible.
2. **`SELECT … FOR UPDATE`**, locking the rows you are about to act on.
3. **Serializable isolation**, with retry logic for serialisation failures.

The first is best: a constraint cannot be forgotten by the next developer.

### Keep transactions short

A transaction holds locks until it commits. Never do this:

```python
with transaction.atomic():
    order = create_order(...)
    send_email(order)            # ❌ an HTTP call inside a transaction
    charge_card(order)           # ❌ locks held while a third party is slow
```

An external call inside a transaction holds locks for as long as the third party
takes to respond, which under load is how a connection pool exhausts. Commit
first, then enqueue the side effects — see
[Queues](/knowledge-base/operations/queues).

---

## The N+1 Problem

The most common performance bug in application code, and almost always the
answer when a page is slow but every individual query is fast.

```python
orders = db.query("SELECT * FROM orders LIMIT 100")   # 1 query
for order in orders:
    order.user = db.query("SELECT * FROM users WHERE id = ?", order.user_id)  # 100 more
```

101 round trips. At 2 ms each that is 200 ms of pure waiting — and a
[network round trip is roughly a million times more expensive than a memory
access](/knowledge-base/general/complexity-and-cost#latency-you-should-have-a-feel-for).

Three fixes:

```sql
-- 1. A join
SELECT o.*, u.name FROM orders o JOIN users u ON u.id = o.user_id LIMIT 100;

-- 2. One batched second query
SELECT * FROM users WHERE id IN (1, 2, 3, …);
```

3. **Your ORM's eager loading** — `with()` in Eloquent, `selectinload()` in
   SQLAlchemy, `include` in Prisma, `select_related` in Django.

**Detecting it matters more than knowing the fix.** Log the query count per
request; anything scaling with result-set size is an N+1. Laravel can raise an
exception on lazy loading in development; most frameworks have an equivalent.

---

## Migrations

Schema changes are code. They belong in version control, reviewed, and applied
by a tool that tracks what has run.

**Forward-only in production.** Down migrations are useful locally and a trap in
production — a rollback that drops a column destroys data. Roll forward with a
new migration instead.

### Zero-downtime changes

During a deploy, old and new application code run simultaneously. Any migration
must be compatible with both.

**Adding a NOT NULL column** is the classic failure: old code does not know the
column exists, so its inserts fail. Split it into steps across deploys:

```sql
-- Deploy 1: add it nullable, with a default
ALTER TABLE users ADD COLUMN timezone text;

-- Deploy 2: application writes it; backfill existing rows in batches
UPDATE users SET timezone = 'UTC' WHERE timezone IS NULL AND id BETWEEN … ;

-- Deploy 3: now that every row has a value and all code writes it
ALTER TABLE users ALTER COLUMN timezone SET NOT NULL;
```

**Renaming a column** is the same shape: add the new one, write to both, backfill,
switch reads, stop writing the old, drop it. Four deploys, no downtime.

**Watch for locks.** In PostgreSQL, `ALTER TABLE … ADD COLUMN` with a constant
default is fast, but adding an index without `CONCURRENTLY` locks the table
against writes for the duration. On a large table that is an outage.

```sql
CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);
```

**Backfill in batches.** A single `UPDATE` over ten million rows holds locks and
bloats the write-ahead log. Loop in chunks of a few thousand with a pause.

---

## Connection Pooling

Every database connection costs memory — in PostgreSQL, a whole backend process.
Opening one per request exhausts the server long before your application is
saturated.

A pool keeps a small set of connections open and hands them out. The sizing rule
that surprises people: **small pools are usually faster.** A common starting
point is `(cores × 2) + effective_spindles` — often well under 20 for a single
application server. More connections than the database can usefully run in
parallel just adds context switching.

```text
100 app instances × 20 connections = 2000 connections
PostgreSQL default max_connections   =  100      ← exhausted
```

That arithmetic is why **PgBouncer** (or RDS Proxy, or your platform's
equivalent) exists in front of PostgreSQL at scale: it multiplexes many client
connections onto few server connections. In transaction pooling mode, note that
session-level features — prepared statements, `SET`, advisory locks, `LISTEN` —
behave differently or break.

Serverless makes this acute: every concurrent invocation is potentially a new
connection, so a pooler is effectively mandatory.

Always set a **statement timeout** so one runaway query cannot hold a connection
indefinitely:

```sql
SET statement_timeout = '30s';
```

---

## Choosing a Store

| Need                                      | Reach for                                          |
| ----------------------------------------- | -------------------------------------------------- |
| General-purpose, relational, correctness  | [PostgreSQL](/knowledge-base/databases/postgresql) |
| Ubiquitous hosting, read-heavy web apps   | [MySQL](/knowledge-base/databases/mysql)           |
| Embedded, single-writer, edge, tests      | [SQLite](/knowledge-base/databases/sqlite)         |
| Flexible documents, aggregation pipelines | [MongoDB](/knowledge-base/databases/mongodb)       |
| Cache, sessions, rate limits, queues      | [Redis](/knowledge-base/redis)                     |

**Default to PostgreSQL** unless something specific points elsewhere. It handles
relational data, JSON documents, full-text search, geospatial data and queues
well enough that most applications never need a second store — and one store is
dramatically simpler to operate than three.

---

## Do's and Don'ts

### Do

- Normalise to 3NF first; denormalise deliberately and document what keeps it
  correct.
- Use surrogate primary keys, with unique constraints on natural keys.
- Prefer UUIDv7 or ULID over UUIDv4 when you need generated-anywhere ids.
- Declare foreign keys, and index the referencing column.
- Put equality columns before range columns in composite indexes.
- Read `EXPLAIN ANALYZE` rather than guessing.
- Enforce invariants with constraints, not application checks.
- Keep transactions short and free of network calls.
- Write forward-only, backwards-compatible migrations.
- Set a statement timeout and pool connections.

### Don't

- Don't store lists in a comma-separated column.
- Don't use UUIDv4 as a primary key on a high-write table.
- Don't wrap an indexed column in a function in a `WHERE` clause.
- Don't add an index without checking whether it is used.
- Don't rely on check-then-act without a constraint or a lock.
- Don't add a `NOT NULL` column in one step on a live system.
- Don't create an index on a large table without `CONCURRENTLY`.
- Don't store money as a float — use integers or `numeric`.
- Don't store local time; store UTC with `timestamptz`.

---

## Debugging

| Symptom                        | Likely cause and fix                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Page slow, every query fast    | N+1. Count queries per request; use eager loading.                                     |
| One query slow, others fine    | Missing index, or an index disabled by a function/type mismatch. `EXPLAIN ANALYZE`.    |
| Query got slow after data grew | The planner switched to a sequential scan. Check statistics and index selectivity.     |
| "Too many connections"         | Pool larger than the server allows, or connections leaked. Add a pooler; cap the pool. |
| Deadlocks under load           | Two transactions locking rows in different orders. Lock in a consistent order.         |
| Duplicate rows despite a check | Check-then-act race. Add a unique constraint.                                          |
| Migration hangs on deploy      | An `ALTER` waiting for a lock behind a long transaction.                               |
| Writes slow, reads fine        | Too many indexes, or index fragmentation from random UUIDs.                            |

---

## FAQ

**How normalised should I be?**
3NF, then denormalise where measurement shows a problem. Starting denormalised
because it "will be faster" is the more expensive mistake.

**Is an ORM a bad idea?**
No — it removes a great deal of boilerplate. But know the SQL it generates, and
be ready to drop to raw SQL for reporting queries. Every ORM's default is N+1.

**Should validation live in the app or the database?**
Both. The application gives good error messages; the database guarantees the
invariant against races, bugs and direct access.

**JSON columns — good or bad?**
Good for genuinely schemaless data: third-party payloads, user preferences,
audit detail. Bad as a way to avoid designing a schema. If you filter or join on
a field, it should be a column.

**How do I store money?**
Integer minor units, or `numeric`/`decimal`. Never a float — see
[Data Representation](/knowledge-base/general/data-representation#numbers).

**Soft deletes?**
Useful for recoverability, at the cost of every query needing
`WHERE deleted_at IS NULL` — and one that forgets it is a data leak. Consider an
archive table instead.

---

## Check your understanding

<Quiz
question="A table has an index on (status, created_at). Which query can use it?"
options={[
{
text: "WHERE status = 'pending' ORDER BY created_at",
correct: true,
why: 'The leading column is constrained by equality and the second provides the sort order — the ideal shape for this index.',
},
{
text: "WHERE created_at > '2026-01-01'",
why: 'The leftmost prefix rule: an index can only be used from its first column onwards. With status unconstrained, a plain B-tree scan is not possible (PostgreSQL 18 skip scan may help if status has very few distinct values).',
},
{text: "WHERE lower(status) = 'pending'", why: 'Wrapping the column in a function prevents the index being used. Index the expression instead.'},
{text: "WHERE created_at > '2026-01-01' ORDER BY status", why: 'Neither the filter nor the sort matches the index order from the left.'},
]}
explanation={<>The rule for composite indexes: equality columns first, then the range or sort column. An index on <code>(a, b)</code> serves queries on <code>a</code> and on <code>a, b</code> — never on <code>b</code> alone.</>}
reference={{label: 'Composite indexes', href: '/knowledge-base/databases/data-modelling#composite-indexes-and-column-order'}}
/>

<Quiz
question="A booking system checks for an existing booking, then inserts if none is found. Under load, duplicates appear. Why, and what is the best fix?"
options={[
{
text: 'Two transactions can run the SELECT before either INSERT commits — add a unique constraint so the database makes the duplicate impossible',
correct: true,
why: 'Under read committed, the SELECT does not lock anything. A unique constraint is the most robust fix because it cannot be forgotten by the next developer.',
},
{text: 'Add a retry loop around the insert', why: 'Retrying does not prevent the race; it just does the same racy thing again.'},
{text: 'Move the check into application memory with a cache', why: 'A cache makes it worse — multiple app instances have separate caches and none is authoritative.'},
{text: 'Wrap both statements in a transaction', why: 'They almost certainly already are. A transaction gives atomicity, not mutual exclusion, at read-committed isolation.'},
]}
explanation={<><code>SELECT … FOR UPDATE</code> or serializable isolation also work, but a constraint is declarative and permanent — it protects code paths that do not exist yet.</>}
reference={{label: 'Isolation levels', href: '/knowledge-base/databases/data-modelling#isolation-levels'}}
/>

<Quiz
question="A high-write table uses UUIDv4 as its primary key. Insert throughput degrades as it grows and the index is far larger than expected. Why?"
options={[
{
text: 'UUIDv4 values are random, so inserts scatter across the B-tree causing constant page splits and poor cache locality',
correct: true,
why: 'A sequential key appends to the rightmost page, which stays in memory. Random keys touch a different page every time, splitting pages and thrashing the buffer cache.',
},
{text: 'UUIDs cannot be indexed efficiently by any database', why: 'They index fine — the problem is randomness, not the type. UUIDv7 has the same size and does not suffer this.'},
{text: 'UUIDv4 collides frequently at scale', why: 'Collision probability is negligible; this is not the issue.'},
{text: 'The 16-byte size is the whole problem', why: 'Size contributes, but the dominant cost is the loss of insert locality.'},
]}
explanation={<>UUIDv7 (native in PostgreSQL 18 as <code>uuidv7()</code>) and ULID put a timestamp in the high bits, restoring sequential insert locality while keeping the generate-anywhere property.</>}
reference={{label: 'Integer, UUID or ULID?', href: '/knowledge-base/databases/data-modelling#integer-uuid-or-ulid'}}
/>

<Quiz
question="Which of these migrations are safe to deploy while the old application version is still running?"
type="multiple"
options={[
{text: 'Adding a nullable column', correct: true, why: 'Old code ignores it; new code can write it. This is the first step of every safe column addition.'},
{text: 'Creating an index with CONCURRENTLY', correct: true, why: 'Builds without taking a write lock, so the table stays available throughout.'},
{text: 'Adding a NOT NULL column with no default', why: 'Old code inserts rows without that column, and every insert fails immediately.'},
{text: 'Renaming a column', why: 'Old code queries the old name and breaks the moment the migration lands. Use add-write-both-backfill-switch-drop instead.'},
{text: 'Dropping a column the new code no longer uses', why: 'Old instances are still selecting it during the rollout. Drop it in a later deploy.'},
]}
explanation={<>The test for every migration: <em>would the currently deployed code still work against this schema?</em> If not, split it across deploys.</>}
reference={{label: 'Zero-downtime changes', href: '/knowledge-base/databases/data-modelling#zero-downtime-changes'}}
/>

<Quiz
question="An API is deployed across 50 instances, each with a pool of 30 connections, against a PostgreSQL server with max_connections = 200. What happens, and what is the right response?"
options={[
{
text: 'The instances can demand 1,500 connections against 200 available — put PgBouncer in front and reduce the per-instance pool',
correct: true,
why: 'Connections are a server-side resource, and in PostgreSQL each is a process. A pooler multiplexes many client connections onto few server ones; small pools are also generally faster.',
},
{
text: 'Raise max_connections to 2,000',
why: 'Each connection is a backend process with its own memory. Thousands of them exhaust RAM and add context-switching overhead long before they help throughput.',
},
{text: 'Nothing — the pool will queue requests transparently', why: 'It queues locally, but 50 independent pools have no shared view, so the server is still oversubscribed.'},
{text: 'Switch to opening a connection per request', why: 'Strictly worse — connection setup cost on every request, and no upper bound at all.'},
]}
explanation={<>The counterintuitive part is that <em>smaller</em> pools usually perform better: beyond the number of queries the database can genuinely run in parallel, extra connections only add contention.</>}
reference={{label: 'Connection pooling', href: '/knowledge-base/databases/data-modelling#connection-pooling'}}
/>

---

## References

- [Use The Index, Luke](https://use-the-index-luke.com/) — the best free
  resource on indexing, engine-agnostic.
- [PostgreSQL: Data Definition](https://www.postgresql.org/docs/current/ddl.html)
  — constraints, keys, generated columns.
- [PostgreSQL: Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
  — precisely what each level prevents.
- [PostgreSQL 18 release notes](https://www.postgresql.org/docs/18/release-18.html)
  — `uuidv7()`, skip scan, async I/O.
- [Strong Migrations](https://github.com/ankane/strong_migrations) — a catalogue
  of unsafe migrations and their safe equivalents.
- [PgBouncer](https://www.pgbouncer.org/) — connection pooling modes and their
  limitations.
