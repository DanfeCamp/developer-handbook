---
title: 'Redis'
description: 'An in-memory data store — data types, caching patterns, eviction, persistence, distributed locks, queues and the mistakes that cause outages.'
---

# Redis

## Introduction

Redis is an in-memory data structure server. Not a key-value cache that happens
to be fast — a server exposing **data structures** (strings, hashes, lists,
sets, sorted sets, streams) over a network, with atomic operations on each.

**Why it is fast.** Everything is in RAM, and command execution is
single-threaded, so there are no locks and no contention. A single instance
handles well over 100,000 operations per second, with sub-millisecond latency.

**The single-threaded part matters.** One slow command blocks every other client.
`KEYS *` on a million-key database is not slow for the caller — it is slow for
_everyone_, and it is the classic Redis outage.

**Where it fits:** caching, sessions, rate limiting, leaderboards, job queues,
pub/sub, distributed locks, real-time counters, and short-lived data with a
natural expiry.

**Where it does not:** as a primary database for anything you cannot lose, for
data larger than RAM, or for complex queries — there is no query planner and no
joins.

:::note Licensing
Redis changed licence in 2024 (RSAL/SSPL), prompting the Linux Foundation fork
**Valkey**, which is a drop-in replacement backed by AWS, Google and Oracle.
Redis subsequently added AGPL as an option from Redis 8. Most managed
"Redis-compatible" services now run Valkey. Everything on this page applies to
both.
:::

---

## Data Types

Choosing the right structure is most of using Redis well.

### Strings

The simplest, and not only for text — a string holds up to 512 MB of anything,
including serialised JSON and binary.

```bash
SET user:1:name "Ada"
SET session:abc '{"userId":1}' EX 3600   # with a TTL, atomically
GET user:1:name
INCR page:views                          # atomic counter
INCRBY cart:1:total 2499
SET lock:job NX EX 30                    # set only if absent — the basis of a lock
```

`INCR` is atomic, which is why Redis is the standard answer for counters that
several processes update.

### Hashes

A map of fields to values under one key. Better than a serialised JSON string
when you update individual fields, because you can write one field without
reading and rewriting the whole object.

```bash
HSET user:1 name "Ada" email "ada@example.com" logins 42
HGET user:1 email
HINCRBY user:1 logins 1
HGETALL user:1
```

### Lists

Ordered, with push and pop at both ends — a queue or a stack.

```bash
LPUSH queue:emails '{"to":"ada@example.com"}'
RPOP queue:emails
BRPOP queue:emails 30           # block up to 30s waiting for work
LRANGE recent:posts 0 9         # ten most recent
LTRIM recent:posts 0 99         # keep the list bounded
```

`LTRIM` after `LPUSH` is the idiom for a capped "recent items" list.

### Sets and sorted sets

```bash
SADD post:1:tags "redis" "caching"
SISMEMBER post:1:tags "redis"       # O(1) membership
SINTER user:1:follows user:2:follows  # mutual follows

ZADD leaderboard 4200 "ada" 3900 "grace"
ZREVRANGE leaderboard 0 9 WITHSCORES   # top ten
ZRANK leaderboard "ada"                 # this player's position
ZREMRANGEBYSCORE ratelimit:ip 0 1690000000   # drop entries outside the window
```

**Sorted sets are Redis's most distinctive structure.** A leaderboard, a
sliding-window rate limiter, a priority queue and a time-ordered index are all
the same primitive.

### Streams

An append-only log with consumer groups — Kafka-like semantics inside Redis:

```bash
XADD events * type purchase orderId 1024
XREADGROUP GROUP workers worker-1 COUNT 10 STREAMS events >
XACK events workers 1690000000-0
```

Unlike a list-based queue, streams give you **at-least-once delivery with
acknowledgement**, replay, and multiple independent consumer groups. Prefer them
over `LPUSH`/`BRPOP` for anything where losing a job matters. For very high
throughput or long retention, see [Apache Kafka](/knowledge-base/kafka).

### Other structures

`SETBIT`/`BITCOUNT` for compact boolean flags, `PFADD`/`PFCOUNT` (HyperLogLog)
for approximate unique counts in 12 KB regardless of cardinality, and
`GEOADD`/`GEOSEARCH` for radius queries.

---

## Caching

The most common use, and the patterns are worth naming.

### Cache-aside

The default. The application checks the cache, and on a miss loads from the
database and populates it.

```python
def get_product(product_id):
    key = f"product:{product_id}"

    cached = redis.get(key)
    if cached is not None:
        return json.loads(cached)

    product = db.query("SELECT * FROM products WHERE id = %s", product_id)
    redis.set(key, json.dumps(product), ex=300)   # ALWAYS set a TTL
    return product
```

**Always set a TTL.** A cache entry with no expiry is a memory leak and a
guarantee of eventually serving stale data.

### Invalidation

Two strategies, and you should choose deliberately:

- **TTL only** — accept staleness up to the TTL. Simple, and correct for most
  read-heavy data.
- **Explicit invalidation** — delete the key when the underlying data changes.
  Correct, and easy to miss a write path.

```python
def update_product(product_id, data):
    db.update(...)
    redis.delete(f"product:{product_id}")   # every write path must do this
```

Naming keys with a version prefix (`v2:product:1`) lets you invalidate an entire
category by bumping the version — far safer than trying to enumerate keys.

### The three failure modes

**Cache stampede** (or dogpile). A popular key expires, and a thousand
concurrent requests all miss and all hit the database at once. Mitigate with a
short lock so one request repopulates while others wait or serve stale, or by
adding jitter to TTLs so keys do not expire together.

**Cache penetration.** Requests for keys that do not exist bypass the cache
every time. Cache the negative result briefly (`ex=60`).

**Cache avalanche.** Many keys expiring simultaneously — typically because they
were all populated at once after a deploy. Randomise TTLs: `ex=300 + random(60)`.

See [Caching](/knowledge-base/operations/caching) for the wider treatment.

---

## Rate Limiting

A canonical Redis use, and worth showing properly because the naive version is
wrong.

```lua
-- Sliding window, atomic via a Lua script.
-- KEYS[1] = bucket key, ARGV = now, window, limit
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])
local count = redis.call('ZCARD', KEYS[1])
if count < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1] .. ':' .. math.random())
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
```

The naive `INCR` then `EXPIRE` has a race: if the process dies between the two,
the key never expires and that client is blocked forever. A **Lua script runs
atomically** on the server, which removes the whole class of problem.

The simpler fixed-window version is fine when approximate limits are acceptable:

```bash
SET ratelimit:ip:1.2.3.4 0 EX 60 NX
INCR ratelimit:ip:1.2.3.4
```

---

## Distributed Locks

Redis is often used for "only one process should do this at a time". Get the
details right or the lock does not lock.

```python
import uuid

token = str(uuid.uuid4())

# Atomic: set only if absent, with an expiry. Never SETNX then EXPIRE separately.
acquired = redis.set("lock:report", token, nx=True, ex=30)

if acquired:
    try:
        generate_report()
    finally:
        # Release only if we still hold it — check and delete atomically.
        redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] "
            "then return redis.call('del', KEYS[1]) else return 0 end",
            1, "lock:report", token,
        )
```

Three rules, each fixing a real failure:

1. **Set the expiry atomically with the value.** Otherwise a crash between the
   two leaves a lock nobody can release.
2. **Store a unique token** and check it before deleting. Otherwise a process
   whose lock already expired deletes the lock now held by someone else.
3. **Choose the TTL longer than the work.** If the work outlives the lock, two
   processes run concurrently — which is the thing you were preventing.

:::warning A Redis lock is not a correctness guarantee
Under network partitions, clock drift or a failover to a replica that has not
received the lock, two clients can hold "the same" lock. This is fine for
avoiding duplicate work; it is **not** sufficient where correctness depends on
mutual exclusion. For that, use a database transaction or a unique constraint,
which cannot be defeated by a partition.
:::

---

## Memory, Eviction and Persistence

### Eviction

Redis holds everything in memory. **Set `maxmemory` and an eviction policy**, or
Redis will consume all available RAM and then start refusing writes — or be
killed by the OOM killer.

```ini
maxmemory 4gb
maxmemory-policy allkeys-lru
```

| Policy         | Behaviour                                              |
| -------------- | ------------------------------------------------------ |
| `noeviction`   | Refuse writes when full. **The default**               |
| `allkeys-lru`  | Evict least recently used. **Right for a pure cache**  |
| `allkeys-lfu`  | Evict least frequently used — better for skewed access |
| `volatile-lru` | Evict only keys with a TTL                             |
| `volatile-ttl` | Evict the keys expiring soonest                        |

The default `noeviction` surprises people: a cache that fills up starts throwing
errors instead of making room. If Redis is a cache, use `allkeys-lru` or
`allkeys-lfu`. If it holds data you cannot lose, use `volatile-*` so untagged
keys survive — and reconsider whether Redis is the right home for it.

### Persistence

| Mode     | What it does                     | Trade                                                                 |
| -------- | -------------------------------- | --------------------------------------------------------------------- |
| **RDB**  | Periodic point-in-time snapshots | Compact and fast to restore; loses everything since the last snapshot |
| **AOF**  | Appends every write command      | Much smaller loss window; larger files, slower restart                |
| **Both** | Snapshots plus the log           | The usual production choice                                           |

With `appendfsync everysec` — the sensible default — the worst case is losing
one second of writes.

Even so: **treat Redis as a cache unless you have deliberately engineered
otherwise.** Your application should survive Redis being empty. If it cannot,
you have a database with an eviction policy.

---

## Operations

**Redis Sentinel** provides automatic failover for a primary/replica pair.
**Redis Cluster** shards data across nodes with 16,384 hash slots.

Cluster has a constraint worth knowing early: **a multi-key command only works
when all keys are on the same node.** Hash tags force related keys together:

```bash
MSET {user:1}:name "Ada" {user:1}:email "ada@example.com"
# The braces mark the part used for hashing, so both keys land on one node.
```

Commands that must never run in production:

```bash
KEYS *        # O(N), blocks the entire server. Use SCAN
FLUSHALL      # deletes everything
SAVE          # blocking snapshot. Use BGSAVE
DEBUG SLEEP   # exactly what it sounds like
```

Rename or disable them:

```ini
rename-command KEYS ""
rename-command FLUSHALL ""
```

`SCAN` is the safe iterator — cursor-based, non-blocking, and it may return
duplicates, which is the price of not stopping the world:

```bash
SCAN 0 MATCH "session:*" COUNT 100
```

**Monitoring:**

```bash
redis-cli INFO memory        # used_memory, fragmentation, evicted_keys
redis-cli INFO stats         # keyspace_hits vs keyspace_misses
redis-cli --latency          # round-trip latency
redis-cli SLOWLOG GET 10     # the ten slowest recent commands
redis-cli --bigkeys          # find keys large enough to cause latency spikes
```

The hit ratio (`keyspace_hits / (hits + misses)`) tells you whether the cache is
earning its place. `SLOWLOG` finds the command that is blocking everyone else.

### Pipelining

Every command is a network round trip. Sending a hundred individually costs a
hundred round trips; pipelining sends them together:

```python
pipe = redis.pipeline()
for user_id in user_ids:
    pipe.hgetall(f"user:{user_id}")
results = pipe.execute()     # one round trip
```

This is often a larger win than any server-side tuning. `MGET`, `MSET` and
`HMGET` do the same for their specific cases.

---

## Security

Redis is designed to run on a trusted network, and its defaults reflect that.
Unauthenticated internet-exposed instances have been a persistent source of
breaches.

- **Never expose it to the internet.** Bind to a private interface, firewall the
  port.
- **Require a password** (`requirepass`) — a long random one, since Redis can
  process tens of thousands of guesses per second.
- **Use ACLs** (Redis 6+) so each application gets only the commands and key
  patterns it needs:

  ```bash
  ACL SETUSER webapp on >secret ~cache:* +get +set +del
  ```

- **TLS** for connections crossing a network boundary.
- **Rename or disable dangerous commands.**
- **Do not store secrets or personal data** without thinking about it — data is
  in memory, in snapshots, and in `MONITOR` output.

---

## Do's and Don'ts

### Do

- Set a TTL on every cache key.
- Set `maxmemory` and an appropriate eviction policy.
- Use the right structure — a sorted set instead of sorting in the application.
- Pipeline batches of commands.
- Use Lua scripts for multi-step atomic operations.
- Use `SCAN`, never `KEYS`.
- Add jitter to TTLs so keys do not expire together.
- Design the application to survive Redis being empty.

### Don't

- Don't run `KEYS`, `FLUSHALL` or `SAVE` in production.
- Don't store large values — a 100 MB value blocks the server while it is
  serialised.
- Don't rely on a Redis lock where correctness genuinely depends on mutual
  exclusion.
- Don't use `SETNX` followed by a separate `EXPIRE`.
- Don't leave `maxmemory` unset.
- Don't treat Redis as durable storage.
- Don't expose it without authentication.
- Don't cache without deciding how entries are invalidated.

---

## Debugging

| Symptom                           | Cause and fix                                                                |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Latency spikes for all clients    | A slow command blocking the single thread. `SLOWLOG GET`.                    |
| "OOM command not allowed"         | `maxmemory` reached with `noeviction`. Set an eviction policy or add memory. |
| Keys vanish unexpectedly          | Eviction under memory pressure, or a TTL you forgot. Check `evicted_keys`.   |
| Memory keeps growing              | Keys without TTLs. `--bigkeys` and a `SCAN` audit.                           |
| Database load spikes periodically | Cache stampede on a popular key, or synchronised TTL expiry.                 |
| CROSSSLOT error in Cluster        | A multi-key command spanning nodes. Use hash tags.                           |
| Lock held forever                 | `SETNX` without an expiry, or the process died before releasing.             |
| Cache hit ratio low               | TTLs too short, keys too granular, or eviction under pressure.               |

---

## FAQ

**Redis or Memcached?**
Redis, almost always — it does everything Memcached does plus data structures,
persistence, replication and scripting. Memcached is simpler and multi-threaded,
which occasionally matters for a pure cache under very high load.

**Redis or Valkey?**
Functionally equivalent. Valkey is the Linux Foundation fork with a permissive
licence and is what most managed services now run. Choose on licensing and your
provider.

**Can Redis be my primary database?**
Redis Stack and modules make it possible, and it is rarely the right call.
Memory is expensive, queries are limited, and the durability story is weaker
than a disk-first database.

**How do I cache things larger than memory?**
You do not — Redis is memory-bound. Cache the hot subset, and let eviction
handle the rest.

**Pub/Sub or Streams?**
Pub/Sub is fire-and-forget: a subscriber that is offline misses the message
entirely. Streams persist, support consumer groups and acknowledgement, and can
be replayed. Use Streams for anything that matters.

**Why is my Redis slow when the server looks idle?**
Almost always a single slow command blocking the thread, or a network round trip
per operation that should be pipelined.

---

## Check your understanding

<Quiz
question="A monitoring script runs `KEYS session:*` every 30 seconds against a Redis instance with two million keys. Application latency spikes on the same schedule. Why?"
options={[
{
text: 'Redis executes commands on a single thread, and KEYS is O(N) — it blocks every other client until it finishes scanning all two million keys',
correct: true,
why: 'The single-threaded model means one slow command stalls the whole server. SCAN iterates with a cursor in small batches without blocking.',
},
{text: 'KEYS locks the keyspace for writes but allows reads', why: 'There is no partial locking — the single thread is occupied entirely.'},
{text: 'The pattern match is slow because it is not indexed', why: 'Redis has no secondary indexes; the cost is scanning every key, not the matching itself.'},
{text: 'Two million keys is beyond Redis’s capacity', why: 'Two million keys is unremarkable. The problem is the command, not the key count.'},
]}
explanation={<>Rename <code>KEYS</code> to an empty string in production configuration so it cannot be run by accident. <code>SCAN</code> may return duplicates — that is the trade for not blocking.</>}
reference={{label: 'Operations', href: '/knowledge-base/redis#operations'}}
/>

<Quiz
question="A distributed lock is acquired with SETNX and then EXPIRE as two commands. What can go wrong?"
options={[
{
text: 'If the process crashes between the two commands, the lock has no expiry and is held forever',
correct: true,
why: 'The two operations are not atomic. Use SET key value NX EX seconds, which sets the value and expiry in one atomic command.',
},
{text: 'SETNX is deprecated and no longer works', why: 'It still works — the problem is that a separate EXPIRE is not atomic with it.'},
{text: 'EXPIRE resets the value', why: 'It sets a TTL and leaves the value unchanged.'},
{text: 'Nothing, provided the TTL is long enough', why: 'No TTL is ever applied if the process dies first, so length is irrelevant.'},
]}
explanation={<>Two further rules complete a correct lock: store a unique token and check it before deleting (so you never release someone else's lock), and remember that a Redis lock is best-effort — it prevents duplicate work, not correctness violations.</>}
reference={{label: 'Distributed locks', href: '/knowledge-base/redis#distributed-locks'}}
/>

<Quiz
question="A Redis instance used purely as a cache starts returning 'OOM command not allowed when used memory > maxmemory'. Why, and what is the fix?"
options={[
{
text: 'The eviction policy is the default noeviction, so Redis refuses writes rather than making room — set allkeys-lru',
correct: true,
why: 'noeviction is the default and is correct for a datastore, not a cache. A cache should evict the least valuable keys when full.',
},
{text: 'maxmemory is set too low and must be removed', why: 'Removing it lets Redis consume all system RAM until the OOM killer intervenes — considerably worse.'},
{text: 'Redis needs restarting to clear memory', why: 'A restart empties the cache temporarily; the same thing happens again once it refills.'},
{text: 'Persistence is consuming the memory', why: 'Snapshotting forks and can raise peak memory, but it is not why writes are refused.'},
]}
explanation={<>Choose the policy from the role: <code>allkeys-lru</code> or <code>allkeys-lfu</code> for a pure cache, <code>volatile-*</code> when some keys must survive — and if some keys must never be evicted, question whether Redis is the right home for them.</>}
reference={{label: 'Eviction', href: '/knowledge-base/redis#eviction'}}
/>

<Quiz
question="Which Redis structure best fits each job?"
type="multiple"
options={[
{text: 'Sorted set for a leaderboard with rank queries', correct: true, why: 'ZADD/ZREVRANGE/ZRANK give ordering and position lookup as a single primitive.'},
{text: 'Sorted set for a sliding-window rate limiter', correct: true, why: 'Score by timestamp, drop entries outside the window with ZREMRANGEBYSCORE, count with ZCARD.'},
{text: 'Hash for an object whose individual fields are updated', correct: true, why: 'HSET writes one field without reading and rewriting the whole serialised object.'},
{text: 'Stream for a job queue where losing a job matters', correct: true, why: 'Consumer groups give at-least-once delivery with acknowledgement and replay — unlike a list.'},
{text: 'Pub/Sub for notifications that must reach every subscriber', why: 'Pub/Sub is fire-and-forget: an offline subscriber misses the message permanently. Use a Stream.'},
]}
explanation={<>Choosing the right structure is most of using Redis well — the sorted set in particular replaces a surprising amount of application code.</>}
reference={{label: 'Data types', href: '/knowledge-base/redis#data-types'}}
/>

<Quiz
question="After a deploy, the database is hit by a burst of identical queries every five minutes, in sync. Redis is in front of it. What is happening?"
options={[
{
text: 'Cache avalanche — the cache was repopulated all at once after the deploy, so a large set of keys share an expiry time and all miss together',
correct: true,
why: 'Identical TTLs set at the same moment expire at the same moment. Adding jitter (300 + random(60) seconds) spreads the expiries.',
},
{text: 'Redis is evicting keys because maxmemory is reached', why: 'Eviction is driven by memory pressure and would not produce a precise five-minute rhythm.'},
{text: 'The Redis connection pool is being recycled every five minutes', why: 'Reconnecting does not clear the keyspace.'},
{text: 'The database is rejecting cached results', why: 'Databases have no visibility into or influence over your cache.'},
]}
explanation={<>Related failure modes: a <em>stampede</em>, where one hot key expires and many concurrent requests all recompute it (fix with a short lock or serve-stale-while-revalidating), and <em>penetration</em>, where misses for non-existent keys bypass the cache entirely (fix by caching the negative result briefly).</>}
reference={{label: 'The three failure modes', href: '/knowledge-base/redis#the-three-failure-modes'}}
/>

---

## References

- [Redis documentation](https://redis.io/docs/latest/) — commands, data types,
  and their complexity.
- [Redis command reference](https://redis.io/docs/latest/commands/) — every
  command with its Big-O cost, which is worth checking before using one.
- [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/) —
  policies and how the approximation works.
- [Distributed locks with Redis](https://redis.io/docs/latest/develop/use-cases/patterns/distributed-locks/)
  — including the honest discussion of the guarantees.
- [Valkey](https://valkey.io/) — the Linux Foundation fork.
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
  — RDB, AOF and their trade-offs.
