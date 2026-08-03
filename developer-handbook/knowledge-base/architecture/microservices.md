---
title: 'Microservices'
description: 'Independently deployable services, and their real cost — boundaries, data ownership, sagas, resilience, observability and when not to.'
---

# Microservices

## Introduction

Microservices split an application into independently deployable services, each
owning its data and communicating over a network.

**The problem they solve is organisational.** This is the part most often
misstated. Microservices exist so that **teams can deploy without coordinating**.
When ten teams share one deployable, releases queue, merges conflict, and one
team's bug blocks everyone. Independent deployment removes that coupling.

Performance, scalability and technology choice are secondary benefits, usually
achievable other ways — a
[modular monolith](/knowledge-base/architecture/monoliths) with separate process
roles gets you most of the scaling story at a fraction of the cost.

**What you give up** is everything a single process gives you for free:
transactions, reliable function calls, a stack trace that spans the request,
and refactoring across boundaries.

:::danger The premium is real
Every microservice architecture pays a fixed cost: service discovery, network
failure handling, distributed tracing, contract versioning, deployment
orchestration, and eventual consistency in the data model.

You must be **taller than this bar** before it pays. Below it, you get the cost
with none of the benefit — a distributed monolith. If you have fewer than
roughly five teams, the answer is almost certainly a modular monolith.
:::

---

## Drawing Boundaries

The decision that determines whether this works. Bad boundaries produce services
that must be deployed together, which is the worst of both worlds.

**Split by business capability, not by technical layer.** Never a "database
service", an "API service" and a "business logic service" — that is a layered
monolith with network calls between the layers, and every feature touches all
three.

```text
❌ Technical layers            ✅ Business capabilities
   api-gateway-service            ordering
   business-logic-service         catalogue
   data-access-service            billing
                                  shipping
```

**Domain-Driven Design's bounded context is the right tool.** A bounded context
is a boundary within which a term has one consistent meaning. "Customer" means
something different to billing (a payment method and an address) than to support
(a history of tickets). Those are two models, and the boundary between them is a
candidate service boundary.

**The tests for a good boundary:**

- Can it be deployed without deploying anything else?
- Does it own its data completely?
- Can one team own it end to end?
- Do most changes touch only this service?

If a typical feature requires changing three services, the boundaries are wrong.

**Start coarse.** Fewer, larger services are easier to merge than many small ones
are to consolidate. "Microservice" is a misleading name — size is not the goal.

---

## Data Ownership

The rule that makes the rest work, and the one most often broken:

> **Each service owns its data. No other service touches its database.**

A shared database means a schema change in one service breaks another, which
destroys the independent deployment that was the entire point.

The consequences are significant and worth being clear-eyed about.

**No joins across services.** Composition happens in the application, or through
an API composition or aggregate service — which is an N+1 problem across the
network unless batched carefully.

**No transactions across services.** This is the big one. `BEGIN…COMMIT` cannot
span two databases. You must use a saga.

**Data duplication becomes normal.** The ordering service keeps a copy of the
customer's name so it does not call the customer service on every render. That
copy is stale by design, and you must decide how it converges.

**Eventual consistency becomes the default.** A write in one service is visible
elsewhere later — usually milliseconds, occasionally much longer. Product
behaviour and UI must accommodate that, and "read your own write" needs
deliberate handling.

---

## Sagas

Since a distributed transaction is not available, a business operation spanning
services becomes a sequence of local transactions with **compensating actions**
for rollback.

```text
Place order:
  1. ordering:   create order (pending)
  2. inventory:  reserve stock        ─┐
  3. billing:    charge card           │  each step can fail
  4. shipping:   schedule dispatch    ─┘
  5. ordering:   mark order confirmed

If step 3 fails:
  compensate 2: release the stock reservation
  compensate 1: mark the order failed
```

**Compensation is not rollback.** You cannot un-charge a card; you issue a
refund, which is a new fact with its own audit trail. Every compensating action
must be designed as a real business operation.

Two coordination styles:

|            | **Choreography**                      | **Orchestration**                 |
| ---------- | ------------------------------------- | --------------------------------- |
| Control    | Each service reacts to events         | A coordinator drives the steps    |
| Coupling   | Low                                   | The orchestrator knows the flow   |
| Visibility | Hard — no single place shows the flow | Easy — read the orchestrator      |
| Suits      | 2–3 steps                             | 4+ steps, or complex compensation |

Choreography is elegant with three services and becomes very hard to debug with
seven, because no single place describes what should happen. For anything
non-trivial, prefer an orchestrator — a workflow engine such as Temporal is
purpose-built for it.

---

## Communication

**Synchronous** — HTTP or gRPC, request/response. Simple and familiar, and it
couples availability: if you call three services synchronously and each is
99.9 % available, your endpoint is 99.7 %, and a slow dependency makes you slow.

**Asynchronous** — messages and events over a broker. The publisher does not
wait, so a consumer being down delays rather than fails. The cost is eventual
consistency and harder debugging. See
[Event-Driven Architecture](/knowledge-base/architecture/event-driven) and
[Kafka](/knowledge-base/kafka).

**Prefer asynchronous between services and synchronous for user-facing reads.**
A checkout that must charge a card synchronously is fine; sending the
confirmation email should be an event.

### The dual-write problem

The commonest correctness bug in this architecture:

```ts
// ❌ Two systems, no atomicity. A crash between them loses the event.
await db.orders.insert(order);
await broker.publish('order.placed', order);
```

The **Outbox pattern** is the standard fix — write the event to a table in the
same transaction as the state change, then relay it:

```ts
await db.transaction(async (tx) => {
  await tx.orders.insert(order);
  await tx.outbox.insert({topic: 'order.placed', payload: order}); // same transaction
});
// A separate relay publishes from the outbox and marks rows sent.
```

### Contracts

Each service's API is a public contract with independent consumers.

- **Version deliberately**, and support the old version through a deprecation
  window. See [REST versioning](/knowledge-base/apis/rest#versioning).
- **Be additive.** New optional fields are safe; removals and renames are not.
- **Use consumer-driven contract testing** (Pact) so a provider's CI fails when
  it breaks a consumer — the only mechanism that reliably catches this before
  production.
- **Tolerant readers.** Ignore unknown fields rather than rejecting them.

---

## Resilience

In a monolith, a function call returns or throws. Across a network it can also
hang, time out, or succeed while the response is lost. **Failure is normal, not
exceptional**, and must be designed for.

**Timeouts on everything.** A call with no timeout is a thread waiting forever;
under load that exhausts the pool and the failure spreads. This is the single
most common cause of cascading failure.

**Retries with exponential backoff and jitter** — for idempotent operations
only. Retrying a non-idempotent `POST` charges the card twice. See
[idempotency](/knowledge-base/general/idempotency-and-state#idempotency).

**Circuit breakers.** After N consecutive failures, stop calling and fail fast,
then probe periodically. This lets a struggling service recover instead of being
held down by traffic it cannot serve.

**Bulkheads.** Separate connection pools per dependency, so one slow service
cannot consume every connection and take down calls to healthy ones.

**Graceful degradation.** If recommendations are down, show the page without
them. Decide in advance which dependencies are essential and which are optional.

**Idempotency everywhere.** At-least-once delivery plus retries means every
consumer will see duplicates. Design for it rather than hoping.

---

## Observability

You cannot debug a distributed system by reading one log file. This is not
optional tooling — it is a prerequisite.

**Distributed tracing** is the most important piece. A trace id propagated
through every call lets you see one user request across every service, with
timings.

```text
trace 4bf92f: POST /orders                              412ms
  ├─ ordering.createOrder                                18ms
  ├─ inventory.reserve            (HTTP)                 44ms
  ├─ billing.charge               (HTTP)                310ms  ← the problem
  │   └─ stripe.paymentIntents.create                   298ms
  └─ ordering.confirm                                    12ms
```

**Structured logs with a correlation id** on every line, aggregated centrally.
Without the id you cannot reassemble a request; without aggregation you are
grepping fifteen machines.

**Metrics per service** — the RED method (Rate, Errors, Duration) is a good
default, plus saturation.

**Health checks** — liveness (is the process alive?) and readiness (can it serve
traffic?) as separate endpoints, so an orchestrator restarts a dead process
without routing to one that is still warming up.

See [Observability](/knowledge-base/operations/observability),
[OpenTelemetry](/knowledge-base/operations/opentelemetry) and
[Logging](/knowledge-base/operations/logging).

---

## The Operational Cost

An honest inventory of what you take on:

- **CI/CD per service** — pipelines, artefact registries, deployment automation,
  environment provisioning.
- **Service discovery and routing** — a mesh, or a platform that provides it.
- **Centralised logging, metrics and tracing**, plus their storage costs.
- **Contract testing**, or you will find breakages in production.
- **Local development** — running fifteen services on a laptop is a real
  problem, usually met with Docker Compose, service virtualisation or shared
  development environments.
- **A version-compatibility matrix.** Which versions of which services work
  together?
- **Distributed debugging skills** across the whole team.
- **On-call complexity** — an incident may span several services and teams.

Kubernetes, a service mesh and an observability stack are typically what makes
this manageable — and each is a system to learn and operate. **The platform
becomes a product**, needing its own team at scale.

---

## Do's and Don'ts

### Do

- Start with a modular monolith and extract when there is a reason.
- Draw boundaries around business capabilities and bounded contexts.
- Give every service exclusive ownership of its data.
- Use the Outbox pattern for state changes accompanied by events.
- Set timeouts, retries with jitter, and circuit breakers on every call.
- Make every consumer idempotent.
- Invest in tracing and correlation ids **before** you need them.
- Use consumer-driven contract tests.
- Start with fewer, larger services.

### Don't

- Don't split by technical layer.
- Don't share a database between services.
- Don't attempt distributed transactions.
- Don't build a synchronous call chain several services deep.
- Don't adopt microservices for a small team.
- Don't publish an event and write to the database as two separate operations.
- Don't rely on choreography for a seven-step workflow.
- Don't defer observability — it is a prerequisite, not a follow-up.

---

## Common Mistakes

**The distributed monolith.** Services that must be deployed together because
their boundaries are wrong. All the operational cost, none of the independence,
and much harder to fix than the monolith it replaced.

**Shared database.** The most common shortcut, and it eliminates independent
deployability immediately.

**Too many, too small.** Fifty services for a team of fifteen means nobody
understands the whole system and every feature spans several repositories.

**Synchronous chains.** A → B → C → D means the availability multiplies down and
the latency adds up.

**No tracing.** Debugging becomes correlating timestamps across services by
hand.

**Ignoring the dual-write problem.** State committed, event lost, systems
diverge silently — and the divergence is often found weeks later.

**Splitting for performance.** Almost always a database or algorithmic problem.
Network hops make it worse.

---

## FAQ

**When are microservices the right choice?**
When several teams need to deploy independently, when parts of the system have
genuinely different scaling or compliance needs, or when a component must use a
different technology stack. Team structure is the strongest signal.

**How small should a service be?**
Large enough that one team owns it and most changes stay inside it. "Micro" is a
misleading name — service _count_ is a cost, not a virtue.

**Can I have a shared database if only one service writes?**
Better, and still coupling: readers depend on a schema they do not own. Prefer
exposing an API or publishing events.

**Do I need Kubernetes?**
Not necessarily, but you need something that provides deployment, discovery,
health checking and scaling. Kubernetes, ECS or a PaaS all qualify.

**How do I handle authentication across services?**
Validate once at the edge and propagate a signed token, or use a service mesh
with mTLS for service-to-service identity. Never trust an internal caller purely
because it is internal.

**What about testing?**
Unit and integration tests per service, consumer-driven contract tests between
them, and a small number of end-to-end tests. Full end-to-end suites across all
services become slow and flaky quickly.

---

## Check your understanding

<Quiz
question="A team splits their application into 'api-service', 'business-logic-service' and 'data-service'. What is wrong with these boundaries?"
options={[
{
text: 'They are technical layers, not business capabilities — so almost every feature requires changing all three and deploying them together',
correct: true,
why: 'That is a layered monolith with network calls between the layers: the coupling is unchanged, and latency, partial failure and deployment coordination have been added.',
},
{text: 'Three services is too few to be microservices', why: 'Service count is not the criterion. Three well-bounded services can be entirely appropriate.'},
{text: 'The names are too generic', why: 'Naming is a symptom here; the structural problem is splitting along layers.'},
{text: 'Nothing — separation of concerns is good architecture', why: 'Separation of concerns within a process is good. Turning layer boundaries into network boundaries is not.'},
]}
explanation={<>Split by bounded context — ordering, catalogue, billing, shipping — so a typical feature stays inside one service. If a normal change touches three services, the boundaries are wrong.</>}
reference={{label: 'Drawing boundaries', href: '/knowledge-base/architecture/microservices#drawing-boundaries'}}
/>

<Quiz
question="An ordering service inserts an order then publishes 'order.placed' to a broker. Occasionally the order exists but no event was published. What is the fix?"
options={[
{
text: 'The Outbox pattern — write the event to a table in the same transaction as the order, and relay it from there',
correct: true,
why: 'This is the dual-write problem: two systems, no shared transaction, so a crash between them loses the event. Making both writes atomic in one database removes the gap.',
},
{text: 'Publish the event before inserting the order', why: 'It reverses the failure: now you can publish an event for an order that was never created.'},
{text: 'Wrap both operations in a try/finally and retry the publish', why: 'The process can die before the finally runs, and a retry after commit still leaves an unprotected window.'},
{text: 'Use a broker with stronger delivery guarantees', why: 'Broker guarantees apply once it receives the message. The gap is before that.'},
]}
explanation={<>Pair the outbox with idempotent consumers: relaying guarantees at-least-once delivery, so the same event will sometimes arrive twice.</>}
reference={{label: 'The dual-write problem', href: '/knowledge-base/architecture/microservices#the-dual-write-problem'}}
/>

<Quiz
question="Which resilience measures should be applied to every synchronous inter-service call?"
type="multiple"
options={[
{text: 'A timeout', correct: true, why: 'A call with no timeout occupies a thread indefinitely. Under load the pool exhausts and the failure spreads — the most common cascading-failure cause.'},
{text: 'A circuit breaker', correct: true, why: 'Stops hammering a failing dependency so it can recover, and fails fast instead of queueing.'},
{text: 'Retries with exponential backoff and jitter, for idempotent operations', correct: true, why: 'Handles transient failure without synchronised retry storms — but only where a repeat is safe.'},
{text: 'A separate connection pool per dependency', correct: true, why: 'The bulkhead pattern: one slow service cannot consume every connection and take down calls to healthy ones.'},
{text: 'Automatic retries on every operation regardless of idempotency', why: 'Retrying a non-idempotent charge takes the customer’s money twice. Idempotency must come first.'},
]}
explanation={<>In-process, a call returns or throws. Across a network it can also hang or succeed while the response is lost — so failure handling is part of the design, not an afterthought.</>}
reference={{label: 'Resilience', href: '/knowledge-base/architecture/microservices#resilience'}}
/>

<Quiz
question="A checkout spans ordering, inventory, billing and shipping. Billing fails after inventory has reserved stock. How is this handled?"
options={[
{
text: 'A saga with compensating actions — release the reservation, mark the order failed. Compensation is a new business operation, not a rollback',
correct: true,
why: 'A transaction cannot span four databases. Each step commits locally, and failure triggers explicit compensating operations that undo the business effect.',
},
{text: 'A distributed transaction with two-phase commit across the four services', why: 'Two-phase commit is available in principle and effectively unused in practice — it blocks on coordinator failure and couples availability.'},
{text: 'Retry billing until it succeeds', why: 'Some failures are permanent (declined card). Holding the reservation open indefinitely blocks other customers.'},
{text: 'Roll back the inventory transaction', why: 'It already committed in another service’s database. There is nothing to roll back — only to compensate.'},
]}
explanation={<>With four steps, prefer orchestration over choreography: a coordinator makes the flow readable in one place, whereas event choreography leaves no single description of what should happen.</>}
reference={{label: 'Sagas', href: '/knowledge-base/architecture/microservices#sagas'}}
/>

<Quiz
question="What is the strongest signal that an organisation should adopt microservices?"
options={[
{
text: 'Several teams are blocked on each other for releases and cannot deploy independently',
correct: true,
why: 'Microservices are primarily an organisational solution. Independent deployability is the benefit that justifies the operational premium.',
},
{text: 'The monolith is slow under load', why: 'Usually a database or algorithmic problem. Network hops make it slower, and the database is often still shared.'},
{text: 'The team wants to try a new language for part of the system', why: 'A legitimate reason for _one_ separate service, not for splitting everything.'},
{text: 'The codebase has grown past a few hundred thousand lines', why: 'Size alone is not the constraint — several very large monoliths run successfully.'},
]}
explanation={<>Below roughly five teams the premium — discovery, tracing, contract versioning, deployment orchestration, eventual consistency — usually exceeds the benefit. A modular monolith keeps the option open.</>}
reference={{label: 'Introduction', href: '/knowledge-base/architecture/microservices#introduction'}}
/>

---

## References

- [microservices.io](https://microservices.io/patterns/) — Chris Richardson's
  pattern catalogue: Saga, Outbox, API Composition, Circuit Breaker.
- [Martin Fowler: Microservice Premium](https://martinfowler.com/bliki/MicroservicePremium.html)
  — the cost, stated plainly.
- [Martin Fowler: MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html)
  — why starting distributed tends to fail.
- [Building Microservices](https://samnewman.io/books/building_microservices_2nd_edition/)
  — Sam Newman; the standard reference.
- [Domain-Driven Design Reference](https://www.domainlanguage.com/ddd/reference/)
  — bounded contexts, which is how boundaries should be drawn.
- [Pact](https://docs.pact.io/) — consumer-driven contract testing.
- [Temporal](https://temporal.io/) — durable workflow orchestration for sagas.
