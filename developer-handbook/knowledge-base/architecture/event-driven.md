---
title: 'Event-Driven Architecture'
description: 'Communicating through events rather than direct calls — event design, delivery guarantees, ordering, idempotency and the debugging cost.'
---

# Event-Driven Architecture

## Introduction

In an event-driven system, a component announces that **something happened** and
does not know or care who reacts.

```ts
// Direct: the caller knows every consequence, and waits for all of them
await sendConfirmationEmail(order);
await updateInventory(order);
await notifyWarehouse(order);
await recordAnalytics(order);

// Event-driven: the caller states a fact and moves on
await publish('order.placed', order);
```

**The problem it solves.** In the first version, `placeOrder` must know about
email, inventory, the warehouse and analytics. Every new consequence edits it,
every one of them can fail the request, and the checkout is as slow as the sum
of its parts. In the second, adding a consequence means adding a subscriber and
changing nothing that already works.

**The trade-off is stark.** You gain decoupling, resilience and independent
scaling. You lose the ability to read one function and know what happens — and
that cost is real. A new developer can follow the first version immediately; the
second requires knowing what subscribes to `order.placed`, which is not visible
from the publishing code.

**Where it fits:** side effects that need not block a response, integration
between services, audit trails, fan-out to many consumers, and workloads with
bursty traffic that benefit from buffering.

**Where it does not:** anything the caller needs an answer from, simple CRUD, or
small systems where the indirection costs more than the coupling.

---

## Events, Commands and Messages

A distinction worth getting right, because conflating them produces confused
designs.

|                               | **Event**            | **Command**               |
| ----------------------------- | -------------------- | ------------------------- |
| Says                          | Something happened   | Do this                   |
| Tense                         | Past — `OrderPlaced` | Imperative — `PlaceOrder` |
| Consumers                     | Zero to many         | Exactly one               |
| Publisher knows the consumer? | No                   | Yes                       |
| May be rejected?              | No — it is a fact    | Yes                       |

```ts
// Event: a fact. Publisher does not care who listens.
{type: 'order.placed', orderId: 'ord_1024', totalPence: 2500, at: '2026-08-03T10:00:00Z'}

// Command: an instruction to one handler, which may refuse.
{type: 'send-invoice-email', orderId: 'ord_1024'}
```

**The commonest mistake is a command disguised as an event.** `order.placed`
with a subscriber that must exist for the system to work correctly is a command
with extra steps — the publisher does depend on it, but the dependency is now
invisible.

---

## Designing Events

An event is a public contract. Once other services consume it, changing it
breaks them.

```json
{
  "id": "evt_01J9XQ7F3K",
  "type": "order.placed",
  "version": 1,
  "occurredAt": "2026-08-03T10:00:00Z",
  "correlationId": "req_7f3a2b",
  "data": {
    "orderId": "ord_1024",
    "customerId": "cus_88",
    "totalPence": 2500,
    "currency": "GBP"
  }
}
```

- **A unique id** so consumers can deduplicate.
- **A type**, named `resource.past-tense-verb`.
- **A version**, so the schema can evolve.
- **`occurredAt`** — when it happened, which is not when it was delivered.
- **A correlation id** threading through everything caused by one user action.
  This is what makes debugging possible at all.

### Thin or fat?

A **thin** event carries ids; consumers fetch what they need. A **fat** event
carries the data.

|                         | Thin                   | Fat                       |
| ----------------------- | ---------------------- | ------------------------- |
| Payload                 | `{orderId}`            | The whole order           |
| Consumer must call back | Yes                    | No                        |
| Data freshness          | Always current         | Snapshot at publish time  |
| Coupling                | To the publisher's API | To the publisher's schema |

**Fat events are usually better** in a distributed system: consumers keep
working when the publisher is down, which is the resilience you were buying.
Include the data a consumer needs to act, and let it fetch anything
consequential — see [Webhooks](/knowledge-base/apis/webhooks), where the same
trade-off appears.

### Evolving the schema

- **Additive changes are safe** — a new optional field. Consumers must be
  **tolerant readers** that ignore unknown fields.
- **Removals and renames are breaking.** Publish `v2` alongside `v1`, migrate
  consumers, then retire `v1`.
- **Use a schema registry** (Avro, Protobuf, JSON Schema) so incompatible
  changes fail at build time rather than in a consumer at 3am.

---

## Delivery Guarantees

The property that determines how your consumers must be written.

| Guarantee         | Meaning                       | Reality                   |
| ----------------- | ----------------------------- | ------------------------- |
| **At-most-once**  | Never duplicated, may be lost | Rarely acceptable         |
| **At-least-once** | Never lost, may be duplicated | **What you get**          |
| **Exactly-once**  | Once, exactly                 | Not achievable end to end |

**Exactly-once delivery does not exist** across a network. Kafka's
"exactly-once semantics" applies within Kafka, to Kafka-to-Kafka processing —
not to your consumer's side effects on an external system.

**So every consumer must be idempotent.** Not as a defensive nicety — as a
correctness requirement:

```ts
async function handleOrderPlaced(event: Event) {
  // Deduplicate on the event id, enforced by a unique constraint.
  const inserted = await db.processedEvents.insertIfAbsent(event.id);
  if (!inserted) return; // already handled

  await sendConfirmationEmail(event.data.orderId);
}
```

A check-then-act without a unique constraint races under concurrent delivery.
See
[Data Modelling](/knowledge-base/databases/data-modelling#isolation-levels).

### Ordering

Global ordering is not guaranteed and is expensive to obtain. What you can
usually get is **ordering within a partition key**:

```ts
// Kafka: all events for one order go to the same partition, so they stay ordered
await producer.send({topic: 'orders', messages: [{key: orderId, value: payload}]});
```

Events for _different_ orders may still interleave, which is fine. Design
handlers to be order-independent where you can — check current state rather than
assuming a prior event arrived — and use a sequence number to detect gaps where
you cannot.

### Failure handling

A consumer that keeps failing must not block the queue forever.

- **Retry with exponential backoff and jitter.**
- **Move to a dead-letter queue** after N attempts.
- **Alert on the DLQ.** An unwatched dead-letter queue is a silent data-loss
  mechanism, and it is astonishing how often nobody is looking at it.
- **Make replay possible**, so a fixed bug can be applied to the events it
  mishandled.

---

## The Dual-Write Problem

The commonest correctness bug in event-driven systems, and worth stating
separately because it looks fine in review:

```ts
// ❌ Two systems, no shared transaction. A crash between them loses the event.
await db.orders.insert(order);
await broker.publish('order.placed', order);
```

The database commits and the process dies before publishing. The order exists;
nobody was told. The systems diverge silently, and the divergence is usually
found weeks later.

**The Outbox pattern** is the standard fix:

```ts
await db.transaction(async (tx) => {
  await tx.orders.insert(order);
  await tx.outbox.insert({type: 'order.placed', payload: order}); // atomic together
});

// A separate relay reads unsent outbox rows, publishes them, and marks them sent.
```

The relay guarantees at-least-once delivery, which is why consumers must be
idempotent. Change Data Capture (Debezium) achieves the same thing by reading
the database's write-ahead log.

---

## Transports

|                          | Use for                                  | Note                                                          |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------- |
| **In-process event bus** | A modular monolith                       | No network, no durability — a crash loses events              |
| **Redis Pub/Sub**        | Broadcasting to live subscribers         | **Fire and forget** — offline subscribers miss it permanently |
| **Redis Streams**        | Simple durable queues                    | Consumer groups, acknowledgement, replay                      |
| **RabbitMQ / SQS**       | Task queues, work distribution           | Mature routing, DLQs, per-message acknowledgement             |
| **Kafka / Redpanda**     | Event streaming, replay, high throughput | A durable log; consumers track their own position             |
| **Cloud native**         | EventBridge, Pub/Sub, Service Bus        | Managed, well integrated with the rest of the platform        |

**The Redis Pub/Sub trap is worth calling out.** It looks like a message broker
and delivers only to subscribers connected at that moment. A consumer restarting
during a deploy misses everything published in that window, permanently. Use
Streams if the messages matter.

**Queue or log?** A queue (SQS, RabbitMQ) removes a message once processed — good
for work distribution. A log (Kafka) retains messages so several independent
consumers can each read the whole stream at their own pace, and a new consumer
can replay history. See [Kafka](/knowledge-base/kafka) and
[Queues](/knowledge-base/operations/queues).

---

## Event Sourcing and CQRS

Two ideas frequently mentioned alongside event-driven architecture. **They are
separate, and neither is required.**

**Event Sourcing** stores events as the source of truth rather than current
state. State is derived by replaying them.

```text
OrderPlaced → ItemAdded → ItemRemoved → OrderPaid → OrderShipped
                                    ↓
                            current state, derived
```

You get a complete audit trail, time travel, and the ability to derive new
projections from history. You take on: no simple `UPDATE`, queries need
projections, schema evolution across years of stored events, and snapshotting
for performance. It is genuinely hard to operate, and worth it mainly where the
audit trail _is_ the requirement — finance, healthcare, compliance.

**CQRS** separates the write model from the read model, often with different
storage for each. Useful when reads and writes have genuinely different shapes;
substantial overhead otherwise.

Publishing events for integration does **not** commit you to either.

---

## Debugging

The honest cost of this architecture. In a direct-call system a stack trace
shows the whole flow. Here, nothing does.

What makes it tractable:

- **A correlation id on every event and every log line**, propagated through
  every hop. Without it you cannot reconstruct what happened.
- **Distributed tracing** spanning publish and consume, so one trace shows the
  producer and every downstream consumer. See
  [OpenTelemetry](/knowledge-base/operations/opentelemetry).
- **An event catalogue** documenting each event, its schema and its known
  consumers. Otherwise nobody can answer "what breaks if I change this?"
- **Monitor consumer lag** — how far behind is each consumer? Growing lag is the
  earliest signal of trouble.
- **Alert on the dead-letter queue.**
- **Keep events inspectable.** Being able to look at the raw event that caused a
  problem shortens most investigations dramatically.

---

## Do's and Don'ts

### Do

- Name events in the past tense after what happened.
- Include an id, type, version, timestamp and correlation id.
- Make every consumer idempotent, enforced by a unique constraint.
- Use the Outbox pattern for a state change plus an event.
- Prefer fat events so consumers survive publisher downtime.
- Partition by a key when ordering matters.
- Use a dead-letter queue, and alert on it.
- Maintain an event catalogue and monitor consumer lag.

### Don't

- Don't publish and write to the database as two separate operations.
- Don't assume exactly-once delivery — it does not exist.
- Don't assume global ordering.
- Don't use Redis Pub/Sub for messages that matter.
- Don't publish an event and depend on a specific consumer having handled it.
- Don't make events chatty — one per meaningful business fact.
- Don't adopt Event Sourcing because you are publishing events.
- Don't build this without tracing and correlation ids in place first.

---

## Common Mistakes

**Commands dressed as events.** `order.placed` with exactly one mandatory
consumer. The coupling still exists and is now invisible.

**Event chains.** A triggers B triggers C triggers D. No one place describes the
flow, and a failure at C leaves the system half-updated. Use an orchestrator for
anything with more than two or three steps — see
[Sagas](/knowledge-base/architecture/microservices#sagas).

**Missing idempotency.** Works in testing where duplicates are rare; sends two
emails in production during the first broker retry.

**Unmonitored dead-letter queue.** Silent data loss. Someone finds 40,000
messages in it six months later.

**Events as a database.** Consumers querying the event stream for current state
instead of maintaining a projection.

**Over-eventing.** Publishing an event per field change produces enormous
volume and no clear business meaning. Publish business facts.

**Circular subscriptions.** A publishes X, B reacts by publishing Y, A reacts to
Y by publishing X. Infinite loops are easy to create and hard to spot.

---

## FAQ

**Do I need a message broker to be event-driven?**
No. An in-process event bus inside a modular monolith gives you the decoupling
without the infrastructure — and without durability, so a crash loses events.

**Events or direct calls?**
Direct when the caller needs the result. Events when it is a consequence the
caller need not wait for.

**How do I get exactly-once processing?**
You do not get exactly-once _delivery_. You get exactly-once _effect_ by making
consumers idempotent, which is the achievable and correct goal.

**How long should I keep events?**
For integration, days to weeks — long enough to replay after an incident. For
event sourcing, forever, since they are the source of truth.

**What if a consumer needs data the event does not contain?**
Either enrich the event (fat events), or call the publisher's API. Prefer the
former where practical, so the consumer survives publisher downtime.

**Is this only for microservices?**
No. A modular monolith with an in-process event bus gets much of the decoupling
benefit and is a good stepping stone. See
[Monoliths](/knowledge-base/architecture/monoliths).

---

## Check your understanding

<Quiz
question="A service inserts an order, then publishes 'order.placed'. Occasionally the order exists with no event. What is the correct fix?"
options={[
{
text: 'The Outbox pattern — write the event to a table inside the same transaction as the order, and relay it from there',
correct: true,
why: 'This is the dual-write problem. Two systems with no shared transaction means a crash between them loses the event. Writing both atomically to one database closes the gap.',
},
{text: 'Publish the event first, then insert the order', why: 'It inverts the failure: now consumers can be told about an order that was never created.'},
{text: 'Use a broker with stronger durability guarantees', why: 'Broker durability starts once it has the message. The loss happens before that.'},
{text: 'Retry the publish in a finally block', why: 'The process can die before the finally runs, and the window remains.'},
]}
explanation={<>The relay delivers at-least-once, so pair the outbox with idempotent consumers. Change Data Capture achieves the same thing by tailing the write-ahead log.</>}
reference={{label: 'The dual-write problem', href: '/knowledge-base/architecture/event-driven#the-dual-write-problem'}}
/>

<Quiz
question="A team uses Redis Pub/Sub to distribute order events between services. During a deploy, some orders are never processed. Why?"
options={[
{
text: 'Redis Pub/Sub is fire-and-forget — a subscriber that is restarting is not connected, and messages published in that window are gone permanently',
correct: true,
why: 'Pub/Sub delivers only to currently connected subscribers. It stores nothing, so there is no replay. Redis Streams, with consumer groups and acknowledgement, is the durable alternative.',
},
{text: 'Redis dropped the messages due to memory pressure', why: 'Pub/Sub does not store messages at all, so eviction is not the mechanism.'},
{text: 'The subscribers were not in a consumer group', why: 'Pub/Sub has no consumer groups — that is precisely what Streams adds.'},
{text: 'The events exceeded the maximum message size', why: 'A size limit would fail consistently, not only during a deploy.'},
]}
explanation={<>This trap catches people because Pub/Sub looks like a message broker. If losing a message matters, use Redis Streams, SQS, RabbitMQ or Kafka.</>}
reference={{label: 'Transports', href: '/knowledge-base/architecture/event-driven#transports'}}
/>

<Quiz
question="Which statements about delivery guarantees are correct?"
type="multiple"
options={[
{text: 'At-least-once is what you get in practice, so consumers must be idempotent', correct: true, why: 'Retries after an unacknowledged delivery are how brokers avoid loss, which necessarily permits duplicates.'},
{text: 'Exactly-once delivery is not achievable across a network', correct: true, why: 'You can achieve exactly-once _effect_ through idempotency, which is the useful goal.'},
{text: "Kafka's exactly-once semantics does not cover side effects on external systems", correct: true, why: 'It applies to Kafka-to-Kafka processing. Sending an email is outside that boundary.'},
{text: 'Deduplication needs a unique constraint, not a check-then-insert', correct: true, why: 'Concurrent delivery of the same event races between the check and the insert; only the constraint is safe.'},
{text: 'Global ordering across all events is guaranteed by most brokers', why: 'Ordering is typically guaranteed only within a partition. Events for different keys interleave.'},
]}
explanation={<>Everything downstream follows from at-least-once: idempotent consumers, deduplication on event id, and handlers that tolerate arriving out of order.</>}
reference={{label: 'Delivery guarantees', href: '/knowledge-base/architecture/event-driven#delivery-guarantees'}}
/>

<Quiz
question="A team publishes 'order.placed' but the billing service must handle it for the system to work — if billing is broken, orders are never invoiced and nobody notices. What is the design problem?"
options={[
{
text: 'This is a command disguised as an event — the publisher genuinely depends on a specific consumer, but the dependency is now invisible',
correct: true,
why: 'Events are facts with zero-to-many optional consumers. When exactly one consumer is mandatory, the coupling still exists and has only been hidden from the code and from monitoring.',
},
{text: 'Nothing — this is normal event-driven design', why: 'Normal if billing is genuinely optional. If the business breaks without it, the relationship is a command.'},
{text: 'The event name should be present tense', why: 'Past tense is correct for events. Naming is not the issue.'},
{text: 'Billing should poll the database instead', why: 'That trades an invisible dependency for a worse one, and adds load.'},
]}
explanation={<>Either send an explicit command with a single known handler, or keep the event and add monitoring — consumer lag, DLQ alerts, and a reconciliation check — so a broken consumer is loud rather than silent.</>}
reference={{label: 'Events, commands and messages', href: '/knowledge-base/architecture/event-driven#events-commands-and-messages'}}
/>

<Quiz
question="What single practice most determines whether an event-driven system is debuggable?"
options={[
{
text: 'A correlation id attached to every event and log line and propagated through every hop',
correct: true,
why: 'Without it there is no way to reconstruct which events and log lines belong to one user action — and no stack trace spans the system.',
},
{text: 'Verbose logging in every consumer', why: 'Volume without correlation makes reassembling a single flow harder, not easier.'},
{text: 'Keeping the number of consumers small', why: 'Helpful, but even two consumers are hard to trace without correlation.'},
{text: 'Using a single broker technology throughout', why: 'Consistency is convenient and does nothing on its own for tracing a request.'},
]}
explanation={<>Build correlation ids and distributed tracing in <em>before</em> the system grows. Retrofitting them across a dozen consumers after an incident is far more expensive than adding them at the start.</>}
reference={{label: 'Debugging', href: '/knowledge-base/architecture/event-driven#debugging'}}
/>

---

## References

- [Martin Fowler: What do you mean by "Event-Driven"?](https://martinfowler.com/articles/201701-event-driven.html)
  — the distinctions between notification, state transfer, sourcing and CQRS.
- [microservices.io: Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html)
  — the dual-write fix.
- [Designing Data-Intensive Applications](https://dataintensive.net/) —
  Kleppmann; chapter 11 is the definitive treatment of streams and delivery
  guarantees.
- [Kafka: Exactly-once semantics](https://kafka.apache.org/documentation/#semantics)
  — what it does and does not cover.
- [CloudEvents](https://cloudevents.io/) — a standard event envelope, if you
  would rather not invent one.
- [Debezium](https://debezium.io/) — Change Data Capture as an outbox
  alternative.
