---
title: 'GraphQL'
description: 'A query language letting clients request exactly the data they need — schema design, resolvers, the N+1 problem, security limits and federation.'
---

# GraphQL

## Introduction

GraphQL is a query language for APIs. The server publishes a **schema**
describing the available data as a graph; the client sends a query naming
exactly the fields it wants, and receives exactly those fields.

**The problem it solves.** With REST, the server decides response shape. A
mobile client needing a user's name and their last three order totals might make
four requests and discard 90 % of what comes back, or wait for the backend team
to add a bespoke endpoint. GraphQL moves that decision to the client.

```graphql
query {
  user(id: "7") {
    name
    orders(last: 3) {
      total
      items {
        product {
          name
        }
      }
    }
  }
}
```

One request, one response, exactly those fields, however deep the graph.

**The honest assessment, ten years on.** The industry has largely concluded that
GraphQL's real value is **federation** — letting many teams contribute to one
coherent API — rather than over-fetching, which HTTP caching and a few
purpose-built endpoints often solve more cheaply. It also brings real costs:
caching is harder, the N+1 problem is structural rather than incidental, and
security requires work that REST gets from the shape of the API.

**Choose GraphQL when** several clients with genuinely different data needs query
a complex, interconnected graph — and you are prepared to fund DataLoader,
persisted queries and complexity limits. **Choose [REST](/knowledge-base/apis/rest)**
for a public API with well-understood resources, straightforward cacheability
and broad client support.

---

## The Schema

The schema is the contract. It is strongly typed, introspectable, and the single
source of truth for both sides.

```graphql
type Query {
  order(id: ID!): Order
  orders(first: Int = 20, after: String, status: OrderStatus): OrderConnection!
}

type Mutation {
  createOrder(input: CreateOrderInput!): CreateOrderPayload!
}

type Order {
  id: ID!
  reference: String!
  status: OrderStatus!
  totalPence: Int!
  customer: User! # a field, resolved on demand
  items: [OrderItem!]! # non-null list of non-null items
  placedAt: DateTime!
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  CANCELLED
}

input CreateOrderInput {
  productId: ID!
  quantity: Int!
  idempotencyKey: String
}

type CreateOrderPayload {
  order: Order
  errors: [UserError!]!
}

type UserError {
  field: String
  code: String!
  message: String!
}
```

`!` means non-null. Read `[OrderItem!]!` as "a non-null list of non-null items"
— the list is always present, and never contains nulls.

**Be careful with `!` on fields that can fail.** GraphQL's null propagation
means that if a non-null field resolves to null, the error bubbles _upwards_
until it reaches a nullable field — potentially nulling an entire response
because one nested field errored. Mark a field non-null only when it genuinely
cannot fail.

### Design the schema for clients, not for tables

The most common mistake is exposing your database schema as a graph. A GraphQL
schema is a product surface: it should model the domain as clients think about
it, and it should be stable while your tables change underneath.

**Return errors as data for expected failures.** The top-level `errors` array is
for exceptions; a payload type with a `UserError` list gives clients typed,
localisable, field-attributed validation errors they can act on.

**Follow the Relay connection convention** for lists, even without Relay — it
gives you cursor pagination and room for metadata:

```graphql
type OrderConnection {
  edges: [OrderEdge!]!
  pageInfo: PageInfo!
  totalCount: Int
}
type OrderEdge {
  cursor: String!
  node: Order!
}
type PageInfo {
  hasNextPage: Boolean!
  endCursor: String
}
```

---

## Resolvers

A resolver produces the value for one field. The graph is walked field by field,
and each resolver only needs to know how to produce its own piece.

```ts
const resolvers = {
  Query: {
    order: (_parent, {id}, ctx) => ctx.orders.findById(id),
  },
  Order: {
    // Called once per Order in the result — this is where N+1 begins
    customer: (order, _args, ctx) => ctx.loaders.userById.load(order.userId),
    items: (order, _args, ctx) => ctx.loaders.itemsByOrderId.load(order.id),
  },
  Mutation: {
    createOrder: async (_parent, {input}, ctx) => {
      if (!ctx.user) throw new GraphQLError('Unauthenticated', {extensions: {code: 'UNAUTHENTICATED'}});
      // …
    },
  },
};
```

The four arguments are `(parent, args, context, info)`. **Context** is
per-request and is where the authenticated user, the database connection and the
DataLoaders live.

---

## The N+1 Problem

Structural in GraphQL, not incidental. A query for 50 orders calls the
`Order.customer` resolver 50 times, each issuing its own query.

```text
1 query for orders  +  50 queries for customers  =  51 round trips
```

**DataLoader** is the answer, and it is not optional. It batches all loads made
within one tick of the event loop into a single call, and deduplicates repeated
keys:

```ts
import DataLoader from 'dataloader';

// Created PER REQUEST — never shared across requests
function createLoaders(db) {
  return {
    userById: new DataLoader(async (ids: readonly string[]) => {
      const rows = await db.user.findMany({where: {id: {in: [...ids]}}});
      const byId = new Map(rows.map((r) => [r.id, r]));
      // MUST return results in the same order as the keys
      return ids.map((id) => byId.get(id) ?? null);
    }),
  };
}
```

51 queries become 2.

Two rules that cause real bugs when broken:

- **Create loaders per request.** A shared loader caches across users and will
  eventually serve one user's data to another.
- **Return results in key order, one per key.** DataLoader matches by position,
  so a batch function that drops missing rows silently misaligns every result.

---

## Security

GraphQL's flexibility is its attack surface. A public endpoint with no limits
lets anyone issue an arbitrarily expensive query.

### Depth and complexity limits

```graphql
# A malicious query — quadratic expansion from a cyclic relationship
query {
  user(id: "1") { orders { customer { orders { customer { orders { ... } } } } } }
}
```

```ts
import depthLimit from 'graphql-depth-limit';

const server = new ApolloServer({
  schema,
  validationRules: [depthLimit(10)],
  plugins: [complexityLimitPlugin({maximumComplexity: 1000})],
});
```

Depth limits stop nesting; **complexity limits** are more important, because a
shallow query requesting 10,000 items per field is cheap to write and expensive
to serve. Assign a cost per field, multiply by requested list sizes, and reject
above a threshold.

### Persisted queries

The strongest control, and now considered a prerequisite rather than an
optimisation for a production API. The client sends a **hash** of a pre-approved
query rather than the query text:

```json
{"id": "a1b2c3", "variables": {"orderId": "1024"}}
```

The server executes only queries it already knows. That eliminates arbitrary
query execution entirely, reduces bandwidth, and makes queries cacheable by id.

### The rest

- **Disable introspection in production** on a non-public API. It is how an
  attacker learns your entire schema in one request. (Keep it in development —
  the tooling depends on it.)
- **Authorise in resolvers, per object.** A single authenticated check at the
  endpoint is not enough: the graph lets a client reach `order.customer.email`
  from an order they can see. Every field returning sensitive data needs its own
  check.
- **Disable field suggestions.** "Did you mean `passwordHash`?" leaks schema
  detail even with introspection off.
- **Rate limit by cost, not request count.** One GraphQL request can be
  thousands of database queries, so counting requests measures nothing.
- **Cap batched operations and query size.** Array-batched requests multiply
  cost per HTTP request.
- **Timeout every resolver**, so one slow field cannot hold a connection open.

---

## Caching

The hardest trade-off, and the one people underestimate when migrating from
REST.

A REST `GET /orders/1024` is cacheable by any CDN, proxy or browser for free.
GraphQL is a `POST` to a single URL with a body — **HTTP caching does not apply**.
You replace one free mechanism with several you must operate:

- **Client-side normalised cache** (Apollo Client, Relay, urql) — stores objects
  by id so an object fetched once is reused across queries. This is the main
  reason GraphQL feels fast in an SPA, and it requires globally unique,
  stable ids.
- **Persisted queries over GET** — a hashed query in the URL restores CDN
  caching for public data.
- **Server-side caching** per resolver or per entity, in Redis.
- **`@cacheControl` hints**, with a gateway that respects them.

If most of your traffic is public, cacheable and read-heavy, this is a genuine
argument for REST.

---

## Setup

```bash
npm install graphql @apollo/server
# or: graphql-yoga, Mercurius (Fastify), Pothos for code-first schemas
```

```ts
import {ApolloServer} from '@apollo/server';
import {startStandaloneServer} from '@apollo/server/standalone';

const server = new ApolloServer({typeDefs, resolvers});

const {url} = await startStandaloneServer(server, {
  context: async ({req}) => ({
    user: await authenticate(req),
    loaders: createLoaders(db), // fresh loaders per request
    db,
  }),
  listen: {port: 4000},
});
```

**Schema-first** (write SDL, implement resolvers) or **code-first** (build the
schema in TypeScript with Pothos or Nexus, generate SDL). Code-first keeps types
and resolvers in step automatically and is the more common choice in TypeScript
codebases.

On the client, use **GraphQL Code Generator** to produce types from the schema
and your operations, so a schema change becomes a compile error rather than a
runtime surprise.

---

## Federation

The reason most large organisations adopt GraphQL. Several teams own their own
subgraphs, and a gateway composes them into one API.

```graphql
# users subgraph
type User @key(fields: "id") {
  id: ID!
  name: String!
}

# orders subgraph — extends a type it does not own
type Order @key(fields: "id") {
  id: ID!
  customer: User! # resolved by the users subgraph
}

extend type User @key(fields: "id") {
  id: ID! @external
  orders: [Order!]! # the orders team adds a field to User
}
```

The orders team adds `User.orders` without touching the users service. Clients
see one graph.

The costs are real: a gateway is now on every request path, schema composition
must be checked in CI so a subgraph change cannot break the supergraph, and
distributed tracing becomes necessary rather than optional. **Implement
DataLoader inside `__resolveReference`** or federation reintroduces N+1 across
service boundaries, which is far more expensive than in-process.

Do not adopt federation for a single team with a single service.

---

## Do's and Don'ts

### Do

- Design the schema around client needs, not database tables.
- Use DataLoader for every relationship field, created per request.
- Return expected failures as typed errors in the payload.
- Use the Relay connection shape for lists.
- Enforce depth **and** complexity limits.
- Use persisted queries in production.
- Authorise in resolvers, per object.
- Generate client types from the schema.

### Don't

- Don't expose your database schema as a graph.
- Don't share a DataLoader between requests.
- Don't leave introspection enabled on a private production API.
- Don't rate limit by request count.
- Don't mark every field non-null — null propagation will surprise you.
- Don't adopt federation before you have several teams.
- Don't assume HTTP caching still works.
- Don't return raw exception messages in the `errors` array.

---

## Debugging

| Symptom                                        | Cause and fix                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| Query fires hundreds of database queries       | Missing DataLoader on a relationship field.                         |
| A user occasionally sees another's data        | A DataLoader shared across requests. Create per request.            |
| Entire response is null after one field errors | Non-null propagation. Make the failing field nullable.              |
| DataLoader returns mismatched objects          | The batch function did not return one result per key, in key order. |
| Server falls over from one request             | No complexity limit. Add cost analysis.                             |
| Client silently gets stale data                | Normalised cache holding an object with no stable id.               |
| Slow query, no obvious cause                   | A nested resolver. Use Apollo tracing or OpenTelemetry per field.   |
| Schema change broke a client                   | No schema check in CI. Add composition and breaking-change checks.  |

---

## FAQ

**GraphQL or REST?**
REST for public, cacheable, resource-shaped APIs. GraphQL when many clients need
different shapes of one interconnected graph — and you will invest in the
supporting machinery.

**Is over-fetching really the problem it was?**
Less than the early pitch suggested. Bandwidth is cheaper, HTTP/2 makes multiple
requests less costly, and a handful of purpose-built endpoints often solves it.
Federation is the more durable justification.

**How do I do file uploads?**
Not through GraphQL, ideally. Issue a pre-signed URL from a mutation and have
the client upload directly to object storage. See
[File Uploads](/knowledge-base/web/file-uploads).

**Subscriptions or SSE?**
GraphQL subscriptions work over WebSockets and are appropriate for a live graph.
For simple one-way updates, [SSE](/knowledge-base/apis/server-sent-events) is
much less machinery.

**Do I need Apollo?**
No. `graphql-yoga` is lighter, Mercurius suits Fastify, and Pothos is an
excellent code-first schema builder. Apollo has the largest ecosystem and a
commercial platform around federation.

**How should I version a GraphQL API?**
Generally you do not. Add fields, deprecate old ones with `@deprecated`, and
track field usage so you know when it is safe to remove them.

---

## Check your understanding

<Quiz
question="A query returning 50 orders, each with a customer, issues 51 database queries. What is the correct fix?"
options={[
{
text: 'Use DataLoader to batch the 50 customer lookups into one query per request',
correct: true,
why: 'Field resolvers run once per parent object. DataLoader collects all loads within an event-loop tick and issues a single WHERE id IN (…), turning 51 queries into 2.',
},
{text: 'Join customers into the initial orders query', why: 'Works for this one query, but the client chooses the shape — the moment they omit customer you have over-fetched, and every other relationship needs the same special case.'},
{text: 'Add a caching layer in front of the database', why: 'Reduces database load without reducing 50 round trips, and the first uncached request is just as slow.'},
{text: 'Limit query depth to 2', why: 'Depth limits protect against malicious nesting. They do not make a legitimate one-level query efficient.'},
]}
explanation={<>Two DataLoader rules matter: create loaders <em>per request</em> (a shared loader leaks data between users) and return exactly one result per key, in key order (it matches by position).</>}
reference={{label: 'The N+1 problem', href: '/knowledge-base/apis/graphql#the-n1-problem'}}
/>

<Quiz
question="A public GraphQL endpoint is being abused by expensive queries. Which control is most effective?"
options={[
{
text: 'Persisted queries — the client sends a hash of a pre-approved operation, so arbitrary queries cannot be executed at all',
correct: true,
why: 'It removes the attack surface rather than bounding it. The server only ever runs operations you shipped, and it reduces bandwidth and restores cacheability by id.',
},
{text: 'A query depth limit of 5', why: 'Useful, and insufficient on its own: a shallow query requesting 10,000 items per field is cheap to write and expensive to serve.'},
{text: 'Rate limiting by requests per minute', why: 'One GraphQL request can be thousands of database queries, so counting requests measures the wrong thing. Rate limit by computed cost.'},
{text: 'Disabling introspection', why: 'Worth doing on a private API, but an attacker who already knows the schema is unaffected.'},
]}
explanation={<>In practice you want several layers: persisted queries as the gate, plus complexity limits and cost-based rate limiting for anything still dynamic.</>}
reference={{label: 'Security', href: '/knowledge-base/apis/graphql#security'}}
/>

<Quiz
question="Migrating a public read-heavy API from REST to GraphQL, the team is surprised that CDN hit rates collapse. Why?"
options={[
{
text: 'GraphQL is a POST to one URL with the query in the body, so HTTP caching by URL no longer applies',
correct: true,
why: 'REST gets CDN, proxy and browser caching for free from GET plus a distinct URL per resource. GraphQL replaces that with caching you must build — normalised client cache, persisted queries over GET, or server-side entity caching.',
},
{text: 'GraphQL responses are too large to cache', why: 'They are usually smaller, since clients request only what they need.'},
{text: 'CDNs do not support JSON responses', why: 'They cache JSON perfectly well — the obstacle is the POST and the single URL.'},
{text: 'Introspection queries are filling the cache', why: 'Introspection is a small fraction of traffic and would not explain a general collapse.'},
]}
explanation={<>This is the strongest argument for keeping REST when traffic is public, cacheable and read-heavy. Persisted queries sent over GET restore much of it, which is another reason to treat them as a prerequisite.</>}
reference={{label: 'Caching', href: '/knowledge-base/apis/graphql#caching'}}
/>

<Quiz
question="Which of these are sound GraphQL schema design decisions?"
type="multiple"
options={[
{text: 'Returning validation failures as typed UserError objects in the mutation payload', correct: true, why: 'Gives clients field-attributed, machine-readable, localisable errors. The top-level errors array is for exceptions.'},
{text: 'Using the Relay connection shape for paginated lists', correct: true, why: 'Cursor pagination plus room for metadata, and it is the convention every GraphQL client tool understands.'},
{text: 'Modelling the schema on how clients use the data rather than on table structure', correct: true, why: 'The schema is a product surface that should stay stable while storage changes underneath.'},
{text: 'Marking every field non-null for stronger guarantees', why: 'Null propagation means one failing non-null field can null an entire branch of the response. Reserve ! for fields that genuinely cannot fail.'},
{text: 'Exposing every database column so clients never need a new field added', why: 'Couples the public API to storage, leaks internals, and makes every schema change a breaking change.'},
]}
explanation={<>The single most common GraphQL failure is treating the schema as a database projection rather than a designed interface.</>}
reference={{label: 'Design the schema for clients', href: '/knowledge-base/apis/graphql#design-the-schema-for-clients-not-for-tables'}}
/>

<Quiz
question="A DataLoader is created once at server startup and reused. What goes wrong?"
options={[
{
text: 'Its cache is shared across all requests and users, so one user can be served another user\'s cached data',
correct: true,
why: 'DataLoader memoises by key for its lifetime. A process-lifetime loader is a process-lifetime cache with no authorisation awareness — a genuine data-leak bug.',
},
{text: 'It will run out of memory immediately', why: 'Memory growth is a real secondary concern, but the leak between users is the serious problem.'},
{text: 'Batching stops working after the first request', why: 'Batching continues to work; the caching is what becomes incorrect.'},
{text: 'Nothing — this is the recommended pattern for performance', why: 'The documented pattern is explicitly one set of loaders per request, created in the context function.'},
]}
explanation={<>Create loaders inside the per-request <code>context</code> function. The batching benefit is per-tick and does not require a long-lived instance; the caching benefit is per-request by design.</>}
reference={{label: 'The N+1 problem', href: '/knowledge-base/apis/graphql#the-n1-problem'}}
/>

---

## References

- [GraphQL specification](https://spec.graphql.org/) — the normative document.
- [graphql.org: Best Practices](https://graphql.org/learn/best-practices/) —
  schema design, versioning, pagination.
- [DataLoader](https://github.com/graphql/dataloader) — batching and caching,
  including the ordering contract.
- [Relay connection specification](https://relay.dev/graphql/connections.htm) —
  the cursor pagination convention.
- [Apollo: Persisted queries](https://www.apollographql.com/docs/react/data/persisted-queries)
  — setup and the security argument.
- [Apollo Federation](https://www.apollographql.com/docs/federation/) —
  subgraphs, composition and reference resolvers.
- [OWASP GraphQL Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html)
  — depth limits, introspection, batching attacks.
