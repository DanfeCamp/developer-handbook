---
title: 'Caching'
description: 'Making things faster, and the problems it creates — layers, patterns, invalidation, stampedes, keys and when not to cache at all.'
---

# Caching

## Introduction

Caching trades freshness for speed. Every cache raises the same three questions:
where it lives, how long entries survive, and how they are invalidated.

**Invalidation is the one that causes incidents.** The other two are
configuration; invalidation is design.

**Before you add a cache, be sure you need one.** A cache in front of a slow
query hides a missing index, and now you have both problems — the slow query and
a consistency question. **Profile first.** If a query takes 400 ms because it is
doing a sequential scan, the fix is the index, not Redis.

**Caching is right when:**

- The data is read far more often than written.
- Computing it is genuinely expensive and already optimised.
- Slightly stale data is acceptable — and you can say _how_ stale.

**Caching is wrong when:**

- The data must be correct to the moment (account balances, stock levels at
  checkout, permissions).
- Writes are as frequent as reads; you will never get a hit.
- The underlying operation is fast and the cache adds a network hop.

**The question that decides everything: how stale is acceptable?** Answer it in
seconds. "Fresh enough" is not an answer, and teams that never answer it end up
with caches nobody dares to change.

---

## Cache Layers

Requests pass through several caches, and each has different properties:

```
Browser cache  →  CDN  →  Reverse proxy  →  Application cache  →  Database cache
   private         edge      Nginx/Varnish      Redis/memory        buffer pool
```

| Layer             | Scope                                    | Invalidation                    |
| ----------------- | ---------------------------------------- | ------------------------------- |
| **Browser**       | One user                                 | Very hard — you cannot reach it |
| **CDN**           | All users, per region                    | Purge API or cache tags         |
| **Reverse proxy** | All users, one location                  | Config or purge module          |
| **Application**   | All instances (Redis) or one (in-memory) | Full control                    |
| **Database**      | Query results, buffer pool               | Automatic                       |

**The higher the layer, the faster and the harder to invalidate.** A browser
cache is instant and effectively permanent until it expires, which is why
`immutable` belongs only on content-hashed filenames.

**Debug from the top down.** When someone sees stale content, the question is
_which_ cache is holding it. Check the browser first with a hard reload, then the
CDN's cache status header, then the application cache. Skipping this step is why
stale-content bugs take hours.

See [CDN](/knowledge-base/hosting/cdn) for the edge layer and
[Nginx](/knowledge-base/hosting/nginx) for proxy caching.

---

## Patterns

**Cache-aside (lazy loading)** — the default, and what most people mean by
caching:

```js
async function getUser(id) {
  const key = `user:${id}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const user = await db.users.findById(id);
  if (user) await redis.set(key, JSON.stringify(user), {EX: 300});
  return user;
}
```

Simple, resilient — a cache failure degrades to a slow request rather than an
error — and it only ever caches what is actually requested. Its weakness is that
every miss hits the database, which matters under a stampede.

**Write-through** — write to cache and database together. The cache is always
warm; writes are slower, and you cache data nobody may read.

**Write-behind** — write to cache, flush to the database asynchronously. Fast
writes, and **you can lose data if the cache dies before the flush**. Use only
where that is acceptable.

**Refresh-ahead** — proactively refresh entries before they expire. Avoids the
miss entirely for predictable hot keys.

**For almost everything, cache-aside with a sensible TTL is correct.** Reach for
the others when you have a specific reason.

---

## Invalidation

Three strategies, in increasing order of precision and effort.

**1. TTL — let it expire.**

```js
await redis.set(key, value, {EX: 300});
```

The simplest thing that works, and the right default. Bounded staleness, no
coordination, no bugs. **Most caching problems are solved by an honest TTL** and
nothing more.

**2. Explicit invalidation — delete on write.**

```js
async function updateUser(id, changes) {
  const user = await db.users.update(id, changes);
  await redis.del(`user:${id}`);
  return user;
}
```

Precise, and it requires knowing every key affected by a write. That is the hard
part: updating a product should also invalidate the category listing, the search
result, the homepage feature and the sitemap. Miss one and it is stale
indefinitely.

**Delete rather than update.** Writing the new value into the cache introduces a
race — two concurrent writers can leave the cache holding the older value
permanently. Deleting means the next read repopulates from the source of truth.

**3. Versioned keys — make invalidation unnecessary.**

```js
const key = `user:${id}:v${user.updatedAt.getTime()}`;
```

Nothing is ever invalidated; new versions simply become new keys, and the old
ones expire unused. This is the same insight as content-hashed asset filenames,
and where it fits it is the most robust option available.

**Tag-based invalidation** groups keys so one operation clears everything
related. Redis has no native tagging, so it is usually implemented with a set
per tag holding the member keys.

---

## Cache Stampede

The failure mode that turns a cache into an outage.

**What happens:** a popular key expires. A thousand concurrent requests all miss,
all query the database simultaneously, and the database falls over. The cache
that was protecting your database is now the reason it is down.

**Three defences, and you usually want two of them:**

**1. Locking** — the first miss acquires a lock and recomputes; the others wait
or serve stale:

```js
async function getWithLock(key, compute, ttl = 300) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const lock = await redis.set(`lock:${key}`, '1', {NX: true, EX: 10});
  if (!lock) {
    await sleep(50);
    return getWithLock(key, compute, ttl); // retry; someone else is computing
  }

  try {
    const value = await compute();
    await redis.set(key, JSON.stringify(value), {EX: ttl});
    return value;
  } finally {
    await redis.del(`lock:${key}`);
  }
}
```

**2. Stale-while-revalidate** — serve the expired value immediately and refresh
in the background. No request ever waits, and staleness is bounded by the refresh
time.

**3. Jittered TTLs** — `300 + Math.random() * 60` seconds. Prevents keys written
together from expiring together, which is what causes synchronised stampedes
after a deploy or a cache flush.

**Warm the cache before it is needed** for known-hot keys, especially after a
deploy or a flush. A cold cache under production load is its own kind of
outage — the system worked fine yesterday and cannot survive being restarted.

---

## Keys

**Design keys deliberately** — they are the schema of your cache.

```
user:1024                    # entity
user:1024:orders:page:2      # relation, paginated
product:882:v1699887         # versioned
session:abc123               # ephemeral
```

**Rules:**

- **A consistent, documented scheme.** `user:1024`, never `getUser_1024` in one
  place and `users/1024` in another.
- **Namespace by environment**, or staging will read production's cache when
  someone points the wrong URL at it.
- **Include everything that varies the value** — locale, currency, permissions,
  feature flags. A key missing a dimension serves one variant to everyone, and
  **if that dimension is the user, it is a data leak**.
- **Hash long keys**, since some systems have length limits.
- **Never build a key from unsanitised input** — that is cache poisoning.

**The most serious caching bug is a key that omits the user.** Caching a
personalised response under a shared key serves one customer's data to another.
This has happened to large companies more than once. Any cache entry derived
from an authenticated request needs the identity in the key, or must not be
cached at all.

---

## Redis Specifics

Redis is the default application cache. Points that matter when using it as one:

**Set `maxmemory` and an eviction policy.** Without them, Redis grows until the
machine runs out of memory:

```
maxmemory 2gb
maxmemory-policy allkeys-lru
```

- `allkeys-lru` — evict least recently used. **Correct for a pure cache.**
- `volatile-lru` — evict only keys with a TTL. Correct when Redis holds both
  cache and persistent data.
- `noeviction` — writes fail when full. Correct for a queue or store, wrong for
  a cache.

**Always set a TTL.** Keys without expiry accumulate forever, and eventually
evict the ones you needed.

**`KEYS` blocks the server.** Use `SCAN`. This is the most reliable way to cause
an incident with a single command in production.

**Pipeline multiple operations** to avoid a round trip each.

**A cache miss must not be an error.** Wrap Redis calls so that a connection
failure degrades to a database query rather than a 500. Many outages have been
caused by the cache being a hard dependency nobody intended.

See [Redis](/knowledge-base/redis).

---

## Measuring

**Hit ratio is the primary metric.**

```promql
sum(rate(cache_hits_total[5m]))
  / (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m])))
```

**Interpretation:**

- **Above 90%** — the cache is doing its job.
- **50–90%** — the TTL may be too short, or the key space too wide.
- **Below 50%** — you are paying the cost of a cache without the benefit.
  Question whether it belongs there at all.

**Also track:** memory usage against `maxmemory`, eviction rate (evictions mean
the cache is too small), latency of cache operations, and the origin load you are
actually saving.

**A cache with a low hit rate is worse than no cache.** It adds a network hop, a
consistency problem and an operational dependency, in exchange for nothing.

---

## Do's and Don'ts

### Do

- Profile before caching; fix the underlying slowness first.
- Decide and document how stale is acceptable, in seconds.
- Default to cache-aside with a TTL.
- Jitter TTLs to avoid synchronised expiry.
- Delete on write rather than updating in place.
- Include every varying dimension in the key, especially identity.
- Namespace keys by environment.
- Set `maxmemory` and an eviction policy.
- Degrade gracefully when the cache is unavailable.
- Track hit ratio and eviction rate.

### Don't

- Don't cache to hide a missing index.
- Don't cache authenticated responses under a shared key.
- Don't cache without a TTL.
- Don't use `KEYS` in production.
- Don't make the cache a hard dependency.
- Don't use write-behind for data you cannot lose.
- Don't cache data that must be exact.
- Don't let all keys expire at the same moment.
- Don't cache at every layer without knowing which one you will debug.

---

## Common Mistakes

**Caching around a missing index.** The query is still slow; you have added a
consistency problem to a performance problem.

**Stampede on expiry.** A hot key expires, a thousand requests miss at once, the
database falls over.

**Missing a dimension in the key.** One user sees another's data — the most
serious caching bug there is.

**Incomplete invalidation.** The product updates; the category page does not.

**Updating instead of deleting.** A race leaves the cache permanently holding the
older value.

**No `maxmemory`.** Redis consumes the machine.

**Cache as a hard dependency.** Redis restarts and the application returns 500s.

**Synchronised TTLs.** Everything expires together after a deploy.

**Caching everything.** More layers than anyone can reason about, and a
stale-content bug that takes a day to locate.

---

## Debugging

| Symptom                      | Where to look                                          |
| ---------------------------- | ------------------------------------------------------ |
| Stale content                | Which layer? Browser → CDN → proxy → application       |
| Low hit ratio                | TTL too short, or keys too specific                    |
| Memory growing               | Keys without TTL; check with `redis-memory-usage`      |
| High eviction rate           | `maxmemory` too low for the working set                |
| Database spikes periodically | Synchronised TTL expiry — add jitter                   |
| One user sees another's data | Key missing an identity dimension. **Fix immediately** |
| Cache misses after deploy    | Cold cache; warm hot keys, or use versioned keys       |
| Redis latency spikes         | `KEYS`, a large value, or swapping                     |

**Isolate the layer first.** A hard reload eliminates the browser; the CDN's
cache status header eliminates the edge; querying Redis directly for the key
tells you what the application cache holds. Most time lost to stale-content bugs
is spent looking at the wrong layer.

---

## FAQ

**Redis or in-memory?**
In-memory is faster and per-instance, so multiple instances hold divergent
copies. Redis is shared and consistent across instances. Use in-memory for small
immutable reference data, Redis for everything else.

**How long should a TTL be?**
As long as the staleness you can tolerate. Five minutes suits a great deal of
content. Seconds for near-real-time data. Hours for reference data that rarely
changes.

**Should I cache database queries or objects?**
Objects, generally — they survive query changes and are reusable across call
sites.

**How do I cache paginated results?**
Include the page and page size in the key, and prefer cursor pagination, whose
keys are stable as data changes. See
[Pagination](/knowledge-base/apis/pagination).

**Can I cache personalised content?**
Yes, with the user in the key — and check the memory cost, since a per-user cache
is as large as your user base. Alternatively cache the shared shell and fetch the
personalised parts separately.

**What about cache warming?**
Worth it for known-hot keys after a deploy or a flush. A cold cache under
production load can be an outage in its own right.

---

## Check your understanding

<Quiz
question="A query takes 400 ms because it performs a sequential scan on a large table. The team puts Redis in front of it. What have they done?"
options={[
{
text: 'Hidden a missing index behind a cache — the slow query still runs on every miss, and they now also own a consistency problem',
correct: true,
why: 'Caching does not make the underlying operation faster; it makes it happen less often. Every miss, every eviction and every invalidation pays the original cost.',
},
{text: 'Correctly optimised the read path', why: 'Optimising means fixing the scan. Caching an unoptimised query is treating the symptom.'},
{text: 'Reduced database load with no downside', why: 'The downside is staleness, invalidation complexity and a new operational dependency.'},
{text: 'Made the query faster', why: 'The query is unchanged — it simply runs less often.'},
]}
explanation={<>Profile first and fix the underlying slowness. Then cache if the data is read far more often than written, the operation is genuinely expensive, and you can state in seconds how stale is acceptable.</>}
reference={{label: 'Introduction', href: '/knowledge-base/operations/caching#introduction'}}
/>

<Quiz
question="A popular cache key expires at peak traffic. A thousand concurrent requests miss simultaneously and the database becomes overloaded. What is this, and how is it prevented?"
options={[
{
text: 'A cache stampede — prevented with locking so only one request recomputes, stale-while-revalidate, and jittered TTLs',
correct: true,
why: 'On expiry every concurrent reader misses at once and each independently recomputes, so the cache that was protecting the database becomes the reason it fails.',
},
{text: 'Cache poisoning — prevented by validating key inputs', why: 'Poisoning is an attacker controlling cached content, a different problem entirely.'},
{text: 'An eviction storm — prevented by raising maxmemory', why: 'Evictions are memory pressure; this key expired normally.'},
{text: 'Normal cache behaviour that requires a larger database', why: 'Scaling the database to survive a preventable thundering herd is an expensive way to avoid a fix.'},
]}
explanation={<>Jittered TTLs — <code>300 + Math.random() * 60</code> — also stop keys written together from expiring together, which is what produces synchronised stampedes after a deploy or a cache flush.</>}
reference={{label: 'Cache stampede', href: '/knowledge-base/operations/caching#cache-stampede'}}
/>

<Quiz
question="Why should a write invalidate a cache entry by deleting it rather than writing the new value into it?"
options={[
{
text: 'Writing introduces a race — two concurrent writers can interleave so the cache is left holding the older value permanently',
correct: true,
why: 'Deleting means the next read repopulates from the source of truth, which is always correct. Writing races against other writers with no ordering guarantee.',
},
{text: 'Deleting is faster than setting a value', why: 'A marginal difference, and not the reason.'},
{text: 'Redis does not support overwriting an existing key', why: 'It does, straightforwardly.'},
{text: 'Deleting resets the TTL correctly', why: 'Setting a value also sets a TTL; the issue is correctness under concurrency.'},
]}
explanation={<>The harder half of explicit invalidation is knowing every key a write affects: updating a product should also clear the category listing, search results and homepage feature. Miss one and it stays stale indefinitely — which is why an honest TTL solves most caching problems on its own.</>}
reference={{label: 'Invalidation', href: '/knowledge-base/operations/caching#invalidation'}}
/>

<Quiz
question="Which of these are correct when using Redis as an application cache?"
type="multiple"
options={[
{text: 'Setting maxmemory with an allkeys-lru eviction policy', correct: true, why: 'Without a limit Redis grows until the machine runs out of memory; allkeys-lru is the right policy for a pure cache.'},
{text: 'Wrapping cache calls so a Redis failure degrades to a database query', correct: true, why: 'A cache miss must never be an error. Many outages come from the cache being a hard dependency nobody intended.'},
{text: 'Setting a TTL on every key', correct: true, why: 'Keys without expiry accumulate indefinitely and eventually evict the ones you needed.'},
{text: 'Using SCAN rather than KEYS to enumerate keys', correct: true, why: 'KEYS blocks the entire server — the most reliable way to cause an incident with one command.'},
{text: 'Using the noeviction policy so cached data is never lost', why: 'Writes then fail once memory is full. That is correct for a queue or store and wrong for a cache, where losing a cold entry is harmless.'},
]}
explanation={<>The through-line: a cache is a performance optimisation, and it must be able to fail without taking the application with it.</>}
reference={{label: 'Redis specifics', href: '/knowledge-base/operations/caching#redis-specifics'}}
/>

<Quiz
question="A cache key for a product page is `product:882:page`, and the page content varies by the viewer's currency and logged-in status. What is the consequence?"
options={[
{
text: 'One variant is served to everyone — and because logged-in status varies the content, one user can be served another user\'s personalised page',
correct: true,
why: 'A key that omits a dimension the value depends on collapses several distinct responses into one entry. When the omitted dimension is identity, it becomes a data leak.',
},
{text: 'The cache hit ratio drops because the key is too generic', why: 'The hit ratio rises — that is precisely the problem, since the hits are wrong.'},
{text: 'Redis rejects writes where the value varies between requests', why: 'Redis has no knowledge of how the value was derived.'},
{text: 'The entry expires early because of conflicting writes', why: 'Conflicting writes overwrite each other; the TTL is unaffected.'},
]}
explanation={<>Include every varying dimension in the key — locale, currency, permissions, feature flags — and treat identity as non-negotiable. Any entry derived from an authenticated request either carries the user in the key or must not be cached at all.</>}
reference={{label: 'Keys', href: '/knowledge-base/operations/caching#keys'}}
/>

---

## References

- [MDN: HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)
  — the browser and shared-cache layers.
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html) — the
  normative semantics.
- [Redis: key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
  — `maxmemory` policies explained.
- [Redis caching patterns](https://redis.io/docs/latest/develop/use-cases/caching/)
  — cache-aside, write-through and the rest.
- [AWS: Caching best practices](https://aws.amazon.com/caching/best-practices/)
  — layers, TTLs and invalidation.
- [CDN](/knowledge-base/hosting/cdn) — the edge layer in detail.
