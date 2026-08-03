---
title: 'MySQL'
description: 'A widely deployed relational database — InnoDB, indexing and the clustered index, EXPLAIN, replication, and the gotchas that catch people coming from PostgreSQL.'
---

# MySQL

## Introduction

MySQL is the most widely deployed open-source relational database, largely
because it arrived with PHP and became the default on shared hosting. That
history still shapes it: enormous ecosystem, excellent replication, and a
handful of legacy behaviours that surprise people arriving from PostgreSQL.

**Where it fits.** Read-heavy web applications, WordPress and the wider PHP
ecosystem, and anywhere the hosting or the existing stack already assumes it.
Its replication story is mature and battle-tested, and read scaling with
replicas is straightforward.

**Where PostgreSQL is stronger.** Richer types, better handling of complex
analytical queries, extensions, and a stricter default posture about data
correctness. For a greenfield project with a free choice,
[PostgreSQL](/knowledge-base/databases/postgresql) is usually the better
default.

:::note Versions and the fork
Written against **MySQL 9.7 LTS** (July 2026). Oracle also ships an
"Innovation" track under calendar versioning (26.x), which moves faster and has
a shorter support window — **choose LTS for production** unless you need
something specific from Innovation.

**MariaDB is a fork**, created after Oracle's acquisition of Sun. It is largely
but not entirely compatible; they have diverged on JSON, some system tables and
several optimiser behaviours. Check which one you are actually running before
following any advice, including this page.
:::

---

## InnoDB and the Clustered Index

InnoDB is the storage engine — transactional, crash-safe, row-locking, and the
default since 5.5. **MyISAM is legacy**: no transactions, no foreign keys,
table-level locking. If you find it in an existing database, plan to migrate.

The most important structural fact about InnoDB, and the one that differs most
from PostgreSQL:

**The table _is_ the primary key index.** Rows are stored physically in primary
key order inside a B-tree — a _clustered index_. Every secondary index stores
the primary key value, not a row pointer.

Three consequences follow directly:

1. **Primary key order determines physical layout.** Sequential keys append to
   the end of the tree; random keys insert everywhere, splitting pages. This is
   why UUIDv4 primary keys hurt InnoDB even more than they hurt Postgres.
2. **A secondary index lookup does two traversals** — find the primary key in
   the secondary index, then find the row in the clustered index. A _covering_
   index that satisfies the query outright avoids the second.
3. **A wide primary key inflates every secondary index**, because each one
   stores a copy of it.

```sql
CREATE TABLE orders (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  status      VARCHAR(20) NOT NULL,
  total_pence BIGINT NOT NULL,
  placed_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_user_placed (user_id, placed_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

If you need a UUID, store it as `BINARY(16)` rather than `CHAR(36)` — a third of
the size in every index — and use a time-ordered version (UUIDv7 or ULID) so
inserts stay sequential.

---

## Types and the utf8mb4 Trap

```sql
CREATE DATABASE app CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

**`utf8` in MySQL is not UTF-8.** It is a three-byte subset that cannot store
emoji, many CJK characters or anything outside the Basic Multilingual Plane.
Inserting one either throws or silently truncates depending on strict mode.
**Always use `utf8mb4`**, which is real UTF-8. This has caught out an enormous
number of applications.

| Type                | Notes                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `BIGINT UNSIGNED`   | Surrogate keys. `INT` overflows at 2.1 billion — a real outage cause    |
| `DECIMAL(12,2)`     | Money. Never `FLOAT` or `DOUBLE`                                        |
| `DATETIME(6)`       | Absolute times. `TIMESTAMP` is range-limited and timezone-converted     |
| `VARCHAR(n)`        | Strings. Unlike Postgres, the length does affect storage and index size |
| `TEXT` / `LONGTEXT` | Large strings, stored off-page                                          |
| `JSON`              | Validated and indexable via generated columns                           |
| `BINARY(16)`        | UUIDs, compactly                                                        |
| `ENUM`              | Works, but altering it rewrites the table                               |

**`DATETIME` versus `TIMESTAMP`** is a genuine decision. `TIMESTAMP` is stored
as UTC and converted to the session timezone on read — convenient, but limited
to 1970–2038. `DATETIME` stores exactly what you give it with no conversion.
Store UTC explicitly in a `DATETIME(6)` and convert in the application; that
behaves predictably across replicas with different session settings.

### Strict mode

Historically MySQL would silently coerce bad data — truncating strings, turning
an invalid date into `0000-00-00`, storing `0` for a failed number conversion.
Modern versions default to `STRICT_TRANS_TABLES`, which errors instead. **Verify
it is on**, especially on an inherited system:

```sql
SELECT @@sql_mode;
```

---

## Indexing

The fundamentals are shared with every B-tree engine — see
[Data Modelling](/knowledge-base/databases/data-modelling#indexes) for the
leftmost-prefix rule and the things that silently disable an index. MySQL
specifics:

```sql
-- Covering index: satisfied entirely from the index, no clustered lookup
ALTER TABLE orders ADD KEY idx_cover (user_id, status, placed_at, total_pence);

-- Prefix index for a long column, when the first N characters are selective
ALTER TABLE users ADD KEY idx_email_prefix (email(20));

-- Functional index (8.0.13+) — before this, you needed a generated column
ALTER TABLE users ADD KEY idx_lower_email ((LOWER(email)));

-- Descending index (8.0+) — genuinely descending, not just readable
ALTER TABLE posts ADD KEY idx_created_desc (created_at DESC);

-- Invisible index: keep it defined but hide it from the optimiser, to test
-- whether dropping it is safe
ALTER TABLE orders ALTER INDEX idx_old INVISIBLE;
```

**Invisible indexes are an underused operational tool.** Before dropping an index
you suspect is unused, make it invisible. If nothing regresses over a few days,
drop it — and if something does, one `ALTER` restores it instantly, with no
rebuild.

```sql
-- Indexes nobody has used (requires sys schema)
SELECT * FROM sys.schema_unused_indexes;
-- Queries doing full scans
SELECT * FROM sys.statements_with_full_table_scans LIMIT 20;
```

The `sys` schema is MySQL's most underused feature — a set of readable views
over `performance_schema` that answer most diagnostic questions directly.

---

## EXPLAIN

```sql
EXPLAIN SELECT * FROM orders WHERE status = 'pending';
EXPLAIN ANALYZE SELECT …;                    -- 8.0.18+: actually runs it
EXPLAIN FORMAT=JSON SELECT …;                -- full cost detail
```

Reading the classic output, the `type` column matters most — best to worst:

| `type`             | Meaning                                                      |
| ------------------ | ------------------------------------------------------------ |
| `const` / `eq_ref` | One row via a unique index. Ideal                            |
| `ref`              | Index lookup returning several rows. Good                    |
| `range`            | Index range scan. Fine                                       |
| `index`            | Full **index** scan — better than a table scan, still a scan |
| **`ALL`**          | **Full table scan.** On a large table, usually the problem   |

Also check `key` (which index was chosen, `NULL` meaning none), `rows` (the
estimate — a big gap from reality means stale statistics, fixed with
`ANALYZE TABLE`), and `Extra` for `Using filesort` and `Using temporary`, which
indicate sorting or grouping that the index could not satisfy.

`Using index` in `Extra` is the good one: a covering index, no clustered lookup.

---

## Transactions and Locking

InnoDB defaults to **REPEATABLE READ**, unlike PostgreSQL's READ COMMITTED. A
transaction sees a consistent snapshot from its first read, so two identical
`SELECT`s in the same transaction return the same rows even if another
transaction committed in between.

```sql
START TRANSACTION;
SELECT total_pence FROM accounts WHERE id = 1 FOR UPDATE;   -- lock the row
UPDATE accounts SET total_pence = total_pence - 500 WHERE id = 1;
UPDATE accounts SET total_pence = total_pence + 500 WHERE id = 2;
COMMIT;
```

**Gap locks** are the MySQL-specific surprise. Under REPEATABLE READ, InnoDB
locks not just matching rows but the gaps between index entries, to prevent
phantom inserts. A `SELECT … FOR UPDATE` on a range can therefore block inserts
into that range — and two transactions locking overlapping ranges in different
orders deadlock.

Deadlocks are normal and expected under concurrency. **Applications must retry
them**, not treat them as fatal:

```sql
SHOW ENGINE INNODB STATUS;   -- LATEST DETECTED DEADLOCK section
```

`SELECT … FOR UPDATE SKIP LOCKED` (8.0+) is the right primitive for a job queue:
each worker claims rows nobody else holds, with no contention.

---

## Setup

```bash
docker run -d -e MYSQL_ROOT_PASSWORD=dev -p 3306:3306 mysql:9.7
brew install mysql          # macOS
sudo apt install mysql-server
```

```bash
mysql -u root -p
SHOW DATABASES;  SHOW TABLES;  DESCRIBE orders;  SHOW CREATE TABLE orders\G
SHOW PROCESSLIST;            -- what is running now
```

```ini title="my.cnf"
[mysqld]
innodb_buffer_pool_size = 8G        # ~70% of RAM on a dedicated server. The key setting
innodb_log_file_size = 1G           # larger = better write throughput
innodb_flush_log_at_trx_commit = 1  # 1 = fully durable. Do not lower it casually
innodb_flush_method = O_DIRECT

character-set-server = utf8mb4
collation-server = utf8mb4_0900_ai_ci
sql_mode = STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION

slow_query_log = 1
long_query_time = 0.5
max_connections = 200
```

**`innodb_buffer_pool_size` is the single most important setting.** It is
InnoDB's cache for data and indexes; if the working set fits in it, reads come
from memory. The default is 128 MB, which is wrong on any real server.

`innodb_flush_log_at_trx_commit = 1` means every commit is flushed to disk —
full ACID durability. Setting it to `2` is noticeably faster and loses up to a
second of committed transactions on an OS crash. That is a deliberate trade, not
a tuning tip.

---

## Replication

MySQL's strongest operational feature.

- **Asynchronous** (default) — the primary does not wait for replicas. Fast, and
  a failover can lose recently committed transactions.
- **Semi-synchronous** — the primary waits for at least one replica to
  acknowledge. Slower, much smaller data-loss window.
- **Group Replication / InnoDB Cluster** — multi-primary with automatic
  failover.

**GTIDs (global transaction identifiers)** make failover and replica
repositioning far easier than binlog file-and-position coordinates. Enable them.

Read replicas are the standard way to scale reads, with one caveat that causes
real bugs: **replication lag**. A write to the primary followed immediately by a
read from a replica may not see it. Route reads that must be current — a
just-submitted form, a redirect after create — to the primary.

```sql
SHOW REPLICA STATUS\G     -- Seconds_Behind_Source is the number to alarm on
```

---

## Backups

```bash
# Logical, consistent, with binlog position for point-in-time recovery
mysqldump --single-transaction --routines --triggers \
          --source-data=2 --all-databases > backup.sql

# Physical, much faster to restore on a large database
xtrabackup --backup --target-dir=/backup
```

`--single-transaction` is what makes a `mysqldump` of an InnoDB database
consistent without locking every table. Without it, a dump of a live database
can contain a mixture of states.

Point-in-time recovery needs **binary logs** as well as a base backup — restore
the backup, then replay the binlog to the moment before the mistake.

Test restores on a schedule. An untested backup is a hypothesis.

---

## Performance Workflow

1. **Enable the slow query log** with `long_query_time = 0.5`, then aggregate it
   with `pt-query-digest`. It ranks by total time, which is the right metric.
2. **Check `sys.statements_with_full_table_scans`** and
   `sys.schema_unused_indexes`.
3. **`EXPLAIN`** the worst offender; look for `type: ALL` and `Using filesort`.
4. **Fix the index**, or the query.
5. **Verify `innodb_buffer_pool_size`** is sized for the working set.

Common wins:

- Fix the N+1 in the application first.
- Add a covering index so hot queries never touch the clustered index.
- Replace `OFFSET` pagination with keyset pagination — `LIMIT 100000, 20` reads
  and discards 100,000 rows. See [Pagination](/knowledge-base/apis/pagination).
- Avoid `SELECT *` when a covering index would otherwise serve the query.
- Batch inserts rather than issuing them one per row.

---

## Do's and Don'ts

### Do

- Use InnoDB and `utf8mb4` everywhere.
- Use a small, sequential primary key; `BINARY(16)` with UUIDv7 if you need a
  UUID.
- Size `innodb_buffer_pool_size` for your working set.
- Verify strict mode is enabled.
- Use `EXPLAIN` and the `sys` schema rather than guessing.
- Enable GTIDs before you need to fail over.
- Retry deadlocks in application code.
- Use `--single-transaction` when dumping InnoDB.

### Don't

- Don't use `utf8` — it is not UTF-8.
- Don't use MyISAM.
- Don't use `CHAR(36)` for UUIDs, or a random UUID as the primary key.
- Don't use `INT` for a table that could exceed 2.1 billion rows.
- Don't store money in `FLOAT`.
- Don't read your own writes from a replica.
- Don't lower `innodb_flush_log_at_trx_commit` without accepting the data-loss
  window.
- Don't use `LIMIT offset, n` for deep pagination.

---

## Debugging

| Symptom                                 | Cause and fix                                                               |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Emoji or CJK text breaks                | The column or connection is `utf8`, not `utf8mb4`.                          |
| Deadlock found when trying to get lock  | Normal under concurrency. Retry; check `SHOW ENGINE INNODB STATUS`.         |
| Lock wait timeout exceeded              | A long transaction holding locks. Find it in `SHOW PROCESSLIST`.            |
| Query slow after data growth            | `type: ALL` in EXPLAIN — missing index, or stale stats (`ANALYZE TABLE`).   |
| Replica falling behind                  | Single-threaded apply, or a large transaction. Enable parallel replication. |
| "Data truncated" or a zero date         | Strict mode off, or was off when the data was written.                      |
| Reads miss a just-written row           | Replication lag. Route read-after-write to the primary.                     |
| Server using far less RAM than expected | `innodb_buffer_pool_size` still at its 128 MB default.                      |

```sql
SELECT * FROM sys.session WHERE command != 'Sleep' ORDER BY time DESC;
SHOW ENGINE INNODB STATUS\G
KILL QUERY 12345;
```

---

## FAQ

**MySQL or MariaDB?**
MariaDB is more open in governance and has some features earlier; MySQL has
Oracle's engineering and is what most managed services run. They have diverged
enough that you should pick one and test against it rather than assuming
compatibility.

**LTS or Innovation?**
LTS for production — longer support, fewer behavioural changes. Innovation only
if you need a specific new capability and can absorb faster upgrades.

**Why is my `utf8` column broken?**
Because MySQL's `utf8` is a three-byte subset of UTF-8 that cannot represent
emoji or many CJK characters. `utf8mb4` is the real thing.

**Do I still need to worry about MyISAM?**
Only in legacy systems. It has no transactions and locks whole tables. Convert
to InnoDB.

**How do I scale reads?**
Read replicas, and route read-only traffic to them — while keeping
read-after-write on the primary. Add a caching layer
([Redis](/knowledge-base/redis)) before adding more replicas.

**Is JSON support good?**
Adequate. Values are validated and can be indexed via generated columns, but
PostgreSQL's `jsonb` with GIN indexing is more capable. Do not choose MySQL for
a document-heavy workload.

---

## Check your understanding

<Quiz
question="An application stores emoji in a VARCHAR column and they arrive as ??? or throw an error. What is wrong?"
options={[
{
text: "The column or connection uses MySQL's utf8, a three-byte subset that cannot represent characters outside the Basic Multilingual Plane",
correct: true,
why: 'MySQL\'s utf8 is not UTF-8. Emoji are four-byte characters and need utf8mb4, which is the real encoding.',
},
{text: 'VARCHAR cannot store multi-byte characters', why: 'It can, given the right character set — the character set is the problem, not the type.'},
{text: 'The column is too short', why: 'A length problem truncates the end of a string; it does not corrupt specific characters.'},
{text: 'Strict mode needs disabling to allow the insert', why: 'Disabling strict mode would silently corrupt the data instead of erroring — the opposite of a fix.'},
]}
explanation={<>Fix it at every layer: the database, the table, the column and the client connection charset. A correct column reached over a <code>utf8</code> connection still mangles the data.</>}
reference={{label: 'Types and the utf8mb4 trap', href: '/knowledge-base/databases/mysql#types-and-the-utf8mb4-trap'}}
/>

<Quiz
question="Why does a random UUID primary key hurt InnoDB more than it hurts PostgreSQL?"
options={[
{
text: 'InnoDB clusters the table on the primary key, so random keys scatter physical row inserts across the whole B-tree, not just an index',
correct: true,
why: 'The table is the primary key index. Random keys cause page splits in the table itself and inflate every secondary index, each of which stores a copy of the primary key.',
},
{text: 'InnoDB cannot index UUID columns', why: 'It can. The problem is insert locality, not indexability.'},
{text: 'MySQL has no UUID type, so they are stored as text', why: 'True by default, and a real cost — but BINARY(16) solves the size issue while leaving the clustering problem.'},
{text: 'PostgreSQL automatically converts UUIDv4 to a sequential form', why: 'It does not. UUIDv7 must be chosen deliberately in either engine.'},
]}
explanation={<>Use a sequential <code>BIGINT UNSIGNED</code>, or <code>BINARY(16)</code> holding a UUIDv7 or ULID — non-enumerable and still sequential enough to append.</>}
reference={{label: 'InnoDB and the clustered index', href: '/knowledge-base/databases/mysql#innodb-and-the-clustered-index'}}
/>

<Quiz
question="A user submits a form, is redirected to a detail page, and sometimes sees 'not found'. Writes go to the primary and reads to a replica. Why?"
options={[
{
text: 'Replication lag — the replica has not yet applied the write when the read arrives',
correct: true,
why: 'Asynchronous replication means the primary commits without waiting. Read-after-write must be routed to the primary, or the read must wait for the replica to catch up.',
},
{text: 'The transaction was never committed', why: 'Then the row would be permanently missing, not intermittently.'},
{text: 'The replica has a different schema', why: 'That would produce consistent errors, not intermittent misses on recent rows.'},
{text: 'Query cache is returning a stale result', why: 'The query cache was removed in MySQL 8.0, and it would not explain a missing new row.'},
]}
explanation={<>The general rule for read replicas: route <em>read-after-write</em> to the primary. Semi-synchronous replication narrows the window but does not close it.</>}
reference={{label: 'Replication', href: '/knowledge-base/databases/mysql#replication'}}
/>

<Quiz
question="Which of these are legitimate uses of MySQL 8.0+ features for operational safety?"
type="multiple"
options={[
{text: 'Making an index INVISIBLE to test whether dropping it is safe', correct: true, why: 'The optimiser ignores it while the definition remains, so a regression is undone with one ALTER rather than a rebuild.'},
{text: 'SELECT … FOR UPDATE SKIP LOCKED for a job queue', correct: true, why: 'Each worker claims rows no other worker holds, avoiding contention entirely.'},
{text: 'EXPLAIN ANALYZE to see real execution timings', correct: true, why: 'Available from 8.0.18, it runs the query and reports actual costs rather than estimates.'},
{text: 'sys schema views to find unused indexes and full table scans', correct: true, why: 'Readable views over performance_schema that answer most diagnostic questions directly.'},
{text: 'Setting innodb_flush_log_at_trx_commit = 0 to improve safety', why: 'The opposite: 0 and 2 trade durability for speed, widening the window of committed transactions lost on a crash.'},
]}
explanation={<>Invisible indexes and <code>SKIP LOCKED</code> are the two most underused MySQL 8 features in application code.</>}
reference={{label: 'Indexing', href: '/knowledge-base/databases/mysql#indexing'}}
/>

<Quiz
question="EXPLAIN reports type: ALL and Using filesort for a query on a 5-million-row table. What does that tell you?"
options={[
{
text: 'The query scans every row and sorts the result outside any index — almost certainly a missing or unusable index covering the WHERE and ORDER BY',
correct: true,
why: 'type: ALL is a full table scan. Using filesort means the sort could not be satisfied by index order. A composite index on the filter column followed by the sort column usually fixes both.',
},
{text: 'The table needs OPTIMIZE TABLE to defragment it', why: 'Defragmentation may help marginally, but it does not give the optimiser an index it does not have.'},
{text: 'filesort means MySQL is writing to a temporary file, so more disk is the fix', why: 'filesort does not necessarily involve a file — it means sorting outside the index. More disk does not address the cause.'},
{text: 'The buffer pool is too small', why: 'A small buffer pool makes a scan slower; it is not why the optimiser chose a scan.'},
]}
explanation={<>Index order matters: put the equality column first and the <code>ORDER BY</code> column second, so one index serves both the filter and the sort.</>}
reference={{label: 'EXPLAIN', href: '/knowledge-base/databases/mysql#explain'}}
/>

---

## References

- [MySQL 9.x Reference Manual](https://dev.mysql.com/doc/refman/9.0/en/) — the
  authoritative documentation.
- [InnoDB storage engine](https://dev.mysql.com/doc/refman/9.0/en/innodb-storage-engine.html)
  — clustered indexes, locking, tuning.
- [The sys schema](https://dev.mysql.com/doc/refman/9.0/en/sys-schema.html) —
  diagnostic views worth learning.
- [Optimization](https://dev.mysql.com/doc/refman/9.0/en/optimization.html) —
  EXPLAIN output and index strategy.
- [Percona Toolkit](https://www.percona.com/software/database-tools/percona-toolkit)
  — `pt-query-digest` and online schema change.
- [Use The Index, Luke](https://use-the-index-luke.com/) — indexing principles,
  with MySQL specifics.
