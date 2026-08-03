---
title: 'MongoDB'
description: 'A document database, and how to model data for it — embedding vs referencing, indexes, the aggregation pipeline, transactions and production operation.'
---

# MongoDB

## Introduction

MongoDB stores **documents** — BSON objects, essentially JSON with more types —
grouped into collections. There is no fixed schema, related data can be nested
inside a single document, and a query can retrieve a whole object graph in one
read.

**The problem it solves.** When your data is genuinely document-shaped — a
product with variable attributes, an event payload, a CMS page with arbitrary
blocks — modelling it relationally means either a wide sparse table or an
entity-attribute-value schema, both of which are unpleasant. A document maps
directly.

**The correction to make first.** MongoDB's early reputation was built on
"schemaless, scales easily, no joins needed". In practice:

- **Schemaless does not mean structureless.** Your application has a schema
  whether or not the database enforces one. Use schema validation.
- **Modelling matters more, not less.** Relational schemas have normal forms to
  guide you. Document design has judgement, and bad judgement is expensive
  because the shape is baked into every document.
- **It has joins** (`$lookup`), transactions (since 4.0) and strong consistency
  by default. Advice written before 2019 is often wrong.

**Where it fits:** genuinely variable document shapes, high write throughput
with horizontal sharding, event and log storage, catalogues with heterogeneous
attributes, and rapid prototyping where the shape is still moving.

**Where a relational database fits better:** data that is fundamentally
relational, workloads needing multi-entity transactions routinely, ad-hoc
reporting across many entities, or when
[PostgreSQL's `jsonb`](/knowledge-base/databases/postgresql#jsonb) would give
you documents _and_ relations in one store — which for many applications it
does.

:::note Version
Written against **MongoDB 8.2** (December 2025). Note the licence: MongoDB uses
the **SSPL**, which is not OSI-approved and restricts offering it as a managed
service. It is fine for normal application use; check with legal if you are
building a hosting product.
:::

---

## Modelling: Embed or Reference

This is the whole discipline, and the decision that determines whether MongoDB
performs well.

### Embed when

- The data is **accessed together**. If you always load an order with its items,
  embed the items.
- The child **has no independent life**. An address belongs to a user.
- The relationship is **one-to-few** and bounded.
- The child does not change independently or often.

```js
// Embedded: one read gets everything the order page needs
{
  _id: ObjectId("..."),
  reference: "ORD-1024",
  status: "paid",
  customer: { name: "Ada Lovelace", email: "ada@example.com" },
  items: [
    { sku: "DESK-01", name: "Desk lamp", quantity: 2, pricePence: 2499 },
    { sku: "BULB-02", name: "LED bulb",  quantity: 1, pricePence: 599 }
  ],
  placedAt: ISODate("2026-08-03T10:00:00Z")
}
```

Note that `name` and `pricePence` are copied into the item. That is correct: an
order line must record the price _at the time of purchase_, not today's price.

### Reference when

- The related data is **large or unbounded**. Comments on a popular post,
  events for a user.
- It is **shared** between many parents.
- It **changes independently**.
- You need to query it on its own.

```js
// Post document
{ _id: ObjectId("p1"), title: "…", authorId: ObjectId("u1") }

// Comments in their own collection
{ _id: ObjectId("c1"), postId: ObjectId("p1"), body: "…", createdAt: … }
```

### The 16 MB limit is a design signal

A document cannot exceed 16 MB. Long before you approach it, an **unbounded
array** is already a problem: documents that grow get moved on disk, indexes on
huge arrays become expensive, and you cannot paginate inside a document
efficiently.

**The rule: never embed an array that grows without bound.** A "recent items"
array capped at 20 is fine. "All comments" is not.

The **extended reference** pattern is the common compromise — reference the
child, but duplicate the two or three fields you always display:

```js
{
  _id: ObjectId("o1"),
  customerId: ObjectId("u1"),
  customerName: "Ada Lovelace",   // duplicated to avoid a lookup on every render
  ...
}
```

You are trading a join for the cost of updating the copy when the name changes.
That is usually a good trade, and you must decide explicitly how the copy stays
correct.

---

## Schema Validation

"Schemaless" is not a reason to accept malformed documents:

```js
db.createCollection("orders", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["reference", "status", "totalPence", "placedAt"],
      properties: {
        reference:  { bsonType: "string", pattern: "^ORD-[0-9]+$" },
        status:     { enum: ["pending", "paid", "shipped", "cancelled"] },
        totalPence: { bsonType: "long", minimum: 0 },
        items: {
          bsonType: "array",
          maxItems: 100,
          items: {
            bsonType: "object",
            required: ["sku", "quantity"],
            properties: { quantity: { bsonType: "int", minimum: 1 } }
          }
        }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});
```

This gives you the flexibility of documents with the guarantees of a schema, and
it applies to every writer — including a script someone runs against production.

---

## Indexes

The same principles as any B-tree database, plus document-specific types.

```js
db.orders.createIndex({ userId: 1, placedAt: -1 });        // compound
db.users.createIndex({ email: 1 }, { unique: true });
db.orders.createIndex({ status: 1 }, {                      // partial
  partialFilterExpression: { status: "pending" }
});
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });  // TTL
db.products.createIndex({ name: "text", description: "text" });        // text
db.shops.createIndex({ location: "2dsphere" });                        // geo
db.events.createIndex({ "payload.type": 1 });                          // nested field
```

**The ESR rule** governs compound index order, and is the single most useful
thing to know here:

> **E**quality fields first, then **S**ort fields, then **R**ange fields.

```js
// Query: find pending orders for a user, newest first, in a date range
db.orders.find({ userId: id, status: "pending", placedAt: { $gte: from } })
         .sort({ placedAt: -1 });

// Index following ESR:
db.orders.createIndex({ userId: 1, status: 1, placedAt: -1 });
//                      ^equality  ^equality  ^sort + range
```

Getting the order wrong means the sort happens in memory — and MongoDB aborts an
in-memory sort above 100 MB rather than spilling, so it fails outright.

**TTL indexes** are genuinely useful: MongoDB deletes expired documents
automatically, which makes sessions, verification tokens and short-lived caches
self-cleaning.

Check what actually happened:

```js
db.orders.find({ status: "pending" }).explain("executionStats");
```

Look at `winningPlan.stage`: `IXSCAN` is an index scan, **`COLLSCAN` is a full
collection scan**. Compare `totalDocsExamined` with `nReturned` — if you examine
100,000 documents to return 20, the index is not selective enough.

---

## The Aggregation Pipeline

MongoDB's answer to `GROUP BY`, joins and reporting. Documents flow through
stages, each transforming the stream.

```js
db.orders.aggregate([
  // Filter FIRST so later stages process fewer documents — and so an index applies
  { $match: { placedAt: { $gte: ISODate("2026-01-01") }, status: "paid" } },

  { $group: {
      _id: "$customerId",
      orderCount: { $sum: 1 },
      totalPence: { $sum: "$totalPence" },
      lastOrder:  { $max: "$placedAt" }
  }},

  { $match: { orderCount: { $gte: 3 } } },     // filter on the aggregate
  { $sort:  { totalPence: -1 } },
  { $limit: 20 },

  // Join to another collection
  { $lookup: {
      from: "users",
      localField: "_id",
      foreignField: "_id",
      as: "customer"
  }},
  { $unwind: "$customer" },
  { $project: { _id: 0, name: "$customer.name", orderCount: 1, totalPence: 1 } }
]);
```

Rules that matter:

- **`$match` and `$limit` as early as possible.** Only a `$match` at the start of
  a pipeline can use an index.
- **`$lookup` is a join, and it is not free.** It performs a lookup per input
  document; ensure the foreign field is indexed, and reduce the input set first.
- **Memory limits apply.** A stage is capped at 100 MB unless you pass
  `allowDiskUse: true`.
- **`$project` last** to reduce what crosses the wire.

`explain()` works on aggregations too, and is the way to find the stage that
costs.

---

## Transactions and Consistency

MongoDB has multi-document ACID transactions since 4.0 (4.2 across shards):

```js
const session = client.startSession();
try {
  await session.withTransaction(async () => {
    await accounts.updateOne({ _id: from }, { $inc: { balancePence: -500 } }, { session });
    await accounts.updateOne({ _id: to },   { $inc: { balancePence:  500 } }, { session });
  });
} finally {
  await session.endSession();
}
```

They work, and they are **more expensive than in a relational database**. If you
need them routinely, that is a signal your documents are drawn along the wrong
boundaries — the document model's premise is that a single document update is
atomic, so related data that must change together should usually live together.

**Write and read concerns** control the durability/latency trade:

```js
{ writeConcern: { w: "majority", j: true } }   // acknowledged by a majority, journaled
{ readConcern:  { level: "majority" } }        // only majority-committed data
```

`w: "majority"` is the default in modern versions and is what you want. Lowering
it to `w: 1` is faster and can lose acknowledged writes during a failover.

Reading from secondaries scales reads at the cost of staleness — the same
read-after-write problem as any replicated system.

---

## Setup

```bash
docker run -d -p 27017:27017 mongo:8
brew install mongodb-community@8.0
```

```bash
mongosh
show dbs
use shop
db.orders.findOne()
db.orders.getIndexes()
db.orders.countDocuments({ status: "pending" })
```

```js
// Node driver — one client for the process, not per request
import {MongoClient} from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL, {
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000,
  retryWrites: true,
});
await client.connect();
```

**One `MongoClient` per application, reused.** It manages its own connection
pool internally; creating one per request exhausts connections and is a common
serverless mistake.

For local development a **replica set of one** is worth configuring, because
transactions and change streams require a replica set and will otherwise fail
only in production.

---

## Operations

**Replica sets** are the unit of deployment: a primary and secondaries with
automatic failover. Always run at least three members — with two, a failure
leaves no majority and the set goes read-only.

**Sharding** distributes a collection across replica sets by shard key. The
shard key is close to irreversible and determines everything:

- **Monotonically increasing keys** (a timestamp, an ObjectId) send every write
  to one shard — a hotspot, and the classic mistake.
- **Hashed keys** distribute evenly but make range queries hit every shard.
- **Compound keys** balancing cardinality against query patterns are usually
  right.

Do not shard early. A single replica set handles a great deal, and sharding adds
substantial operational complexity.

**Backups:**

```bash
mongodump --uri="mongodb://..." --out=/backup      # logical
mongorestore --uri="mongodb://..." /backup
```

`mongodump` is fine for modest databases. Beyond that, use filesystem snapshots
or Atlas's continuous backup, which supports point-in-time recovery via the
oplog.

**Change streams** let an application subscribe to changes — useful for cache
invalidation, search index updates and event-driven work:

```js
const stream = db.collection('orders').watch([{ $match: { operationType: 'insert' } }]);
for await (const change of stream) { await reindex(change.fullDocument); }
```

---

## Security

MongoDB's early reputation for breaches came from **unauthenticated instances
exposed to the internet**, with tens of thousands found by scanners. Modern
versions bind to localhost by default, but the lesson stands.

- **Enable authentication.** `security.authorization: enabled` — it is off with
  no auth configured.
- **Never bind to `0.0.0.0`** without a firewall in front.
- **Role-based access.** The application user needs `readWrite` on one database,
  not `root`.
- **TLS** for anything crossing a network.
- **Encryption at rest**, and client-side field-level encryption for sensitive
  fields.
- **Beware operator injection.** A query built from an unvalidated request body
  can contain `{"$ne": null}` and match everything:

  ```js
  // ❌ If req.body.password is {"$ne": null}, this authenticates anyone
  db.users.findOne({ email: req.body.email, password: req.body.password });
  ```

  Validate types before they reach a query. See
  [SQL Injection](/knowledge-base/security/sql-injection) — the same class of
  problem, different syntax.

---

## Do's and Don'ts

### Do

- Model for your access patterns — embed what is read together.
- Add JSON Schema validation to every collection.
- Follow ESR for compound index order.
- Put `$match` first in every aggregation pipeline.
- Use TTL indexes for anything with a natural expiry.
- Run at least three replica set members.
- Reuse one `MongoClient` for the process.
- Validate input types to prevent operator injection.

### Don't

- Don't embed unbounded arrays.
- Don't treat "schemaless" as "no schema".
- Don't use transactions routinely — reconsider the document boundaries.
- Don't use a monotonically increasing shard key.
- Don't shard before you must.
- Don't expose MongoDB without authentication.
- Don't sort large result sets without a supporting index.
- Don't create a client per request.

---

## Debugging

| Symptom                                | Cause and fix                                                     |
| -------------------------------------- | ----------------------------------------------------------------- |
| Query slow, `COLLSCAN` in explain      | No usable index. Create one following ESR.                        |
| "Sort exceeded memory limit"           | In-memory sort over 100 MB. Add an index matching the sort.       |
| Documents keep growing and writes slow | An unbounded embedded array. Move it to its own collection.       |
| Transaction fails: "not a replica set" | Transactions need a replica set — configure one even locally.     |
| Writes concentrated on one shard       | A monotonically increasing shard key.                             |
| Connection pool exhausted              | A `MongoClient` created per request instead of once.              |
| Reads miss a just-written document     | Reading from a secondary. Use the primary for read-after-write.   |
| Aggregation slow                       | `$match` is not first, or `$lookup` runs over too many documents. |

```js
db.currentOp({ secs_running: { $gt: 5 } });   // long-running operations
db.killOp(opid);
db.serverStatus().connections;
db.collection.stats();
```

---

## FAQ

**MongoDB or PostgreSQL with `jsonb`?**
If you want documents _and_ relations, Postgres gives you both in one store with
stronger constraints and a better planner. Choose MongoDB when documents are the
dominant model, when horizontal write scaling matters, or when the team is
already fluent in it.

**Is it web scale?**
It shards horizontally and handles very high write throughput. So does a
well-tuned relational database for most workloads. Choose on data model first.

**Do I need Mongoose?**
It adds schemas, validation and middleware to the Node driver, which many teams
want. The trade is another abstraction and its own quirks. Database-level JSON
Schema validation works regardless of driver.

**How do I do a join?**
`$lookup` in an aggregation pipeline. It works, and if you need it constantly
your documents are probably drawn along the wrong boundaries.

**What about the licence?**
SSPL, which is not OSI-approved and restricts offering MongoDB as a service.
Normal application use is unaffected; a hosting product needs legal review.

**How do I change the shape of existing documents?**
There is no `ALTER TABLE`. Either migrate in batches with an update pipeline, or
have the application handle both shapes and migrate lazily on read.

---

## Check your understanding

<Quiz
question="A blog post document embeds all its comments in an array. Popular posts now have thousands, and both reads and writes have become slow. What is the fix?"
options={[
{
text: 'Move comments into their own collection referencing the post — an unbounded array should never be embedded',
correct: true,
why: 'Embedded arrays that grow without bound make documents large and expensive to move, cannot be paginated efficiently, and eventually approach the 16 MB limit.',
},
{text: 'Increase the maximum document size', why: 'The 16 MB limit is fixed. It is a design signal rather than a tunable.'},
{text: 'Add an index on the comments array', why: 'Multikey indexes on huge arrays are expensive and do not address document size or the write cost.'},
{text: 'Compress the documents', why: 'Storage is not the problem; document growth and rewriting is.'},
]}
explanation={<>The rule: embed one-to-few and bounded, reference one-to-many and unbounded. A capped "recent comments" array alongside a full comments collection is a common hybrid.</>}
reference={{label: 'The 16 MB limit is a design signal', href: '/knowledge-base/databases/mongodb#the-16-mb-limit-is-a-design-signal'}}
/>

<Quiz
question="A query filters on userId and status, and sorts by placedAt descending. Which compound index is correct?"
options={[
{
text: '{ userId: 1, status: 1, placedAt: -1 } — equality fields first, then the sort field',
correct: true,
why: 'The ESR rule: Equality, Sort, Range. With both equality fields leading, the index can seek directly and then read in sort order.',
},
{text: '{ placedAt: -1, userId: 1, status: 1 }', why: 'Leading with the sort field means the index cannot narrow by equality first, so it scans far more.'},
{text: '{ status: 1, placedAt: -1 }', why: 'Omits userId, the most selective field, so every one of that user’s peers is examined too.'},
{text: 'Three separate single-field indexes', why: 'MongoDB will generally use only one per query, and none of them provides the sort order after filtering.'},
]}
explanation={<>Getting this wrong forces an in-memory sort, which MongoDB aborts above 100 MB rather than spilling to disk — so the query fails outright rather than degrading.</>}
reference={{label: 'Indexes', href: '/knowledge-base/databases/mongodb#indexes'}}
/>

<Quiz
question="A login handler runs db.users.findOne({ email: req.body.email, password: req.body.password }). What is the vulnerability?"
options={[
{
text: 'Operator injection — a JSON body can supply {"$ne": null} as the password, matching any user',
correct: true,
why: 'Query documents are data. If a request value is an object containing operators, it becomes part of the query rather than a literal to compare.',
},
{text: 'None, because MongoDB does not use SQL', why: 'The syntax differs; the class of vulnerability — untrusted input becoming query structure — is identical.'},
{text: 'The email field needs an index', why: 'A performance concern, not a security one.'},
{text: 'findOne should be find with a limit', why: 'Unrelated to the injection.'},
]}
explanation={<>Two defences: validate that inputs are strings before they reach a query, and never compare passwords in the database — fetch by email, then verify a bcrypt or Argon2 hash in application code.</>}
reference={{label: 'Security', href: '/knowledge-base/databases/mongodb#security'}}
/>

<Quiz
question="Which of these indicate that a document model has been drawn along the wrong boundaries?"
type="multiple"
options={[
{text: 'Multi-document transactions are needed for routine operations', correct: true, why: 'The document model assumes a single-document update is atomic. Constant transactions mean related data that changes together lives apart.'},
{text: '$lookup appears in most read paths', correct: true, why: 'Frequent joins suggest data read together is stored separately — the opposite of the embedding guideline.'},
{text: 'Documents contain arrays that grow without limit', correct: true, why: 'A design error with direct performance consequences, and eventually the 16 MB ceiling.'},
{text: 'Some documents in a collection have different optional fields', why: 'Entirely normal and one of the model’s advantages, provided schema validation covers the required fields.'},
{text: 'The same customer name appears in both the user and order documents', why: 'Deliberate duplication (the extended reference pattern) to avoid a lookup — a trade, not a mistake, as long as you decide how the copy stays correct.'},
]}
explanation={<>The single design question is "what is read and written together?" Answer it correctly and joins and transactions become rare, which is the model working as intended.</>}
reference={{label: 'Modelling: embed or reference', href: '/knowledge-base/databases/mongodb#modelling-embed-or-reference'}}
/>

<Quiz
question="An aggregation is slow. The pipeline is: $lookup, $unwind, $match, $sort, $limit. What is the first change to make?"
options={[
{
text: 'Move $match to the start, so it filters before the join and can use an index',
correct: true,
why: 'Only a $match at the beginning can use an index, and $lookup performs a lookup per input document — so filtering first reduces both index-less scanning and join work.',
},
{text: 'Remove $unwind, which is always slow', why: '$unwind has a cost but is often necessary. The dominant problem is joining every document before filtering.'},
{text: 'Add allowDiskUse: true', why: 'That avoids the 100 MB stage limit but does nothing about processing far more documents than necessary.'},
{text: 'Replace $lookup with several application-side queries', why: 'That reintroduces N+1 across the network — usually worse than a well-ordered pipeline.'},
]}
explanation={<>The general rule for pipelines: reduce the document stream as early as possible. <code>$match</code> and <code>$limit</code> first, <code>$project</code> last.</>}
reference={{label: 'The aggregation pipeline', href: '/knowledge-base/databases/mongodb#the-aggregation-pipeline'}}
/>

---

## References

- [MongoDB Manual](https://www.mongodb.com/docs/manual/) — the authoritative
  reference.
- [Data modelling patterns](https://www.mongodb.com/docs/manual/data-modeling/)
  — embedding, referencing and the named patterns.
- [The ESR rule](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
  — compound index ordering.
- [Aggregation pipeline](https://www.mongodb.com/docs/manual/core/aggregation-pipeline/)
  — stages and optimisation.
- [Transactions](https://www.mongodb.com/docs/manual/core/transactions/) — when
  they apply and what they cost.
- [Security checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)
  — authentication, network exposure, encryption.
