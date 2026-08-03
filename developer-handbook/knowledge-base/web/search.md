---
title: 'Search'
description: 'Making content findable within your own application — full-text search in Postgres, dedicated engines, relevance, indexing pipelines and vector search.'
---

# Search

## Introduction

Search is the feature users reach for when navigation fails them, and it is
consistently under-invested. A `LIKE '%query%'` query returns something, so it
looks finished — while returning nothing for a typo, ignoring word order,
ranking by nothing in particular, and scanning the whole table.

**Why it is harder than it looks.** Users type fragments, misspellings, plurals
and synonyms. They expect the _best_ results first, not merely matching ones.
And they expect it instantly, over a dataset that keeps growing.

**The progression most applications follow**, and should:

1. **`LIKE`** — fine for an admin filter over a few thousand rows.
2. **Database full-text search** — Postgres `tsvector` handles a surprising
   amount, and needs no new infrastructure.
3. **A dedicated engine** — Meilisearch, Typesense, Elasticsearch — when
   relevance, typo tolerance and faceting matter.
4. **Vector or hybrid search** — when semantic meaning matters more than
   keywords.

**Start at the lowest level that works.** Each step adds infrastructure to
operate, a second data store to keep in sync, and a new class of failure.

---

## Why LIKE Is Not Search

```sql
SELECT * FROM products WHERE name ILIKE '%lamp%';
```

Every problem in one line:

- **Cannot use a B-tree index** — a leading wildcard forces a full scan, so cost
  grows linearly with the table.
- **No relevance ranking.** A product named "Lamp" and one mentioning lamp in
  paragraph nine are equally good.
- **No stemming.** "running" does not match "run"; "lamps" may not match "lamp".
- **No typo tolerance.** "lmap" returns nothing.
- **Word order and proximity ignored.**
- **No multi-word intelligence** — "red desk lamp" matches only that exact
  substring.

It is acceptable for an internal filter over a small table. It is not search.

---

## PostgreSQL Full-Text Search

The right next step for most applications, because it adds no infrastructure.

```sql
-- A generated, indexed search column with weighted fields
ALTER TABLE products ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX idx_products_search ON products USING gin (search_vector);
```

```sql
SELECT id, name, ts_rank(search_vector, query) AS rank
FROM products, websearch_to_tsquery('english', 'red desk lamp') AS query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 20;
```

**What you get:** stemming (searching "running" finds "run"), stop-word removal,
relevance ranking, field weighting via `setweight`, and phrase support.

**`websearch_to_tsquery` is the one to use.** It accepts what users actually
type — quoted phrases, `or`, `-excluded` — without throwing a syntax error on
punctuation, which `to_tsquery` does.

**Add typo tolerance** with trigram similarity:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);

-- Fuzzy match, useful as a fallback when full-text returns nothing
SELECT name, similarity(name, 'lmap') AS score
FROM products
WHERE name % 'lmap'
ORDER BY score DESC;
```

`pg_trgm` also makes `ILIKE '%term%'` indexable, which is a genuinely useful
trick for autocomplete on a moderate dataset.

**Where Postgres runs out:** faceted filtering with counts, typo tolerance as a
first-class feature, sub-50 ms search-as-you-type at scale, synonym management,
and per-user relevance tuning. When you are fighting it for those, move on.

---

## Dedicated Search Engines

|                          | **Meilisearch**    | **Typesense**      | **Elasticsearch / OpenSearch** |
| ------------------------ | ------------------ | ------------------ | ------------------------------ |
| Setup                    | Very simple        | Very simple        | Substantial                    |
| Typo tolerance           | Excellent, default | Excellent, default | Configurable                   |
| Speed                    | Sub-50 ms          | Sub-50 ms          | Fast, tuning required          |
| Faceting                 | Yes                | Yes                | Excellent                      |
| Analytics / aggregations | Limited            | Limited            | **Excellent**                  |
| Scale                    | Millions of docs   | Millions of docs   | Billions                       |
| Operational cost         | Low                | Low                | High                           |

**Meilisearch or Typesense** for product search, documentation search and
search-as-you-type. They are designed for relevance out of the box, and a single
binary gets you a long way.

**Elasticsearch or OpenSearch** when you need aggregations, log analytics,
complex relevance tuning, or genuinely large scale. It is powerful and it is a
distributed system with real operational weight — cluster health, shard
allocation, JVM tuning, version upgrades.

**Algolia** is the hosted option: excellent relevance and developer experience,
priced per search operation, which becomes significant at volume.

```ts
// Meilisearch — typo tolerance, faceting and ranking with little configuration
await index.updateSettings({
  searchableAttributes: ['name', 'description', 'brand'], // order sets priority
  filterableAttributes: ['category', 'price', 'inStock'],
  sortableAttributes: ['price', 'createdAt'],
  rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
});

const results = await index.search('red desk lamp', {
  filter: 'inStock = true AND price < 5000',
  facets: ['category', 'brand'],
  limit: 20,
});
```

---

## Keeping the Index in Sync

The operational problem that makes a dedicated engine more work than it first
appears. You now have **two sources of truth**, and they will diverge.

**Options, worst to best:**

**Dual writes** — write to the database and the index in the same request. Fails
exactly as the
[dual-write problem](/knowledge-base/architecture/event-driven#the-dual-write-problem)
predicts: the database commits, the index write fails, and they silently
diverge.

**Queue-based** — commit to the database, enqueue a reindex job.

```ts
await db.$transaction(async (tx) => {
  await tx.product.update({where: {id}, data});
  await tx.outbox.insert({type: 'product.updated', productId: id}); // atomic
});
// A relay reads the outbox and enqueues the reindex.
```

**Change data capture** — Debezium or a logical replication slot tails the
database's write-ahead log and streams changes. No application code involved,
and nothing can be missed.

**Whichever you choose:**

- **Reconcile periodically.** A nightly job comparing counts and checksums
  catches drift before users report it.
- **Support full reindex**, and make it safe to run — index into a new alias and
  swap atomically, so search never goes down during a rebuild.
- **Handle deletes.** The most commonly forgotten case, and it shows deleted
  products in results.
- **Do not index secrets**, and **filter by permission at query time** — a
  search index that ignores authorisation is a data-leak surface. See
  [Authorization](/knowledge-base/security/authorization).

---

## Relevance

The difference between search that works and search users abandon.

**Weight fields by importance.** A match in the title matters more than one in
the body. Postgres does this with `setweight`; engines do it by
`searchableAttributes` order.

**Combine text relevance with business signals.** Pure text scoring puts an
obscure out-of-stock item above a bestseller:

```ts
finalScore = textRelevance * 0.6 + popularity * 0.25 + recency * 0.15;
```

**Handle the empty-result case.** Returning nothing is the worst outcome —
offer spelling suggestions, relax filters, or fall back to fuzzy matching.

**Synonyms matter more than expected.** "sofa" and "couch", "trousers" and
"pants", "laptop" and "notebook". Most engines support a synonym list; build it
from queries that returned nothing.

**Measure it.** Search quality is measurable and almost nobody measures it:

- **Zero-result rate** — the clearest signal of a problem, and the easiest to
  act on.
- **Click-through rate** and **click position** — are the good results at the
  top?
- **Search refinement rate** — users retyping means the first attempt failed.
- **Search-to-conversion** — the number that matters commercially.

**Log every query, with its result count.** Your search log is the most direct
statement users ever make about what they want and cannot find.

---

## The User Experience

Search UX affects perceived quality as much as ranking does.

- **Search as you type**, debounced 150–300 ms, with results under 100 ms.
- **Highlight matched terms** in results, so relevance is visible.
- **Facets with counts** — "Lamps (24)" — and never offer a filter that would
  return zero.
- **Preserve state in the URL** so results are shareable and Back works. See
  [State Management](/knowledge-base/react-js/state-management).
- **Keyboard navigation** — arrow keys, Enter, Escape — with correct ARIA. The
  combobox pattern is genuinely fiddly; use a library. See
  [Accessibility](/knowledge-base/web/accessibility).
- **Show what was searched** and how many results, so an empty page is
  explicable.
- **Recent and popular searches** when the box is empty.

---

## Vector and Hybrid Search

Semantic search matches **meaning** rather than words. A query for "warm
lighting for reading" can match a product described as "adjustable amber desk
lamp" with no shared keywords.

```sql
CREATE EXTENSION vector;

ALTER TABLE products ADD COLUMN embedding vector(1536);
CREATE INDEX ON products USING hnsw (embedding vector_cosine_ops);

-- Nearest neighbours by cosine distance
SELECT name FROM products ORDER BY embedding <=> $1 LIMIT 20;
```

**Hybrid search is usually the right answer.** Keyword search excels at exact
matches — product codes, names, model numbers — and semantic search excels at
intent. Combining both, typically with Reciprocal Rank Fusion, beats either
alone.

**The costs are real:** generating embeddings for every document and every
query, storing high-dimensional vectors, and re-embedding everything when you
change model. Approximate nearest-neighbour indexes trade some recall for speed.

**Where it genuinely pays:** support and documentation search, where users
describe problems rather than name features; recommendations; and retrieval for
LLM applications. `pgvector` means you can try it without new infrastructure.

---

## Do's and Don'ts

### Do

- Start with Postgres full-text search before adding infrastructure.
- Use `websearch_to_tsquery` for user input.
- Weight fields, and combine text relevance with business signals.
- Log every query with its result count, and act on zero-result queries.
- Keep the index in sync through a queue or CDC, never dual writes.
- Support atomic full reindex via alias swap.
- Filter results by permission at query time.
- Debounce input and keep responses under 100 ms.
- Measure zero-result rate and click position.

### Don't

- Don't use `LIKE '%term%'` as production search.
- Don't add Elasticsearch before you have outgrown Postgres.
- Don't write to the database and the index as two independent operations.
- Don't forget deletes when syncing.
- Don't index sensitive fields, or skip authorisation on results.
- Don't return an empty page with no suggestions.
- Don't rank by text score alone.
- Don't build a custom combobox without following the ARIA pattern.

---

## Common Mistakes

**`LIKE` in production.** Slow, unranked, and unhelpful for real queries.

**Reaching for Elasticsearch immediately.** A distributed system to operate,
adopted before Postgres was even tried.

**Dual writes.** Index and database diverge silently, and nobody notices until a
user reports a deleted product in results.

**Forgetting deletes.** Removed records keep appearing.

**No reconciliation.** Drift accumulates invisibly.

**Ignoring authorisation.** Search returns documents the user cannot open — or
worse, shows their titles and snippets.

**Not logging queries.** Discarding the clearest available signal about what
users want.

**Zero results with no recovery path.** A dead end, when a suggestion or a
relaxed filter would rescue it.

**Reindexing in place.** Search degrades or breaks entirely during a rebuild.
Use an alias.

---

## Debugging

| Symptom                       | Cause and fix                                                   |
| ----------------------------- | --------------------------------------------------------------- |
| Search is slow                | `LIKE` with a leading wildcard, or a missing GIN index.         |
| Relevant results ranked low   | No field weighting, or business signals not blended in.         |
| Typos return nothing          | No typo tolerance. Add `pg_trgm`, or use an engine that has it. |
| Results include deleted items | Deletes not propagated to the index.                            |
| Index and database disagree   | Dual writes. Move to queue or CDC, and add reconciliation.      |
| `to_tsquery` syntax errors    | Raw user input. Use `websearch_to_tsquery`.                     |
| Search down during reindex    | Rebuilding in place. Index to a new name and swap the alias.    |
| Users see others' documents   | No permission filter at query time.                             |
| Many zero-result queries      | Read the log — usually synonyms or product naming.              |

---

## FAQ

**When should I move beyond Postgres full-text search?**
When you need typo tolerance as standard, faceted counts, sub-50 ms
search-as-you-type at scale, or per-user relevance tuning — and you are writing
increasing amounts of SQL to approximate them.

**Meilisearch, Typesense or Elasticsearch?**
Meilisearch or Typesense for application search — simple to run, excellent
defaults. Elasticsearch when you need aggregations, log analytics or very large
scale, and can absorb the operational cost.

**How do I handle multiple languages?**
Postgres needs a configuration per language (`to_tsvector('german', …)`).
Dedicated engines generally handle it more gracefully. Store the language with
the document.

**Should I use vector search?**
For documentation, support content and recommendations, yes — usually as hybrid
search alongside keywords. For exact-match product lookup, keyword search is
better and cheaper.

**How do I make search fast?**
Correct indexes, limit result size, cache popular queries, and keep the payload
small. Autocomplete should be a separate, narrower index.

**How do I secure search?**
Filter by permission at query time, index no secrets, and treat search as an
endpoint requiring authorisation like any other.

---

## Check your understanding

<Quiz
question="A product search uses `WHERE name ILIKE '%lamp%'`. Beyond being slow, what else is wrong?"
options={[
{
text: 'No relevance ranking, no stemming, no typo tolerance, and no multi-word intelligence — matching substrings is not the same as searching',
correct: true,
why: 'A leading wildcard also prevents index use, but the deeper problem is that every match is equally good, "lamps" may not match "lamp", and "lmap" returns nothing.',
},
{text: 'Nothing else — adding an index makes it production-ready', why: 'A B-tree cannot serve a leading wildcard at all, and an index would not add ranking or stemming.'},
{text: 'It is case-sensitive', why: 'ILIKE is explicitly case-insensitive.'},
{text: 'It only works on a single column', why: 'It can be extended across columns, which does nothing about relevance or stemming.'},
]}
explanation={<>Postgres full-text search with a <code>tsvector</code> column and a GIN index adds stemming, ranking and field weighting with no new infrastructure — the right next step before adopting a search engine.</>}
reference={{label: 'Why LIKE is not search', href: '/knowledge-base/web/search#why-like-is-not-search'}}
/>

<Quiz
question="An application writes product updates to Postgres and to Meilisearch in the same request handler. What goes wrong?"
options={[
{
text: 'This is the dual-write problem — the database commit can succeed while the index write fails, so the two diverge silently',
correct: true,
why: 'Two systems with no shared transaction. A crash or network error between them leaves the index stale, and nothing detects it until a user notices.',
},
{text: 'Nothing, provided both writes are awaited', why: 'Awaiting both does not make them atomic — the process can fail after the first succeeds.'},
{text: 'It is only a problem for deletes', why: 'Deletes are the most commonly forgotten case, and updates and creates diverge just as easily.'},
{text: 'Meilisearch cannot accept writes from an application server', why: 'It accepts writes normally; the issue is transactional consistency.'},
]}
explanation={<>Write to an outbox table in the same transaction and relay from there, or use change data capture. Either way, add a periodic reconciliation job — drift accumulates invisibly otherwise.</>}
reference={{label: 'Keeping the index in sync', href: '/knowledge-base/web/search#keeping-the-index-in-sync'}}
/>

<Quiz
question="Which signals are worth measuring to judge search quality?"
type="multiple"
options={[
{text: 'Zero-result rate', correct: true, why: 'The clearest signal of a problem and the easiest to act on — usually missing synonyms or a naming mismatch.'},
{text: 'Click position within results', correct: true, why: 'If users consistently click the seventh result, ranking is wrong.'},
{text: 'Search refinement rate', correct: true, why: 'Users retyping means the first attempt failed to express or satisfy their intent.'},
{text: 'Search-to-conversion rate', correct: true, why: 'The commercially meaningful outcome, and what relevance work should ultimately move.'},
{text: 'Total number of searches performed', why: 'A volume metric that says nothing about whether any of them succeeded.'},
]}
explanation={<>Log every query with its result count. The search log is the most direct statement users ever make about what they want and cannot find, and it is routinely discarded.</>}
reference={{label: 'Relevance', href: '/knowledge-base/web/search#relevance'}}
/>

<Quiz
question="A team wants typo tolerance and faceted counts on a 200,000-product catalogue. They currently use Postgres full-text search. What is the reasonable next step?"
options={[
{
text: 'Adopt Meilisearch or Typesense — both provide typo tolerance and faceting by default and are simple to operate at that scale',
correct: true,
why: 'These are exactly the capabilities Postgres full-text search lacks, and at 200,000 documents a single-binary engine is comfortable without distributed-systems overhead.',
},
{text: 'Deploy an Elasticsearch cluster', why: 'Capable, and substantial operational weight — cluster health, shards, JVM tuning — for requirements a lighter engine covers.'},
{text: 'Add more pg_trgm indexes and build faceting in SQL', why: 'Possible, and this is the point at which you are fighting the tool. Approximating both features in SQL is significant ongoing work.'},
{text: 'Switch to vector search', why: 'Semantic matching solves a different problem; it does not provide faceted counts, and exact product lookup gets worse.'},
]}
explanation={<>The rule is to move up only when you are actively fighting the current level. Elasticsearch earns its cost when you need aggregations, log analytics or very large scale.</>}
reference={{label: 'Dedicated search engines', href: '/knowledge-base/web/search#dedicated-search-engines'}}
/>

<Quiz
question="An internal document search returns titles and snippets for documents the current user has no permission to open. What is the flaw?"
options={[
{
text: 'The index is queried without a permission filter — search must apply authorisation at query time, because titles and snippets are themselves sensitive',
correct: true,
why: 'A search index that ignores authorisation is a data-leak surface. Even without opening a document, titles and excerpts disclose information.',
},
{text: 'Nothing — the documents themselves are still protected', why: 'Titles and snippets are disclosure in their own right, and often the most sensitive part.'},
{text: 'The documents should be removed from the index entirely', why: 'Then nobody could find them. Filter per user at query time instead.'},
{text: 'Only a problem if the search is public-facing', why: 'Internal users seeing documents they are not entitled to is exactly the failure being described.'},
]}
explanation={<>Store permission metadata alongside each document and filter on it in every query. This is the same object-level authorisation requirement as any other endpoint — search is not an exception.</>}
reference={{label: 'Keeping the index in sync', href: '/knowledge-base/web/search#keeping-the-index-in-sync'}}
/>

---

## References

- [PostgreSQL: Full Text Search](https://www.postgresql.org/docs/current/textsearch.html)
  — `tsvector`, `tsquery`, ranking and configuration.
- [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) — trigram
  similarity and indexable `ILIKE`.
- [pgvector](https://github.com/pgvector/pgvector) — vector search inside
  Postgres.
- [Meilisearch documentation](https://www.meilisearch.com/docs) — ranking rules
  and typo tolerance.
- [Typesense documentation](https://typesense.org/docs/) — the closest
  alternative.
- [Elasticsearch: Relevance](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)
  — scoring, analysis and aggregations.
- [WAI-ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
  — accessible search-as-you-type.
