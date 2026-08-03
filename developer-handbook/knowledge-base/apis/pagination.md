---
title: 'Pagination'
description: 'Returning large collections without returning all of them — offset vs cursor, the deep-offset problem, stable ordering, and API conventions.'
---

# Pagination

## Introduction

Pagination splits a large collection into pages. It sounds trivial, and it is
the source of two recurring production problems: an endpoint that returns
everything and takes the site down, and an endpoint that quietly skips or
duplicates rows.

**Why it matters more than it looks.** An unpaginated list works perfectly in
development with 40 rows and fails in production with 400,000 — slow query,
large payload, exhausted memory. Meanwhile the obvious implementation
(`LIMIT/OFFSET`) has two defects that only appear at scale: it gets slower the
deeper you go, and it produces incorrect results when the underlying data
changes between requests.

There are two real strategies. Choosing between them is the whole decision.

---

## Offset Pagination

Skip N rows, take M.

```sql
SELECT * FROM orders ORDER BY placed_at DESC LIMIT 20 OFFSET 40;   -- page 3
```

```text
GET /orders?page=3&per_page=20
GET /orders?limit=20&offset=40
```

**What it gets right:** it is trivial to implement, it lets a user jump to page
57, and you can show "page 3 of 128" — which some interfaces genuinely need.

### Problem one: it gets slower with depth

`OFFSET 100000` does not skip cheaply. The database must **produce and discard**
100,000 rows before returning 20. Cost grows linearly with the offset, so page 1
is instant and page 5,000 times out.

```text
OFFSET 0       →   2 ms
OFFSET 10000   →  45 ms
OFFSET 100000  → 400 ms
OFFSET 1000000 →  4 s
```

An index does not fix this. The rows must still be walked.

### Problem two: it is wrong when data changes

Pages are computed independently, so an insert or delete between requests shifts
every subsequent row.

```text
Page 1 (rows 1–20)  →  user reads them
   ← a new order arrives and sorts to position 1
Page 2 (rows 21–40) →  row 20 has become row 21, so the user sees it twice
```

Deletes cause the mirror image: rows shift up and an item is **skipped
entirely**. On a fast-moving feed this is not an edge case, and it is a real bug
when the pages drive a background job that processes every record.

---

## Cursor Pagination

Instead of "skip 40", say "give me the 20 after this specific row".

```sql
SELECT * FROM orders
WHERE (placed_at, id) < ('2026-08-01 10:00:00', '9f2b…')   -- the cursor
ORDER BY placed_at DESC, id DESC
LIMIT 20;
```

```text
GET /orders?limit=20&cursor=eyJwbGFjZWRfYXQiOiIyMDI2LTA4LTAxVDEwOjAwOjAwWiIsImlkIjoiOWYyYiJ9
```

```json
{
  "data": [...],
  "page": {"next_cursor": "eyJwbGFjZWRfYXQiOi…", "has_more": true}
}
```

**Constant time at any depth.** The `WHERE` clause seeks directly into the index
and reads 20 rows. Page 50,000 costs the same as page 1.

**Stable under concurrent writes.** The cursor names a position in the data, not
a count of rows. New rows arriving at the top do not shift what comes after your
cursor, so nothing is duplicated or skipped.

**Also called keyset pagination or seek pagination** — the same technique.

### The tie-break is mandatory

This is the detail people miss. If the sort column is not unique, rows sharing a
value can be skipped or repeated at page boundaries.

```sql
-- ❌ Broken: many orders share the same placed_at second
WHERE placed_at < '2026-08-01 10:00:00' ORDER BY placed_at DESC

-- ✅ Add a unique tie-breaker, and compare as a tuple
WHERE (placed_at, id) < ('2026-08-01 10:00:00', '9f2b…')
ORDER BY placed_at DESC, id DESC
```

The composite comparison `(a, b) < (x, y)` is the correct form. PostgreSQL and
MySQL both support row-value comparison directly; where it is unavailable,
expand it:

```sql
WHERE placed_at < :ts OR (placed_at = :ts AND id < :id)
```

**Index it to match:** `CREATE INDEX ON orders (placed_at DESC, id DESC)`. The
index order must match the sort order, or the database sorts in memory and the
benefit disappears.

### Encoding the cursor

Encode it as an opaque string so clients treat it as a token rather than
something to construct:

```ts
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());
```

**Base64 is encoding, not encryption** — a client can read and modify it. If the
cursor carries anything sensitive, or if a tampered cursor could expose data,
sign it (HMAC) or store server-side state. Always validate a decoded cursor
before putting its values into a query.

### What you give up

- **No page numbers.** You cannot offer "page 57 of 300", or a total count
  without a separate expensive query.
- **Forward and backward only.** Bidirectional needs a `before` cursor as well.
- **The sort is fixed by the cursor.** Changing sort order invalidates it.

---

## Choosing

|                      | Offset            | Cursor               |
| -------------------- | ----------------- | -------------------- |
| Deep pages           | Degrades linearly | Constant time        |
| Correct under writes | No                | Yes                  |
| Jump to page N       | Yes               | No                   |
| Total count          | Easy              | Expensive or omitted |
| Implementation       | Trivial           | Moderate             |

**Use cursor pagination by default** for APIs, infinite scroll, feeds, exports
and anything a background job iterates. It is the only correct choice when data
changes while being read.

**Offset is fine** for an admin table over a small, slow-changing dataset where
users genuinely want page numbers — and cap the maximum page so nobody can
request `?page=500000`.

**A hybrid works well:** offset for the first few pages where users expect page
numbers, switching to cursors beyond a threshold.

---

## API Conventions

Whatever you choose, be consistent across every endpoint.

```json
{
  "data": [...],
  "page": {
    "next_cursor": "eyJpZCI6MTAyNH0",
    "prev_cursor": null,
    "has_more": true,
    "limit": 20
  }
}
```

- **Always paginate.** No collection endpoint should be able to return
  everything.
- **A default and a maximum limit.** Default 20, maximum 100. Without a maximum,
  `?limit=1000000` is a denial-of-service vector.
- **Validate `limit`** as a positive integer within range.
- **Return `has_more`** rather than making clients infer it from a short page —
  which is ambiguous when the last page happens to be exactly full.
- **Never return a bare array.** Wrap it, so pagination metadata has a home.

### Link headers

RFC 8288 `Link` headers are an alternative used by GitHub and others:

```http
Link: <https://api.example.com/orders?cursor=abc>; rel="next",
      <https://api.example.com/orders?cursor=xyz>; rel="prev"
```

Metadata stays out of the body, and clients follow links rather than
constructing URLs. Body metadata is more common and easier for most clients to
consume; either is fine, consistently applied.

### GraphQL

The **Relay connection specification** is the convention, and it is cursor-based
by design:

```graphql
query {
  orders(first: 20, after: "eyJpZCI6MTAyNH0") {
    edges { cursor node { id reference totalPence } }
    pageInfo { hasNextPage endCursor }
  }
}
```

Use it even without Relay — every GraphQL client tool understands it. See
[GraphQL](/knowledge-base/apis/graphql).

---

## Total Counts

`COUNT(*)` over a large filtered table is often slower than the page query
itself, and it is usually requested out of habit.

Options, cheapest first:

1. **Do not return one.** "Load more" and infinite scroll do not need it, and
   most users never look at it.
2. **`has_more`** — fetch `limit + 1` rows; if you got an extra, there is more.
   One row of overhead, no count.
3. **An approximate count.** PostgreSQL's `reltuples` from `pg_class` is instant
   and roughly right for an unfiltered table.
4. **A cached count**, recomputed periodically.
5. **An exact count**, only when a filtered index makes it cheap and the product
   genuinely requires it.

```sql
-- Approximate, instant, unfiltered
SELECT reltuples::bigint FROM pg_class WHERE relname = 'orders';
```

"About 12,000 results" is what search engines show, because the exact number is
not worth the query.

---

## Related Patterns

**Infinite scroll** is cursor pagination in the UI. Keep the cursor in the URL
so the position survives a refresh and a shared link — otherwise a user who
scrolls twenty pages and reloads loses everything. See
[React state management](/knowledge-base/react-js/state-management).

**Batch processing** — iterating every row in a job — must use cursors.
Offset-based iteration over a table being written to will skip records, and the
skipped ones are silently never processed.

```python
cursor = None
while True:
    rows = fetch_page(after=cursor, limit=1000)
    if not rows:
        break
    process(rows)
    cursor = rows[-1].cursor
```

**Time-based cursors** suit feeds naturally, and still need a unique tie-break
because timestamps collide.

**Search results** are a genuine exception: relevance-ranked results from
Elasticsearch or similar often use offset, because scores are recomputed per
query and there is no stable key to seek on. `search_after` is Elasticsearch's
cursor equivalent, and deep offset is capped by default for the same reason it
is slow in SQL.

---

## Do's and Don'ts

### Do

- Paginate every collection endpoint.
- Default to cursor pagination.
- Include a unique tie-breaker in the sort and the cursor.
- Index in the same order as the sort, including direction.
- Enforce a maximum limit.
- Return `has_more` explicitly.
- Encode cursors as opaque tokens, and validate them on the way in.
- Use cursors for any job that iterates a whole table.

### Don't

- Don't return an unbounded collection.
- Don't use deep `OFFSET` — it degrades linearly and is wrong under writes.
- Don't sort on a non-unique column without a tie-break.
- Don't let clients choose an unbounded `limit`.
- Don't return a bare JSON array.
- Don't compute an exact total count by reflex.
- Don't put unsigned sensitive data in a cursor.
- Don't change sort order without invalidating existing cursors.

---

## Debugging

| Symptom                                | Cause and fix                                                  |
| -------------------------------------- | -------------------------------------------------------------- |
| Users see duplicate items across pages | Offset pagination with concurrent inserts. Switch to cursors.  |
| A batch job misses records             | Offset iteration over a changing table. Use cursors.           |
| Page 1 fast, page 500 times out        | Deep `OFFSET`. Switch to keyset pagination.                    |
| Items skipped only at page boundaries  | Non-unique sort column with no tie-break.                      |
| Cursor pagination still slow           | The index does not match the sort order and direction.         |
| `has_more` is wrong on the last page   | Inferring from row count. Fetch `limit + 1` instead.           |
| Endpoint occasionally returns 2 GB     | No maximum limit. Cap it.                                      |
| Cursor works then fails after a deploy | The cursor format or default sort changed. Version the cursor. |

---

## FAQ

**Can I offer page numbers with cursor pagination?**
Not directly. Offer "load more", or use a hybrid — offset for the first few
pages, cursors beyond.

**How do I paginate backwards?**
Accept a `before` cursor, reverse the comparison and the `ORDER BY`, then
reverse the results before returning them.

**What if the client sends an invalid cursor?**
Return `400`. Never fall back to the first page silently — a client looping
until `has_more` is false would never terminate.

**Should the cursor be encrypted?**
Signed, if tampering could expose data. Base64 is not a security boundary — a
client can decode and modify it, so validate the contents server-side
regardless.

**Does this apply to GraphQL?**
Yes — use the Relay connection shape, which is cursor-based by design.

**What about sorting by a user-selected column?**
The cursor must include that column plus a unique tie-break, and the index must
match. Support a small, fixed set of sortable columns; arbitrary sorting means
arbitrary indexes.

---

## Check your understanding

<Quiz
question="A feed uses `LIMIT 20 OFFSET ?`. Users report occasionally seeing the same post twice on consecutive pages. Why?"
options={[
{
text: 'New posts inserted between the two requests shift every row down, so an item on page 1 moves to position 21 and appears again on page 2',
correct: true,
why: 'Offset pages are computed independently against the current data. An insert above the window shifts everything after it, causing duplicates; a delete causes skips.',
},
{text: 'The database returns rows in a non-deterministic order', why: 'A real problem when ORDER BY is absent or non-unique, but the duplication here is caused by the offset shifting.'},
{text: 'The client is caching page 1 and re-rendering it', why: 'The user is receiving the same item genuinely twice from the server.'},
{text: 'The page size is too small', why: 'The size does not matter; any offset-based window shifts when rows are inserted above it.'},
]}
explanation={<>Cursor pagination fixes it structurally: the cursor names a position in the data rather than counting rows, so rows arriving above it change nothing about what follows.</>}
reference={{label: 'Offset pagination', href: '/knowledge-base/apis/pagination#problem-two-it-is-wrong-when-data-changes'}}
/>

<Quiz
question="A cursor-paginated endpoint sorts by created_at only. Some records are never returned. What is wrong?"
options={[
{
text: 'created_at is not unique — records sharing a timestamp straddle the page boundary and the strict comparison skips the rest of that group',
correct: true,
why: 'With WHERE created_at < :cursor, every row sharing the boundary timestamp is excluded. A unique tie-break compared as a tuple fixes it.',
},
{text: 'The limit is too small to include them', why: 'Limit affects page size, not which rows are eligible.'},
{text: 'The cursor should be encrypted', why: 'Encryption is about tampering, not correctness of the range comparison.'},
{text: 'created_at needs an index', why: 'An index affects speed. Missing rows is a correctness bug in the comparison.'},
]}
explanation={<>Always pair the sort column with a unique tie-break and compare as a tuple: <code>(created_at, id) &lt; (:ts, :id)</code>, with an index on <code>(created_at DESC, id DESC)</code> matching both column order and direction.</>}
reference={{label: 'The tie-break is mandatory', href: '/knowledge-base/apis/pagination#the-tie-break-is-mandatory'}}
/>

<Quiz
question="Which of these are correct reasons to prefer cursor over offset pagination?"
type="multiple"
options={[
{text: 'Query cost stays constant regardless of how deep the page is', correct: true, why: 'The WHERE clause seeks into the index and reads the page. OFFSET must produce and discard every preceding row.'},
{text: 'Results remain correct when rows are inserted or deleted during iteration', correct: true, why: 'The cursor names a position in the data rather than a row count, so no duplication or skipping.'},
{text: 'It is the only safe approach for a job iterating an entire table', correct: true, why: 'Offset iteration over a table being written to silently skips records that are then never processed.'},
{text: 'It lets users jump directly to page 57', why: 'The opposite — cursors are sequential by nature. That is offset’s one genuine advantage.'},
{text: 'It makes returning an exact total count cheaper', why: 'Unrelated. A total count is expensive either way, which is why has_more is usually preferable.'},
]}
explanation={<>The trade is page numbers and totals for correctness and constant-time depth. For APIs and feeds that is almost always the right way round.</>}
reference={{label: 'Choosing', href: '/knowledge-base/apis/pagination#choosing'}}
/>

<Quiz
question="An endpoint accepts `?limit=` with no upper bound. What is the risk?"
options={[
{
text: 'A client requesting limit=1000000 can exhaust server memory and saturate the database — a denial-of-service vector',
correct: true,
why: 'Unbounded page size means one request can materialise the entire table into memory and serialise it. Enforce a maximum, typically 100.',
},
{text: 'Nothing, provided the database has an index', why: 'An index makes finding rows fast; it does not stop a million of them being loaded and serialised.'},
{text: 'Only that the response is slow for that one client', why: 'The memory and database load affect every concurrent user of that instance.'},
{text: 'It breaks cursor encoding', why: 'Unrelated to how the cursor is encoded.'},
]}
explanation={<>Validate <code>limit</code> as a positive integer, clamp it to a documented maximum, and return <code>400</code> rather than silently truncating so clients learn the constraint.</>}
reference={{label: 'API conventions', href: '/knowledge-base/apis/pagination#api-conventions'}}
/>

<Quiz
question="A product manager asks for 'X of Y results' on a filtered list over 40 million rows. The count query takes 6 seconds. What is the best response?"
options={[
{
text: 'Offer has_more via fetching limit + 1, and an approximate count if a number is genuinely needed',
correct: true,
why: 'An exact filtered count often costs more than the page itself. One extra row gives has_more for free, and approximate counts are what search engines show.',
},
{text: 'Add an index to make COUNT(*) fast', why: 'An index helps some counts, but an arbitrary filtered count over 40 million rows generally still scans.'},
{text: 'Cache the exact count for one hour', why: 'A reasonable fallback, though it goes stale and needs a job — try has_more first.'},
{text: 'Return the count asynchronously in a second request', why: 'Moves the 6 seconds elsewhere without reducing it, and adds a request.'},
]}
explanation={<>Exact totals are usually requested out of habit. "Load more" and infinite scroll need only <code>has_more</code>, and users rarely read the total.</>}
reference={{label: 'Total counts', href: '/knowledge-base/apis/pagination#total-counts'}}
/>

---

## References

- [Use The Index, Luke: Paging Through Results](https://use-the-index-luke.com/no-offset)
  — the definitive explanation of why offset degrades, and the keyset
  alternative.
- [Relay connection specification](https://relay.dev/graphql/connections.htm) —
  the cursor convention for GraphQL.
- [RFC 8288: Web Linking](https://www.rfc-editor.org/rfc/rfc8288.html) — the
  `Link` header format.
- [GitHub REST API pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
  — a widely imitated implementation.
- [Stripe API pagination](https://docs.stripe.com/api/pagination) — cursor
  pagination with `starting_after` / `ending_before`.
- [Elasticsearch: paginate search results](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html)
  — `search_after` and why deep offset is capped.
