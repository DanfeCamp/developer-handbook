---
title: 'Queues'
description: 'Deferring work so requests stay fast — delivery semantics, idempotency, retries, dead-letter queues, ordering and choosing a broker.'
---

# Queues

## Introduction

A queue lets a request hand off slow work — sending email, generating a report,
processing an upload — and return immediately.

```
❌ Inline:  request → charge card → send email → generate PDF → respond   (8s)
✅ Queued:  request → charge card → enqueue → respond                     (300ms)
                                        ↓
                              worker → send email → generate PDF
```

**What you gain:** fast responses, burst absorption, retries for free, and the
ability to scale workers independently of web servers.

**What you pay:** the work is now asynchronous. There is no user watching when
it fails, so you need retries, dead-letter handling, monitoring and idempotency.
**A queue does not remove failure — it moves failure somewhere nobody is
looking.** That is the trade, and it is usually worth making, but it must be made
deliberately.

**Queue when:**

- The work takes more than a second or two.
- It calls a third party that can be slow or unavailable.
- It can be retried safely.
- The user does not need the result in the response.

**Do not queue when:**

- The user needs the result immediately.
- The operation is fast and reliable.
- Ordering with other operations is critical and hard to guarantee.

---

## Core Concepts

| Term                        | Meaning                                            |
| --------------------------- | -------------------------------------------------- |
| **Producer**                | Publishes a message                                |
| **Consumer / Worker**       | Receives and processes it                          |
| **Broker**                  | The system holding messages                        |
| **Acknowledgement (ack)**   | The worker confirming successful processing        |
| **Visibility timeout**      | How long a message is hidden while being processed |
| **Dead-letter queue (DLQ)** | Where repeatedly failing messages go               |

**Acknowledge after the work succeeds, never before.** Acking on receipt means a
crash mid-processing loses the message silently. Acking after means a crash
causes redelivery — which is why handlers must be idempotent.

**The visibility timeout must exceed the longest realistic processing time.**
Otherwise the broker concludes the worker died and redelivers to a second worker
while the first is still working. You then have two workers processing the same
message, and if your handler is not idempotent, two charges or two emails.

---

## Delivery Semantics

| Guarantee         | Reality                                                  |
| ----------------- | -------------------------------------------------------- |
| **At-most-once**  | May be lost; never duplicated. Rarely what you want      |
| **At-least-once** | Never lost; may be duplicated. **The practical default** |
| **Exactly-once**  | Does not exist end-to-end, whatever the marketing says   |

**"Exactly-once" is achievable only within a system that controls both the
message log and the state store** — Kafka's transactional writes back into Kafka,
for instance. The moment your handler sends an email or calls a payment API, no
broker can undo it, and exactly-once evaporates.

**So: assume at-least-once, and make handlers idempotent.** This is the single
most important design rule for queue-based systems, and it is the one most often
skipped.

```js
async function handleOrderPaid(job) {
  const {orderId, eventId} = job.data;

  // Idempotency key — a unique index makes the second attempt a no-op
  const inserted = await db.processedEvents.insertIfAbsent({eventId});
  if (!inserted) return; // already handled

  await fulfilOrder(orderId);
}
```

**Idempotency in practice:**

- A **unique constraint** on an event or idempotency key — the database enforces
  it, which is the most reliable option available.
- **Natural idempotency**: `UPDATE orders SET status='paid'` is safe to repeat;
  `UPDATE balance SET amount = amount + 100` is not.
- **Idempotency keys with third parties.** Stripe and most payment APIs accept
  one, so a repeated request returns the original result rather than charging
  twice.

---

## Retries and Backoff

```js
await queue.add(
  'send-email',
  {userId, template},
  {
    attempts: 5,
    backoff: {type: 'exponential', delay: 1000}, // 1s, 2s, 4s, 8s, 16s
    removeOnComplete: 1000,
    removeOnFail: false,
  },
);
```

**Exponential backoff with jitter.** Fixed-interval retries from many workers
synchronise into a thundering herd against a service that is already struggling —
which is how a slow dependency becomes a dead one.

**Distinguish retryable from permanent failures.** A network timeout should
retry. A validation error never will succeed, and retrying it five times wastes
capacity and delays everything behind it:

```js
if (err.status >= 400 && err.status < 500) {
  throw new UnrecoverableError(err.message); // straight to the DLQ
}
throw err; // retry
```

**Dead-letter queues catch what never succeeds.** Without one, a poison message
retries forever, consuming a worker permanently.

**A DLQ nobody looks at is a folder of silently dropped work.** Alert on its
depth, review it, and have a documented way to replay after a fix. This is the
most commonly neglected part of a queue setup.

---

## Ordering

**Most queues do not guarantee order**, and most work does not need it.

Order breaks down for good reasons: multiple workers process concurrently,
retries reorder relative to new messages, and partitioned brokers only order
within a partition.

**When you genuinely need ordering:**

- **Partition by key.** Kafka orders within a partition; SQS FIFO orders within a
  message group. Keying by entity ID gives per-entity ordering with parallelism
  across entities — which is almost always the actual requirement.
- **A single consumer**, if throughput allows.

**Better: design so order does not matter.** Include a version or timestamp in
the message and ignore anything older than the current state. An
order-independent handler is far more robust than an ordering guarantee you must
maintain forever.

---

## Choosing a Broker

| Broker                             | Best for                                       | Watch out for                           |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------- |
| **Redis (BullMQ, Sidekiq)**        | Job queues in an app you already run Redis for | Durability depends on Redis persistence |
| **RabbitMQ**                       | Complex routing, per-message acks, priorities  | An extra system to operate              |
| **AWS SQS**                        | Managed, simple, cheap                         | Polling latency; FIFO throughput limits |
| **PostgreSQL (`SKIP LOCKED`)**     | Low volume, transactional with your data       | Not built for high throughput           |
| **[Kafka](/knowledge-base/kafka)** | Event streaming, replay, many consumers        | Heavy for a job queue                   |

**Start with what you already run.** If you have Redis, BullMQ or Sidekiq is
excellent and needs no new infrastructure. If you have PostgreSQL and modest
volume, `SELECT ... FOR UPDATE SKIP LOCKED` is a perfectly good queue — and it
lets you enqueue in the same transaction as your write, which eliminates a whole
class of consistency bug.

**Kafka is not a job queue.** It is a distributed log for event streaming with
replay and multiple independent consumers. Using it for background jobs means
managing offsets and partitions to solve a problem BullMQ solves in ten lines.

---

## The Dual-Write Problem

The subtle bug that catches almost every team building queue-based systems.

```js
// ❌ Two systems, no atomicity
await db.orders.create(order); // succeeds
await queue.add('order-created', {orderId}); // fails — process crashes
// The order exists. Nothing will ever process it.
```

**Two writes to different systems cannot be made atomic.** Whichever order you
choose, a crash between them leaves the systems inconsistent: either an order
with no job, or a job for an order that does not exist.

**The transactional outbox pattern** solves it:

```js
await db.transaction(async (tx) => {
  await tx.orders.create(order);
  await tx.outbox.insert({topic: 'order-created', payload: {orderId}});
});
// A separate process reads the outbox and publishes, marking rows as sent.
```

One transaction, one system, so either both rows commit or neither does. A
relay publishes from the outbox and can retry safely because the row is still
there.

**With a database-backed queue you get this for free**, since the job insert is
part of the same transaction. That is a real and underrated argument for
`SKIP LOCKED` at modest volume.

---

## Monitoring

**Queue depth is the primary signal.** Growing depth means consumption is slower
than production, and it is the earliest warning you get.

Track:

- **Depth**, per queue — and alert on sustained growth, not a single spike.
- **Oldest message age.** More actionable than depth: "the oldest unprocessed
  job is 40 minutes old" is immediately meaningful.
- **Processing rate and duration.**
- **Failure rate and DLQ depth.** Alert on any DLQ growth.
- **Worker liveness.** Workers die silently; a queue with zero consumers looks
  healthy until you check.

**Alert on the oldest message age rather than depth alone.** A queue with ten
thousand fast jobs is fine; a queue with three jobs stuck for an hour is not.

See [Monitoring](/knowledge-base/operations/monitoring).

---

## Do's and Don'ts

### Do

- Make every handler idempotent.
- Acknowledge only after the work succeeds.
- Set the visibility timeout above the longest realistic processing time.
- Use exponential backoff with jitter.
- Separate retryable from permanent failures.
- Configure a dead-letter queue, and alert on it.
- Keep message payloads small — pass IDs, not objects.
- Use the outbox pattern when enqueueing alongside a database write.
- Monitor queue depth and oldest message age.
- Partition by key when you need per-entity ordering.

### Don't

- Don't assume exactly-once delivery.
- Don't ack before processing.
- Don't retry validation errors.
- Don't queue without a DLQ.
- Don't put large payloads or secrets in messages.
- Don't rely on global ordering.
- Don't write to the database and the queue as two independent operations.
- Don't use Kafka as a job queue.
- Don't leave a DLQ unmonitored.

---

## Common Mistakes

**Non-idempotent handlers.** At-least-once delivery means duplicates, and
duplicates mean two emails or two charges.

**Acking on receipt.** A crash mid-processing loses the message with no trace.

**Visibility timeout too short.** Two workers process the same message
concurrently.

**Retrying permanent failures.** Five attempts at a validation error, delaying
everything behind it.

**No dead-letter queue.** A poison message retries forever and occupies a worker
permanently.

**An unmonitored DLQ.** Work silently dropped for months.

**The dual-write problem.** An order with no job, or a job for a missing order.
Use an outbox.

**Large payloads.** Store the data and pass an ID; brokers have size limits and
large messages slow everything down.

**Fixed-interval retries.** Synchronised herds against an already-struggling
dependency.

**No worker monitoring.** Workers die; the queue grows; nobody notices until
users complain.

---

## Debugging

| Symptom                      | Cause                                                 |
| ---------------------------- | ----------------------------------------------------- |
| Queue depth growing          | Too few workers, or handlers slower than arrival rate |
| Jobs processed twice         | Non-idempotent handler; visibility timeout too short  |
| Jobs disappearing            | Acked before processing; or a DLQ nobody checks       |
| Worker idle, queue full      | Consumer crashed or lost its connection               |
| Job stuck retrying           | Permanent failure not classified; no attempt limit    |
| Enqueued but never runs      | Wrong queue name; or the dual-write problem           |
| Memory growing on the broker | Completed jobs retained; set `removeOnComplete`       |
| Ordering violated            | Multiple workers, or retries reordering               |

**Check worker liveness first.** A queue backing up almost always means the
consumers stopped, and that is faster to check than anything else.

---

## FAQ

**Which library for Node?**
BullMQ, backed by Redis. Mature, well documented, with backoff, DLQs, priorities
and repeatable jobs.

**Can I use my database as a queue?**
Yes, with `SELECT ... FOR UPDATE SKIP LOCKED`. Excellent up to a few hundred jobs
per second, and it gives you transactional enqueueing.

**How many workers?**
Enough that queue depth stays near zero at peak. Scale on oldest message age. For
I/O-bound work, concurrency within a worker often beats more processes.

**What if a job must not run twice, ever?**
Enforce it in the database with a unique constraint on an idempotency key. Do not
rely on the broker.

**How do I handle jobs that take hours?**
Split them into smaller jobs, or use a workflow engine (Temporal, Step
Functions). Long-running jobs interact badly with visibility timeouts and
deploys.

**How do I test queue-based code?**
Test the handler as a plain function with a synthetic message — that covers most
of the logic. Add integration tests with a real broker in a container for the
delivery behaviour.

---

## Check your understanding

<Quiz
question="A worker charges a customer's card and acknowledges the message. Under load, some customers are charged twice. What is the most likely cause?"
options={[
{
text: 'The handler is not idempotent, and at-least-once delivery redelivered the message — often because the visibility timeout was shorter than processing time',
correct: true,
why: 'Every practical broker is at-least-once. If a worker is slow, the broker assumes it died and redelivers, so two workers charge the same card.',
},
{text: 'The broker guarantees exactly-once and is misconfigured', why: 'End-to-end exactly-once does not exist once the handler calls an external API — no broker can un-charge a card.'},
{text: 'Two producers enqueued the same job', why: 'Possible, and the load correlation points at redelivery rather than duplicate production.'},
{text: 'The retry backoff is too short', why: 'Backoff affects timing of retries, not whether a successful charge is repeated.'},
]}
explanation={<>Assume at-least-once and make handlers idempotent: a unique constraint on an event ID, or an idempotency key passed to the payment API so a repeated request returns the original charge. Also set the visibility timeout above your longest realistic processing time.</>}
reference={{label: 'Delivery semantics', href: '/knowledge-base/operations/queues#delivery-semantics'}}
/>

<Quiz
question="Code creates an order in the database, then enqueues a job to fulfil it. Occasionally an order exists with no job ever having run. Why, and what fixes it?"
options={[
{
text: 'The dual-write problem — two writes to different systems cannot be atomic. The transactional outbox pattern fixes it',
correct: true,
why: 'A crash between the two writes leaves them inconsistent whichever order you choose. Writing the message into an outbox table inside the same transaction makes it one atomic write.',
},
{text: 'The queue silently dropped the message', why: 'Possible in principle, and the pattern of an order existing without a job points at the enqueue never happening.'},
{text: 'The job was consumed by the wrong worker', why: 'It would still have run — the symptom is that nothing ran at all.'},
{text: 'The database transaction rolled back after the enqueue', why: 'That produces the opposite: a job for an order that does not exist.'},
]}
explanation={<>Insert the message into an <code>outbox</code> table in the same transaction as the order, and have a relay publish from it. With a database-backed queue using <code>SKIP LOCKED</code> you get this for free — a real and underrated argument for it at modest volume.</>}
reference={{label: 'The dual-write problem', href: '/knowledge-base/operations/queues#the-dual-write-problem'}}
/>

<Quiz
question="A queue has no dead-letter queue configured. A message fails with a validation error that will never succeed. What happens?"
options={[
{
text: 'It retries indefinitely, occupying a worker permanently and delaying every other message behind it',
correct: true,
why: 'A poison message with no attempt limit and nowhere to go cycles forever, consuming capacity that valid work needs.',
},
{text: 'The broker discards it after a default timeout', why: 'Some brokers have message TTLs, and relying on silent expiry means losing the work with no record.'},
{text: 'It is automatically moved to a system queue for inspection', why: 'That is exactly what a DLQ is, and it must be configured.'},
{text: 'The worker crashes and restarts cleanly', why: 'A validation error is handled, not fatal — it simply fails and retries.'},
]}
explanation={<>Classify failures: throw an unrecoverable error for 4xx-style permanent failures so they go straight to the DLQ, and retry only what might succeed. Then alert on DLQ depth — an unmonitored DLQ is a folder of silently dropped work.</>}
reference={{label: 'Retries and backoff', href: '/knowledge-base/operations/queues#retries-and-backoff'}}
/>

<Quiz
question="Which of these are sound queue practices?"
type="multiple"
options={[
{text: 'Acknowledging only after the work succeeds', correct: true, why: 'Acking on receipt means a crash mid-processing loses the message with no trace.'},
{text: 'Exponential backoff with jitter on retries', correct: true, why: 'Fixed intervals synchronise many workers into a thundering herd against a dependency that is already struggling.'},
{text: 'Passing entity IDs in messages rather than full objects', correct: true, why: 'Brokers have size limits, large messages slow everything down, and the worker can read current state rather than stale embedded data.'},
{text: 'Alerting on the oldest message age, not only queue depth', correct: true, why: 'Ten thousand fast jobs is fine; three jobs stuck for an hour is not. Age is the more actionable signal.'},
{text: 'Using Kafka as the default job queue for background tasks', why: 'Kafka is a distributed log for event streaming with replay and multiple consumers. For background jobs it means managing offsets and partitions to solve what BullMQ solves in ten lines.'},
]}
explanation={<>Start with what you already run: Redis with BullMQ or Sidekiq, or PostgreSQL with <code>SKIP LOCKED</code> at modest volume. New infrastructure should be a response to a requirement, not a default.</>}
reference={{label: 'Choosing a broker', href: '/knowledge-base/operations/queues#choosing-a-broker'}}
/>

<Quiz
question="A system needs events for a given customer processed in order, but wants parallelism across customers. What is the right approach?"
options={[
{
text: 'Partition by customer ID — Kafka orders within a partition and SQS FIFO within a message group, so each customer is ordered while different customers process concurrently',
correct: true,
why: 'Per-entity ordering with cross-entity parallelism is almost always the actual requirement, and partitioning by key delivers exactly that.',
},
{text: 'Use a single consumer to guarantee global ordering', why: 'It guarantees ordering and eliminates the parallelism that was required.'},
{text: 'Sort messages by timestamp in the consumer before processing', why: 'A consumer sees messages one at a time and cannot know whether an earlier one is still in flight.'},
{text: 'Increase the visibility timeout so messages are processed sequentially', why: 'Visibility timeouts control redelivery, not ordering between distinct messages.'},
]}
explanation={<>Better still where you can manage it: design handlers so order does not matter. Include a version or timestamp and ignore anything older than the current state — an order-independent handler is far more robust than an ordering guarantee you must maintain forever.</>}
reference={{label: 'Ordering', href: '/knowledge-base/operations/queues#ordering'}}
/>

---

## References

- [RabbitMQ tutorials](https://www.rabbitmq.com/tutorials) — acknowledgement,
  routing and delivery, explained clearly.
- [AWS SQS Developer Guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
  — visibility timeouts, FIFO queues and DLQs.
- [BullMQ documentation](https://docs.bullmq.io/) — jobs, backoff, DLQs and
  repeatable jobs on Redis.
- [microservices.io: Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html)
  — the dual-write solution.
- [PostgreSQL: SELECT FOR UPDATE SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
  — the database-as-queue primitive.
- [Background Workers](/knowledge-base/operations/background-workers) — running
  the consumers in production.
