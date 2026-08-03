---
title: 'Monoliths'
description: 'Why one deployable is usually the right starting point — modular monoliths, enforcing boundaries, scaling, and the honest limits.'
---

# Monoliths

## Introduction

A monolith is an application deployed as a single unit. One codebase, one build,
one process — however many features it contains.

**The word became pejorative** during the microservices enthusiasm of the
2010s, which was a mistake. "Monolith" describes a deployment topology, not a
quality level. A well-structured monolith is easier to change, cheaper to run
and far easier to reason about than a distributed system, and most applications
never outgrow one.

**What you get for free**, and only notice when you give it up:

- **Transactions.** One database, one `BEGIN…COMMIT`. Across services this
  becomes a saga with compensating actions.
- **Function calls.** Microseconds, and they either return or throw. A network
  call is milliseconds, and can also hang, time out, or succeed while the
  response is lost.
- **One deploy.** No version-compatibility matrix between components.
- **Local debugging.** A stack trace spans the whole request; a debugger steps
  through all of it.
- **Trivial refactoring.** Renaming a function across the whole system is one
  operation your IDE performs correctly.

**The real problem is not size — it is structure.** "Big ball of mud" is the
failure mode people are actually describing when they complain about monoliths,
and splitting a tangled system across a network makes the tangle worse, not
better.

:::tip Start here
Unless you have a specific, present reason to distribute — organisational
scale, wildly divergent resource needs, a hard compliance boundary — begin with
a modular monolith. It is the reversible decision. See
[Microservices](/knowledge-base/architecture/microservices).
:::

---

## The Modular Monolith

One deployable, internally divided into modules with explicit boundaries.

```text
src/
├── modules/
│   ├── catalogue/
│   │   ├── index.ts          ← the module's ONLY public surface
│   │   ├── domain/
│   │   ├── application/
│   │   └── infrastructure/
│   ├── ordering/
│   │   ├── index.ts
│   │   └── …
│   └── billing/
│       ├── index.ts
│       └── …
├── shared/                   ← genuinely cross-cutting only
│   ├── database.ts
│   └── logger.ts
└── main.ts                   ← composition root
```

The rules that make it a modular monolith rather than a folder structure:

1. **A module is reached only through its `index.ts`.** No file outside
   `ordering/` imports anything from `ordering/domain/`.
2. **Modules do not share database tables.** `ordering` owns its tables;
   `billing` asks `ordering` for data rather than joining to it.
3. **Modules communicate through explicit calls or events**, not by reaching
   into each other's internals.
4. **`shared/` is for genuinely universal things** — logging, database
   connection, configuration. It is not a dumping ground; a `shared/utils.ts`
   that every module imports is how boundaries dissolve.

Get this right and you have most of the benefit claimed for microservices —
clear ownership, independent reasoning, a path to extraction — with none of the
distributed-systems cost.

---

## Enforcing Boundaries

**Boundaries that are not enforced do not exist.** Every codebase has a
convention nobody follows after the second deadline. Encode it mechanically.

```js title="eslint.config.js"
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['@/modules/*/!(index)', '@/modules/*/*'],
    message: 'Import from the module root (@/modules/ordering), not its internals.',
  }],
}],
```

Or with `dependency-cruiser`, which can express directionality:

```js
{
  name: 'no-cross-module-internals',
  severity: 'error',
  from: {path: '^src/modules/([^/]+)/'},
  to: {path: '^src/modules/(?!$1)([^/]+)/(?!index)'},
}
```

**Database boundaries need enforcing too.** Prefix tables per module
(`ordering_orders`, `billing_invoices`), or use a schema per module in
PostgreSQL, and grant each module's connection access only to its own. Then a
cross-module join fails rather than quietly becoming a dependency.

The moment `billing` joins directly to `ordering_orders`, extracting either into
a service becomes a rewrite. Every cross-module join is a boundary violation
that will be expensive later.

---

## Scaling a Monolith

The most common misconception is that monoliths do not scale. They scale
perfectly well; what does not scale is a _badly structured_ one.

**Horizontal scaling.** A stateless monolith runs behind a load balancer with as
many identical instances as you like. Statelessness is the requirement — no
in-memory sessions, no local file uploads, no per-instance caches treated as
authoritative. See
[Statelessness](/knowledge-base/general/idempotency-and-state#statelessness).

**Vertical scaling.** Modern hardware is enormous. A single machine with 64
cores and 256 GB of RAM handles workloads that would have needed a cluster ten
years ago.

**Scale components independently — without splitting the codebase.** Deploy the
same artefact in different roles:

```bash
# Same image, different entry point
app web       --replicas 10   # HTTP traffic
app worker    --replicas 4    # queue consumers
app scheduler --replicas 1    # cron
```

This is the most under-used monolith technique. You get independent scaling of
web and background work, which is the most common real scaling need, without any
distributed-systems cost.

**Read replicas and caching** handle database load long before sharding or
splitting is warranted. See
[Data Modelling](/knowledge-base/databases/data-modelling) and
[Caching](/knowledge-base/operations/caching).

**Realistically:** a well-built monolith on modern hardware serves tens of
thousands of requests per minute. Very few applications ever exceed that, and
the ones that do usually hit database limits first — which splitting the
application does not fix.

---

## The Honest Limits

Where a monolith genuinely stops being the right answer.

**Organisational scale.** This is the real one. Coordination cost grows with the
number of people touching one deployable. At around 8–10 teams, release
coordination, merge conflicts and "who broke the build?" become a permanent tax.
Microservices are primarily an _organisational_ solution — Conway's Law made
deliberate.

**Genuinely divergent resource profiles.** A video transcoder needing GPUs and
32 GB of RAM alongside an API needing neither means you scale everything for the
heaviest component. Note that separate _processes from one codebase_ often
solves this without separate services.

**Independent deployment cadence.** If one component must ship hourly while
another needs a regulated quarterly release, one deployable is a real
constraint.

**Hard isolation requirements.** A component handling card data inside PCI scope
is easier to certify when the scope boundary is a process boundary.

**Technology mismatch.** A machine-learning service in Python inside a Java
monolith is awkward. Note this justifies _that_ service being separate, not
splitting everything.

**Build and test time.** When CI takes 45 minutes, iteration slows. Usually
fixable with test parallelisation, affected-module test selection and build
caching — try those before splitting.

---

## Extraction, When It Is Time

If the modular monolith was built properly, extraction is mechanical rather than
archaeological.

1. **Confirm the boundary is real.** The module already has a single public
   interface and owns its own tables. If not, fix that _inside_ the monolith
   first — that is the hard part, and doing it in-process is far cheaper than
   doing it across a network.
2. **Replace in-process calls with an interface** the rest of the code depends
   on. Nothing moves yet.
3. **Swap the implementation for a network client**, keeping the same interface.
4. **Deploy the service**, run both paths, compare.
5. **Remove the in-process implementation.**

**Extract one module, then stop and evaluate.** The distributed-systems cost
arrives with the first service — tracing, retries, versioning, deployment
orchestration — and it is worth knowing what you have signed up for before
extracting the second.

Some teams find, having paid that cost once, that the modular monolith was
already giving them what they wanted.

---

## Do's and Don'ts

### Do

- Start with a modular monolith.
- Give each module one public entry point.
- Enforce module boundaries with lint rules in CI.
- Give each module its own tables, prefixed or schema-separated.
- Keep the application stateless so it scales horizontally.
- Deploy the same artefact in web, worker and scheduler roles.
- Fix structure inside the monolith before considering extraction.

### Don't

- Don't split a tangled system across a network — you get a distributed tangle.
- Don't let modules join to each other's tables.
- Don't create a `shared/` folder that everything imports from.
- Don't adopt microservices for a team of five.
- Don't assume monoliths cannot scale; assume unstructured code cannot.
- Don't extract more than one service before evaluating the cost.
- Don't confuse "monolith" with "legacy".

---

## Common Mistakes

**The big ball of mud.** No internal boundaries at all, so every change risks
everything. This is the actual complaint behind most anti-monolith arguments,
and the fix is modularity rather than distribution.

**Boundaries by convention only.** Module folders with no enforcement. Within a
year every module imports every other module's internals.

**A shared database free-for-all.** Any module querying any table. This is the
single biggest obstacle to later extraction, and the easiest to prevent early.

**A `shared/` dumping ground.** Starts as a logger, becomes a module every part
of the system depends on, and couples everything to everything.

**Distributed monolith.** The worst outcome: services split without real
boundaries, so they must be deployed together and a change touches five repos.
All the cost of distribution, none of the independence.

**Splitting for the wrong reason.** "Our monolith is slow" is usually a database
or algorithmic problem. Splitting adds network hops and makes it slower.

---

## FAQ

**Are monoliths outdated?**
No. Several prominent engineering organisations have publicly moved _back_ from
microservices to monoliths or larger services, citing cost and complexity. The
industry position has moderated considerably since 2018.

**How large can a monolith get?**
Very large. Shopify, GitHub and Basecamp all run substantial monoliths. Team
count is the binding constraint far more often than code size.

**Modular monolith or microservices?**
Modular monolith until you have a specific reason to distribute. It preserves
optionality; microservices are hard to reverse.

**How do I know it is time to split?**
When teams are blocked on each other's releases, when a component genuinely
needs different infrastructure, or when a compliance boundary requires it. Not
because of code size.

**Can a monolith use several languages?**
Not usually within one process. That is a legitimate reason to run a separate
service for that component specifically.

**Does a monolith mean one repository?**
Not necessarily, though it usually does. A monorepo can contain several
deployables, and one repository can build one deployable. The topology and the
repository layout are separate decisions.

---

## Check your understanding

<Quiz
question="A team's monolith is hard to change: every modification risks unrelated features. They propose splitting into microservices. What is the likely outcome?"
options={[
{
text: 'A distributed big ball of mud — the coupling moves to the network, where it is harder to see, harder to test and harder to refactor',
correct: true,
why: 'Distribution does not create boundaries; it enforces whatever boundaries already exist. If none do, you get services that must deploy together, plus latency and partial failure.',
},
{text: 'Improved modularity, since service boundaries force separation', why: 'Only if the boundaries are drawn correctly first. Drawing them wrongly across a network makes every mistake far more expensive to fix.'},
{text: 'Better performance from independent scaling', why: 'Network hops replace function calls. A tangled system usually gets slower.'},
{text: 'Faster development once the split is complete', why: 'Teams still blocked on each other now coordinate across repositories and deploys as well.'},
]}
explanation={<>Fix the structure in-process first, where a bad boundary costs a refactor rather than a migration. If the modular monolith then still hurts, extraction is mechanical.</>}
reference={{label: 'Extraction, when it is time', href: '/knowledge-base/architecture/monoliths#extraction-when-it-is-time'}}
/>

<Quiz
question="Which practices make a monolith modular rather than merely organised into folders?"
type="multiple"
options={[
{text: 'Each module exposes a single public entry point, and cross-module imports of internals fail CI', correct: true, why: 'Enforcement is what distinguishes a boundary from a convention. Unenforced conventions erode within months.'},
{text: 'Each module owns its own tables, with no cross-module joins', correct: true, why: 'A shared-database free-for-all is the single biggest obstacle to later extraction, and the easiest to prevent early.'},
{text: 'Modules communicate through explicit calls or events on the public surface', correct: true, why: 'Keeps the coupling visible and intentional rather than incidental.'},
{text: 'Folders named domain/, application/ and infrastructure/ inside each module', why: 'Useful internal organisation, but folder names alone enforce nothing.'},
{text: 'A shared/utils.ts that every module imports from', why: 'The opposite — a shared grab-bag couples every module to every other, which is how boundaries dissolve.'},
]}
explanation={<>The database boundary is the one teams most often skip and most regret. Table prefixes or per-module schemas with restricted grants make a violating join fail loudly.</>}
reference={{label: 'Enforcing boundaries', href: '/knowledge-base/architecture/monoliths#enforcing-boundaries'}}
/>

<Quiz
question="An application needs 10 web instances and 4 queue workers, scaled independently. Does this require splitting into services?"
options={[
{
text: 'No — deploy the same artefact with different entry points. One codebase, several process roles, independent scaling',
correct: true,
why: 'Independent scaling of web and background work is the most common real scaling need, and it needs no service boundary at all — only a different command.',
},
{text: 'Yes, independent scaling requires independent deployables', why: 'It requires independent _processes_, which one artefact provides.'},
{text: 'Yes, because workers and web servers have different dependencies', why: 'They share the same codebase and dependencies; only the entry point differs.'},
{text: 'No, but only if the workers are stateless', why: 'Both should be stateless for horizontal scaling — that is orthogonal to whether they need separate codebases.'},
]}
explanation={<>This is the most under-used monolith technique. Reach for it before concluding that scaling requires distribution.</>}
reference={{label: 'Scaling a monolith', href: '/knowledge-base/architecture/monoliths#scaling-a-monolith'}}
/>

<Quiz
question="Which is the strongest genuine reason to move away from a monolith?"
options={[
{
text: 'Eight to ten teams are blocked on each other for releases, and coordination has become a permanent tax',
correct: true,
why: 'Microservices are primarily an organisational solution. Independent deployment matters when independent teams need to ship without coordinating.',
},
{text: 'The codebase has passed 500,000 lines', why: 'Size alone is not the constraint. Several very large monoliths run successfully.'},
{text: 'A checkout page is slow', why: 'Almost always a database or algorithmic problem. Adding network hops makes it slower.'},
{text: 'Microservices are the industry standard', why: 'The industry position has moderated considerably, with several prominent teams moving back.'},
]}
explanation={<>Conway's Law made deliberate: the architecture ends up mirroring the communication structure of the organisation, so distributing makes sense when the organisation is genuinely distributed.</>}
reference={{label: 'The honest limits', href: '/knowledge-base/architecture/monoliths#the-honest-limits'}}
/>

<Quiz
question="The `billing` module writes a SQL join against `ordering`'s tables because it is faster than calling the ordering module. What is the cost?"
options={[
{
text: 'It creates a hidden dependency on another module\'s schema, so ordering can no longer change its tables freely and neither module can be extracted without a rewrite',
correct: true,
why: 'The join makes billing depend on ordering’s internal storage rather than its interface. Every such join is a boundary violation that must be undone before extraction is possible.',
},
{text: 'None — it is one database, so joining is the intended usage', why: 'One database is a deployment fact, not permission to couple modules to each other’s internals.'},
{text: 'Only a performance cost from the larger join', why: 'The join is likely faster. The cost is structural, and it is paid later.'},
{text: 'It breaks transactions across modules', why: 'It does not — one database means one transaction. That is a benefit of the monolith, and separate from the coupling problem.'},
]}
explanation={<>Enforce it in the database: per-module schemas or table prefixes with grants limited to the owning module, so a violating join fails rather than silently becoming an obligation.</>}
reference={{label: 'The modular monolith', href: '/knowledge-base/architecture/monoliths#the-modular-monolith'}}
/>

---

## References

- [Martin Fowler: MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html)
  — why starting distributed usually goes badly.
- [Shopify: Deconstructing the Monolith](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity)
  — modular monolith at very large scale.
- [Modular Monolith: A Primer](https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer)
  — Kamil Grzybek's series, the most thorough treatment available.
- [Martin Fowler: Microservice Premium](https://martinfowler.com/bliki/MicroservicePremium.html)
  — the complexity cost you take on.
- [Microservices](/knowledge-base/architecture/microservices) — the other side
  of this decision, including when it is right.
