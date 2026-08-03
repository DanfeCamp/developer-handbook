---
title: 'Complexity & Cost'
description: 'Why some code is fast and some is not — Big-O in practice, the N+1 problem, the latency numbers worth memorising, and where time actually goes.'
---

# Complexity & Cost

## Introduction

Performance work goes wrong in a predictable way: someone optimises a loop that
takes microseconds while a query in that loop takes milliseconds.

**The single most useful idea on this page is the size of the gap between
layers.** A memory access is roughly a million times cheaper than a
cross-continent network round trip. Nothing about clean code changes that ratio,
and no amount of algorithmic elegance compensates for doing I/O in a loop.

**So the order of investigation is fixed:**

1. **Are we doing I/O we do not need to?** Usually yes, and usually in a loop.
2. **Are we doing it too many times?** The N+1 problem.
3. **Is the algorithm quadratic over growing data?** Occasionally.
4. **Is the constant factor high?** Rarely the answer, and where most effort
   goes.

**Measure before optimising.** Not as a platitude — the specific failure is that
intuition about where time goes is reliably wrong, and a profiler takes two
minutes.

---

## Big-O

Big-O describes how cost grows with input size, ignoring constants.

| Complexity   | Name         | 1,000 items | Typical source                 |
| ------------ | ------------ | ----------- | ------------------------------ |
| `O(1)`       | Constant     | 1           | Hash map lookup, array index   |
| `O(log n)`   | Logarithmic  | ~10         | Binary search, B-tree index    |
| `O(n)`       | Linear       | 1,000       | Single pass over a list        |
| `O(n log n)` | Linearithmic | ~10,000     | Good sorting algorithms        |
| `O(n²)`      | Quadratic    | 1,000,000   | Nested loop over the same list |
| `O(2ⁿ)`      | Exponential  | ~10³⁰¹      | Naive recursion over subsets   |

**The practical use is not computing exponents but noticing a nested loop over
data that grows.** This is the everyday quadratic:

```js
// ❌ O(n × m) — for each order, scan every user.
const rows = orders.map((order) => ({
  ...order,
  user: users.find((u) => u.id === order.userId),
}));

// ✅ O(n + m) — index once, then look up in constant time.
const byId = new Map(users.map((u) => [u.id, u]));
const rows = orders.map((order) => ({...order, user: byId.get(order.userId)}));
```

**`Array.includes`, `indexOf` and `find` inside a loop are the tell.** Each is a
linear scan; putting one inside an iteration over the same data makes it
quadratic. A `Set` or `Map` built once turns it linear.

**Constants still matter.** An `O(n²)` algorithm over 20 items beats an
`O(n log n)` one with heavy setup. Big-O tells you what happens when the data
grows, not what is fastest today. The question to ask is _does this input grow?_
— a quadratic over a fixed list of 12 currencies will never matter.

**Space complexity is the other axis.** The `Map` above trades memory for time,
which is nearly always the right trade until the data no longer fits.

**Watch for accidental quadratics in string building** — repeated concatenation
in a loop can copy the accumulated string each time. Collect into an array and
`join` once.

---

## The N+1 Problem

The most common performance bug in application code: one query to fetch a list,
then one more query per item.

```js
const posts = await db.posts.findMany(); // 1 query
for (const post of posts) {
  post.author = await db.users.find(post.authorId); // N queries
}
```

At 100 posts that is 101 round trips. Even at 2 ms each, it is 200 ms of pure
waiting — and the database reports every individual query as fast, which is why
this hides so well.

**The signature: total time scales linearly with row count while each query
stays quick.** If doubling the page size doubles the response time and no single
query is slow, this is almost certainly it.

**Three fixes:**

```js
// 1. A join — one query, database does the work.
const posts = await db.posts.findMany({include: {author: true}});

// 2. A batched second query — two queries total.
const posts = await db.posts.findMany();
const authors = await db.users.findMany({
  where: {id: {in: posts.map((p) => p.authorId)}},
});
const byId = new Map(authors.map((a) => [a.id, a]));
posts.forEach((p) => (p.author = byId.get(p.authorId)));

// 3. A DataLoader-style batcher — collects IDs within a tick, issues one query.
```

**Lazy-loading ORMs cause this by design.** Accessing `post.author` looks like a
property read and is a query. Enable query logging in development and watch the
count — a page that issues 200 queries is visible immediately and invisible
otherwise.

**It is endemic in GraphQL**, where each resolver runs per parent object.
DataLoader exists specifically for this. See
[GraphQL](/knowledge-base/apis/graphql) and
[Data Modelling](/knowledge-base/databases/data-modelling).

**The inverse mistake is over-fetching:** a join that pulls fifty columns and
three relations to render a list of titles. Both are I/O problems; one does too
many round trips, the other moves too much per trip.

---

## Latency You Should Have a Feel For

| Operation                         | Approximate time |
| --------------------------------- | ---------------- |
| L1 cache reference                | 1 ns             |
| Main memory reference             | 100 ns           |
| SSD random read                   | 100 µs           |
| Database query, same datacentre   | 0.5–5 ms         |
| HTTP round trip, same region      | 10–50 ms         |
| HTTP round trip, cross-continent  | 100–300 ms       |
| DNS lookup, uncached              | 20–120 ms        |
| TLS handshake (extra round trips) | 1–2 × RTT        |

**The gap between memory and network is roughly a factor of a million.** This
single ratio explains most performance decisions:

- Why one extra query in a loop matters far more than an inefficient loop.
- Why [caching](/knowledge-base/operations/caching) pays for itself so quickly.
- Why a [CDN](/knowledge-base/hosting/cdn) helps distant users more than any
  server optimisation can.
- Why batching is nearly always worth the added complexity.

**Sequential dependencies multiply.** Three chained requests at 50 ms each are
150 ms before any work happens. Parallelise what is independent — see
[Concurrency](/knowledge-base/general/concurrency#async-patterns).

---

## Measuring

**Profile before optimising.** Intuition about where time goes is reliably
wrong.

| Question                       | Tool                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Which function burns CPU?      | Chrome DevTools Performance, `node --cpu-prof`, `clinic`                            |
| Where does request time go?    | Distributed tracing — see [Observability](/knowledge-base/operations/observability) |
| Why is this query slow?        | `EXPLAIN ANALYZE`                                                                   |
| How many queries per request?  | ORM query logging                                                                   |
| What is the user experiencing? | Real user monitoring, Core Web Vitals                                               |

**Measure percentiles, not averages.** A mean of 200 ms is consistent with 99%
of users at 50 ms and 1% at 15 seconds. The tail is where the unhappy users
are. See [Monitoring](/knowledge-base/operations/monitoring#metric-types).

**A flame graph answers "what is on the stack" in seconds** — wide frames are
where time is spent. It is the fastest route from "this endpoint is slow" to a
line number.

**Beware the JIT when micro-benchmarking.** Warm up, use realistic data, and
prefer measuring the real system under real load. See
[How Code Runs](/knowledge-base/general/how-code-runs#interpreters-compilers-and-jit).

---

## Do's and Don'ts

### Do

- Index a collection into a `Map` or `Set` before looking things up in a loop.
- Batch queries rather than issuing one per row.
- Log query counts per request in development.
- Parallelise independent I/O.
- Profile before optimising, and measure after.
- Track percentiles, not averages.
- Ask whether the input actually grows before worrying about complexity.
- Cache at the layer where the round trip is most expensive.

### Don't

- Don't do I/O inside a loop when a batch call exists.
- Don't use `find`, `includes` or `indexOf` inside a loop over the same data.
- Don't optimise a loop while a query in it takes a hundred times longer.
- Don't concatenate strings in a loop for large outputs.
- Don't chain requests that could run concurrently.
- Don't assume the ORM is issuing the queries you expect.
- Don't tune constants before checking the complexity class.
- Don't ship a performance fix without a measurement proving it worked.

---

## Common Mistakes

**An accidental N+1 behind a lazy ORM.** `post.author` reads like a property and
is a query. 200 of them look fine in the logs individually.

**`find` inside `map`.** Quadratic, and invisible until the list grows from 50
rows to 5,000.

**Optimising the wrong layer.** Rewriting a loop in a tighter style while each
iteration awaits a 4 ms query.

**Averages hiding the tail.** A healthy mean with a p99 of fifteen seconds.

**Micro-benchmarking cold code.** Measuring the interpreter, then optimising
what the JIT would have handled.

**Caching to hide a missing index.** Now you have a slow query _and_ a
consistency problem. See
[Caching](/knowledge-base/operations/caching#introduction).

**Over-fetching to avoid N+1.** Fifty columns and three joins to render a list
of titles.

**Sequential awaits for independent calls.** Three 100 ms requests taking
300 ms.

---

## Debugging

| Symptom                               | Where to look                                 |
| ------------------------------------- | --------------------------------------------- |
| Response time scales with row count   | N+1 — count the queries                       |
| Slow only with production data volume | Missing index, or a quadratic                 |
| Fast query, slow endpoint             | Time is in round trips, not the database      |
| CPU pegged, little I/O                | A hot loop — take a CPU profile               |
| Slow for distant users only           | Network latency — CDN or edge caching         |
| Memory growing with request size      | Loading a whole result set into memory        |
| p50 fine, p99 terrible                | Contention, cold caches, or a slow dependency |

**Count the queries first.** It is the cheapest diagnostic available and it
identifies the most common cause. Most ORMs log with a flag; if yours does not,
wrap the driver and increment a counter per request.

**Then look at a trace.** A distributed trace attributes time across services
and shows N+1 patterns unmistakably — 200 identical sibling spans.

---

## FAQ

**Do I need to know Big-O for real work?**
You need to recognise a nested loop over growing data and know that hash lookups
are constant time. Computing tight bounds is interview material; noticing the
`O(n²)` in a code review is the job.

**When is a quadratic acceptable?**
When the input is bounded and small, and you know it. A quadratic over a fixed
list of 12 currencies will never matter. One over "all rows a customer has" will.

**How many queries per request is reasonable?**
Single digits for most endpoints. Anything above about twenty deserves a look,
and anything scaling with result count is a bug.

**Is premature optimisation really the root of all evil?**
The full quotation allows for the 3% that matters. Choosing the right data
structure and avoiding I/O in loops is design, not premature optimisation.

**Should I cache to fix slowness?**
Only after fixing the underlying cost. A cache in front of a missing index hides
the problem and adds a consistency question.

**What is a reasonable API response time?**
Under 100 ms feels instant, under 300 ms feels responsive, and beyond a second
users notice. Budget backwards from that across your dependencies.

---

## Check your understanding

<Quiz
question="An endpoint that renders 200 orders with their customers takes 900 ms. The database is fast and each individual query takes 4 ms. What is almost certainly happening?"
options={[
{
text: 'An N+1 query pattern — one query for the orders, then one per order for the customer',
correct: true,
why: '201 queries × ~4 ms is roughly 800 ms of sequential round trips. The signature is total time scaling linearly with row count while each query stays fast.',
},
{
text: 'The ORM is slow at hydrating objects',
why: 'Object construction for 200 rows is sub-millisecond. The time is being spent waiting, not computing.',
},
{
text: 'A missing index on the orders table',
why: 'A missing index would make individual queries slow. The premise says each query takes 4 ms.',
},
{
text: 'JSON serialisation of the response',
why: 'Serialising 200 records takes single-digit milliseconds.',
},
]}
explanation={<>Fix it with a join, a single batched <code>WHERE id IN (…)</code>, or a DataLoader-style batcher. The general lesson: a network round trip inside a loop is roughly a million times more expensive than a memory access.</>}
reference={{label: 'The N+1 problem', href: '/knowledge-base/general/complexity-and-cost#the-n1-problem'}}
/>

<Quiz
question="This code is fine with 50 users and unusably slow with 5,000. What changed, and what is the fix?"
options={[
{
text: 'It is O(n × m) — find scans the whole users array for every order. Build a Map once and look up in constant time',
correct: true,
why: 'Array.find is a linear scan. Inside a map over another collection, the cost is the product of both sizes, so growth in either multiplies the work.',
},
{text: 'The spread operator copies each order and is the bottleneck', width: false, why: 'Copying a small object is cheap and linear in the number of orders, not quadratic.'},
{text: 'Garbage collection pressure from creating new objects', width: false, why: 'A real secondary cost, and it does not explain a superlinear slowdown.'},
{text: 'The array should be sorted first to allow binary search', why: 'Sorting plus binary search is O((n+m) log m) — better than quadratic, and worse than the O(n+m) a hash map gives.'},
]}
explanation={<><code>find</code>, <code>includes</code> and <code>indexOf</code> inside a loop over the same data are the tell for an accidental quadratic. Indexing into a <code>Map</code> or <code>Set</code> trades a little memory for a large amount of time — nearly always the right trade.</>}
reference={{label: 'Big-O', href: '/knowledge-base/general/complexity-and-cost#big-o'}}>

```js
const rows = orders.map((order) => ({
  ...order,
  user: users.find((u) => u.id === order.userId),
}));
```

</Quiz>

<Quiz
question="Roughly how much slower is a cross-continent HTTP round trip than a main-memory reference?"
options={[
{
text: 'About a million times — roughly 100 ns versus 100–300 ms',
correct: true,
why: 'Memory is measured in nanoseconds and intercontinental network latency in hundreds of milliseconds. That six-order-of-magnitude gap drives most performance decisions.',
},
{text: 'About a thousand times', why: 'That is closer to the gap between memory and an SSD read.'},
{text: 'About a hundred times', width: false, why: 'That is roughly L1 cache versus main memory.'},
{text: 'About a billion times', why: 'That would put network latency in the range of minutes.'},
]}
explanation={<>This ratio is why one extra query in a loop matters more than an inefficient loop, why caching pays for itself immediately, and why a CDN helps distant users more than any server-side optimisation can.</>}
reference={{label: 'Latency you should have a feel for', href: '/knowledge-base/general/complexity-and-cost#latency-you-should-have-a-feel-for'}}
/>

<Quiz
question="Which of these are sound approaches to a slow endpoint?"
type="multiple"
options={[
{text: 'Count the queries issued per request before anything else', correct: true, why: 'The cheapest diagnostic available, and it identifies the single most common cause.'},
{text: 'Take a CPU profile or a distributed trace to see where time actually goes', correct: true, why: 'Intuition about time distribution is reliably wrong; a flame graph or trace answers it in seconds.'},
{text: 'Parallelise independent I/O with Promise.all', correct: true, why: 'Sequential awaits over independent calls are the most common avoidable latency in application code.'},
{text: 'Track p95 and p99 rather than the mean', correct: true, why: 'A mean of 200 ms is consistent with 1% of users waiting fifteen seconds, and the tail is where the complaints come from.'},
{text: 'Add a cache in front of the slow query as the first step', why: 'That hides a missing index behind a consistency problem. Fix the underlying cost first, then cache if it is still worth it.'},
]}
explanation={<>The order matters: eliminate unnecessary I/O, reduce round trips, check the complexity class, and only then tune constants. Most effort goes to the last step, where the least gain is.</>}
reference={{label: 'Measuring', href: '/knowledge-base/general/complexity-and-cost#measuring'}}
/>

<Quiz
question="A report generator builds a large CSV by repeatedly appending rows to a string in a loop. It becomes disproportionately slow for large exports. Why?"
options={[
{
text: 'Repeated concatenation can copy the accumulated string on each iteration, making the total work quadratic in output size',
correct: true,
why: 'Each append may allocate a new string and copy everything written so far, so total copying grows with the square of the number of rows.',
},
{text: 'Strings have a maximum length that triggers a slow path', width: false, why: 'There is an engine limit, and the slowdown appears long before reaching it.'},
{text: 'CSV formatting is inherently expensive', why: 'Formatting a row is trivial; the cost is in accumulating the result.'},
{text: 'Garbage collection cannot free strings until the loop ends', width: false, why: 'Intermediate strings do become garbage, and the dominant cost is the copying itself.'},
]}
explanation={<>Collect the rows into an array and <code>join('\n')</code> once, or stream each row to the response so nothing accumulates in memory at all — the better answer for large exports, since it bounds memory as well as time.</>}
reference={{label: 'Big-O', href: '/knowledge-base/general/complexity-and-cost#big-o'}}
/>

---

## References

- [Latency numbers every programmer should know](https://gist.github.com/jboner/2841832)
  — the original list these figures derive from.
- [Big-O cheat sheet](https://www.bigocheatsheet.com/) — complexity of common
  data structures and algorithms.
- [MDN: `Map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
  — constant-time lookup, and when it beats an object.
- [PostgreSQL: Using `EXPLAIN`](https://www.postgresql.org/docs/current/using-explain.html)
  — reading query plans.
- [Chrome DevTools: Performance](https://developer.chrome.com/docs/devtools/performance)
  — flame graphs and the main-thread timeline.
- [Node.js: Profiling](https://nodejs.org/en/learn/getting-started/profiling) —
  `--cpu-prof` and the built-in profiler.
