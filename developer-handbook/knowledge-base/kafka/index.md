---
title: 'Apache Kafka'
description: 'A distributed log for high-throughput event streaming — topics, partitions, consumer groups, delivery semantics, schemas, and when not to use it.'
---

# Apache Kafka

## Introduction

**Kafka is an append-only distributed log, not a message queue.** That single
distinction explains everything else about it.

In a queue, a message is delivered and then deleted. In Kafka, messages are
written to a log, retained for a configured period, and **consumers track their
own position**. Nothing is removed when it is read.

|                    | Queue (SQS, RabbitMQ) | Kafka                                  |
| ------------------ | --------------------- | -------------------------------------- |
| After consumption  | Message deleted       | Message retained                       |
| Position           | Broker tracks it      | Consumer tracks its offset             |
| Multiple consumers | Compete for messages  | Each reads the whole log independently |
| Replay             | Impossible            | Reset the offset and reread            |
| Throughput         | High                  | Very high — millions/sec               |

**What that buys you:**

- **Replay.** A bug in a consumer? Fix it, reset the offset, reprocess a week of
  events.
- **Multiple independent consumers.** Analytics, search indexing and email
  notifications all read the same stream without coordinating.
- **A durable event history**, not just a transport.

**What it costs:** operational weight, partition and offset management, and a
model your team has to learn. **Kafka is not a job queue.** Using it for
background jobs means solving offset and partition problems to do what BullMQ
does in ten lines. See [Queues](/knowledge-base/operations/queues).

**Version note.** Kafka 4.0 (March 2025) **removed ZooKeeper entirely** — KRaft
is now the only mode, and any material referencing ZooKeeper predates it. The
current line is 4.3.x. Kafka 4.1 introduced **Queues for Kafka (KIP-932)** in
preview: share groups that allow queue-like competing consumption without
partition-bound assignment. Treat it as evaluation-only until it is marked
production-ready.

---

## Core Concepts

```
Topic: orders
├── Partition 0:  [0][1][2][3][4] ←── producer (key: "cust-A")
├── Partition 1:  [0][1][2]       ←── producer (key: "cust-B")
└── Partition 2:  [0][1][2][3]    ←── producer (key: "cust-C")
                      ↑
              consumer group "billing" offset = 1
```

| Concept            | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| **Topic**          | A named stream of records                                |
| **Partition**      | An ordered, immutable sequence — the unit of parallelism |
| **Offset**         | A record's position within a partition                   |
| **Producer**       | Writes records                                           |
| **Consumer group** | Consumers sharing the work of a topic                    |
| **Broker**         | A server holding partitions                              |
| **KRaft**          | The built-in consensus protocol that replaced ZooKeeper  |

**Partitions are the concept to understand properly:**

- **Ordering is guaranteed within a partition, never across a topic.**
- **The partition is chosen by the record key** — same key, same partition. Key
  by entity ID and you get per-entity ordering with parallelism across entities,
  which is nearly always the actual requirement.
- **Partition count sets the maximum parallelism**: one partition can be read by
  at most one consumer in a group. Ten partitions means at most ten useful
  consumers; an eleventh sits idle.
- **You can add partitions, never remove them** — and adding them changes the
  key-to-partition mapping, so existing keys move and ordering breaks across the
  change. Choose generously at the start.

**Consumer groups are how scaling works.** Partitions are divided among the
group's members. Add a consumer and partitions are reassigned; a consumer dies
and its partitions move elsewhere. **Different groups are entirely independent**
— each has its own offsets and reads everything.

---

## Producing

```js
import {Kafka} from 'kafkajs';

const kafka = new Kafka({clientId: 'orders-api', brokers: ['kafka:9092']});
const producer = kafka.producer({idempotent: true});

await producer.connect();
await producer.send({
  topic: 'orders',
  messages: [
    {
      key: order.customerId, // decides the partition — and the ordering
      value: JSON.stringify({eventId, orderId: order.id, total: order.total}),
      headers: {traceparent: currentTraceparent()},
    },
  ],
});
```

**`acks` controls the durability/latency trade:**

| Setting    | Behaviour                                                                |
| ---------- | ------------------------------------------------------------------------ |
| `acks=0`   | Fire and forget. Fast; loses data on any failure                         |
| `acks=1`   | Leader acknowledges. Loses data if the leader fails before replication   |
| `acks=all` | All in-sync replicas acknowledge. **Use this for anything that matters** |

**`enable.idempotence=true`** prevents duplicates caused by producer retries, and
it is the default in modern clients. It gives exactly-once semantics _within
Kafka_ — which is not the same as exactly-once end to end, and the distinction
matters the moment your consumer calls an external API.

**Always set a key** unless you genuinely do not care about ordering. A null key
round-robins across partitions, and per-entity ordering is lost.

**Batch and compress.** Producers batch by default; `linger.ms` trades a little
latency for much better throughput, and `compression.type=lz4` or `zstd` reduces
network and storage substantially.

**Put trace context in headers**, so the consumer's work joins the trace that
produced the event. See
[OpenTelemetry](/knowledge-base/operations/opentelemetry#context-propagation).

---

## Consuming

```js
const consumer = kafka.consumer({groupId: 'billing'});

await consumer.connect();
await consumer.subscribe({topic: 'orders', fromBeginning: false});

await consumer.run({
  eachMessage: async ({topic, partition, message}) => {
    const event = JSON.parse(message.value.toString());

    // Idempotent: a unique index makes redelivery a no-op
    const first = await db.processedEvents.insertIfAbsent({eventId: event.eventId});
    if (first) await chargeCustomer(event);
    // offset committed automatically after this returns successfully
  },
});
```

**Offset commits decide your delivery semantics:**

- **Commit after processing** → at-least-once. A crash before the commit means
  redelivery. **This is what you want**, with idempotent handlers.
- **Commit before processing** → at-most-once. A crash loses the message.
- **Auto-commit on an interval** is the default and is subtly at-least-once with
  a wider window than you expect — commits happen on a timer, not per message.

**Assume at-least-once and make handlers idempotent.** Same rule as any queue,
and Kafka's ordering makes it no less necessary.

**Rebalancing is the operational hazard.** When a consumer joins, leaves or is
declared dead, partitions are reassigned and processing pauses. Causes to watch:

- **Slow processing exceeding `max.poll.interval.ms`** — the broker concludes the
  consumer is dead. **The most common cause of a consumer group that thrashes and
  never makes progress.** Process faster, fetch fewer records, or raise the
  interval.
- **Frequent restarts** during deploys.

**The new consumer group protocol (KIP-848)**, stable since 4.0, makes
rebalancing incremental rather than stop-the-world. It is a substantial
improvement and worth enabling on new deployments.

**Consumer lag is the health metric** — how far behind the log end each partition
is. Growing lag means consumption is slower than production.

---

## Retention and Compaction

Kafka deletes by policy, not by consumption.

```properties
# Time and size based
retention.ms=604800000        # 7 days
retention.bytes=10737418240   # 10 GB per partition

# Or keep the latest value per key, forever
cleanup.policy=compact
```

**Log compaction retains the most recent record per key** and discards older
ones. This turns a topic into a durable key-value snapshot: replay it from the
beginning and you get current state for every key.

**It is what makes event sourcing and change-data-capture work on Kafka.** A new
service can bootstrap its entire state by reading a compacted topic from offset
zero.

**Retention is a design decision, not a default to accept.** Seven days is
typical for events. Compacted topics for state are kept indefinitely. Choose
based on how far back you would realistically need to replay — that is the
question retention actually answers.

---

## Schemas

A topic is a contract between systems that deploy independently. Without schema
management, one producer change breaks every consumer.

**Use a schema registry** — Confluent Schema Registry or Apicurio — with Avro,
Protobuf or JSON Schema. It enforces compatibility at publish time rather than
at 3 a.m.

**Compatibility modes:**

| Mode         | Allows                                                           |
| ------------ | ---------------------------------------------------------------- |
| **Backward** | New consumers read old data — add optional fields, remove fields |
| **Forward**  | Old consumers read new data — add fields, remove optional ones   |
| **Full**     | Both                                                             |

**Backward compatibility is the usual default**, because consumers are typically
upgraded first.

**The rules that keep a topic evolvable:**

- Add fields as optional, with defaults.
- Never change a field's type.
- Never reuse a field name for different meaning.
- Never remove a required field.

**Without a registry, use versioned event types** and tolerate unknown fields.
Consumers must ignore what they do not recognise — a consumer that fails on an
unexpected field makes every producer change a coordinated deploy.

---

## When Not to Use Kafka

Worth being direct about, because Kafka is adopted far more often than it is
needed.

**Use something simpler when:**

- **You want a job queue.** BullMQ, Sidekiq, SQS or PostgreSQL `SKIP LOCKED`.
  Kafka has no per-message ack, no visibility timeout, no native DLQ, and no
  priorities.
- **You have one producer and one consumer.** That is a queue.
- **Volume is modest.** Below a few thousand messages a second, almost anything
  works and most things are easier to run.
- **You need per-message retry and delay.** Kafka's ordered log makes retrying
  one message awkward: you either block the partition or republish to a retry
  topic.
- **Nobody wants to operate it.** Self-managed Kafka is real work. Managed
  options — Confluent Cloud, MSK, Redpanda Cloud, Aiven — remove most of it at a
  cost.

**Use Kafka when:**

- Multiple independent consumers need the same event stream.
- You need replay, or the event history is itself valuable.
- Throughput is genuinely high.
- You are building event sourcing or change-data-capture.

**The honest test:** if you cannot name a second consumer, or a reason you would
replay, you probably want a queue.

---

## Operations

**KRaft only, from 4.0 onwards.** Controllers manage metadata; there is no
ZooKeeper. Simpler to run, faster failover, and it supports far more partitions.

**Replication:** `replication.factor=3` and `min.insync.replicas=2` is the
standard production pairing — it tolerates one broker failure while still
requiring two acknowledgements. With `acks=all`, that combination is what
actually protects your data.

**Sizing:**

- **Partitions**: enough for your peak consumer parallelism plus headroom.
  Hundreds are fine; tens of thousands per cluster need care.
- **Disk**: retention × throughput × replication factor. It adds up quickly.
- **Memory**: Kafka relies on the OS page cache. Give it RAM and do not
  over-allocate JVM heap.

**Monitor:**

- **Consumer lag**, per group and partition — the primary signal.
- **Under-replicated partitions** — should always be zero.
- **Broker disk usage** — a full broker is an outage.
- **Request latency** and **rebalance frequency**.

**Rack awareness** spreads replicas across availability zones, so one zone's loss
does not take a partition with it.

---

## Do's and Don'ts

### Do

- Set a message key to control partitioning and ordering.
- Use `acks=all` with `min.insync.replicas=2` for data you care about.
- Enable producer idempotence.
- Make consumers idempotent — assume at-least-once.
- Commit offsets after processing, not before.
- Use a schema registry with backward compatibility.
- Choose partition count generously at creation.
- Monitor consumer lag and under-replicated partitions.
- Use compacted topics for state, time-retained topics for events.
- Propagate trace context in headers.

### Don't

- Don't use Kafka as a job queue.
- Don't expect ordering across partitions.
- Don't assume exactly-once end to end.
- Don't let processing exceed `max.poll.interval.ms`.
- Don't add partitions to a keyed topic casually — the mapping changes.
- Don't publish without a schema contract.
- Don't run with `replication.factor=1` in production.
- Don't follow ZooKeeper-era documentation.
- Don't block a partition retrying one message.

---

## Common Mistakes

**Using it as a queue.** No per-message ack, no visibility timeout, no DLQ, no
priorities. Everything you want is awkward.

**No message key.** Round-robin partitioning, and per-entity ordering is gone.

**Expecting topic-wide ordering.** It exists only within a partition, and it
always did.

**Rebalance loops.** Processing exceeds `max.poll.interval.ms`, the consumer is
declared dead, partitions move, and the group never makes progress.

**Too few partitions.** Consumer parallelism is capped, and increasing them later
breaks key affinity.

**Auto-commit misunderstood.** Offsets commit on a timer, so a crash reprocesses
more than expected — fine with idempotent handlers, surprising without them.

**No schema management.** One producer change breaks every consumer
simultaneously.

**`acks=1` for critical data.** Silent loss when a leader fails before
replication.

**Retrying in place.** Blocking the partition to retry one message stops
everything behind it. Use a retry topic.

**Following old documentation.** ZooKeeper instructions no longer apply at all.

---

## Debugging

```bash
# Consumer group state and lag per partition
kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --describe --group billing

# Topic configuration and partition leadership
kafka-topics.sh --bootstrap-server kafka:9092 --describe --topic orders

# Read from the end to see what is arriving
kafka-console-consumer.sh --bootstrap-server kafka:9092 \
  --topic orders --property print.key=true
```

| Symptom                     | Cause                                                     |
| --------------------------- | --------------------------------------------------------- |
| Lag growing                 | Too few consumers, slow processing, or too few partitions |
| Consumer group thrashing    | `max.poll.interval.ms` exceeded                           |
| Some consumers idle         | More consumers than partitions                            |
| Messages out of order       | Different partitions, or a null key                       |
| Messages processed twice    | Normal at-least-once; the handler must be idempotent      |
| Under-replicated partitions | Broker down, slow disk, or network issues                 |
| Producer timeouts           | `min.insync.replicas` unsatisfiable — a broker is down    |
| Cannot consume old messages | Retention expired                                         |

**`kafka-consumer-groups.sh --describe` first.** It shows per-partition lag,
which consumer owns each partition, and whether the group is stable. Most Kafka
debugging starts and often ends there.

---

## FAQ

**Kafka or RabbitMQ?**
RabbitMQ for routing, per-message acks and job queues. Kafka for event streaming,
replay and multiple independent consumers. They solve different problems, and
teams choose Kafka for RabbitMQ's problems far more often than the reverse.

**Do I need ZooKeeper?**
No. It was removed in Kafka 4.0. Any guide that mentions it is out of date.

**What about Redpanda?**
A Kafka-API-compatible broker written in C++, with no JVM and simpler operations.
A reasonable choice if you want the API without the JVM tuning.

**How many partitions?**
At least your peak consumer count, with headroom. Twelve to twenty-four is a
sensible starting range for a moderate topic. Increasing later changes key
mapping.

**Can I use Kafka for request/response?**
Technically, and you should not. Use HTTP or gRPC. Kafka is for asynchronous
event flow.

**Managed or self-hosted?**
Managed unless you have a platform team. Confluent Cloud, MSK, Aiven and
Redpanda Cloud all remove the operational burden, and the cost is usually less
than the engineer-time it replaces.

**What are Queues for Kafka?**
KIP-932 share groups, in preview since 4.1 — competing consumption without
partition-bound assignment, closer to traditional queue semantics. Promising,
and not yet a reason to choose Kafka over a queue.

---

## Check your understanding

<Quiz
question="A team uses Kafka for background jobs — sending emails, generating PDFs — and finds retrying a single failed message awkward. What is the underlying mismatch?"
options={[
{
text: 'Kafka is an ordered log with per-partition offsets, not a queue with per-message acknowledgement, visibility timeouts or dead-letter handling',
correct: true,
why: 'Consumers advance an offset through an ordered partition. Retrying one message means either blocking the partition or republishing to a retry topic — both awkward compared with a queue that acks individually.',
},
{text: 'Kafka cannot deliver messages reliably enough for job processing', why: 'Delivery is highly reliable; the mismatch is in the consumption model.'},
{text: 'Kafka lacks the throughput for background job volumes', why: 'Throughput is Kafka\'s strongest characteristic.'},
{text: 'Kafka requires ZooKeeper, which complicates job processing', why: 'ZooKeeper was removed in Kafka 4.0, and it was never relevant to this.'},
]}
explanation={<>The honest test for choosing Kafka: can you name a second independent consumer of the stream, or a reason you would replay it? If not, you want a queue — BullMQ, Sidekiq, SQS, or PostgreSQL with <code>SKIP LOCKED</code>.</>}
reference={{label: 'When not to use Kafka', href: '/knowledge-base/kafka#when-not-to-use-kafka'}}
/>

<Quiz
question="Events for a given customer are being processed out of order, despite being produced in sequence. What is the most likely cause?"
options={[
{
text: 'Messages are published without a key, so they round-robin across partitions — and ordering is only guaranteed within a partition',
correct: true,
why: 'The key determines the partition. With a null key, records for one customer scatter across partitions and are consumed concurrently with no ordering between them.',
},
{text: 'The consumer group has too many members', why: 'More consumers than partitions leaves some idle; it does not reorder within a partition.'},
{text: 'Kafka guarantees topic-wide ordering only with a single broker', why: 'Kafka never guarantees topic-wide ordering, regardless of broker count.'},
{text: 'Log compaction reordered the records', why: 'Compaction removes superseded records by key; it does not reorder what remains.'},
]}
explanation={<>Key by entity ID — customer, order, account — and you get per-entity ordering with parallelism across entities, which is nearly always the actual requirement. Note that adding partitions later changes the key-to-partition mapping, so choose the count generously at creation.</>}
reference={{label: 'Core concepts', href: '/knowledge-base/kafka#core-concepts'}}
/>

<Quiz
question="A consumer group repeatedly rebalances and makes almost no progress. Processing each message takes several minutes. What is happening?"
options={[
{
text: 'Processing exceeds max.poll.interval.ms, so the broker declares the consumer dead and reassigns its partitions — repeatedly',
correct: true,
why: 'The consumer must return to poll within that interval to prove liveness. Long processing between polls looks identical to a crashed consumer.',
},
{text: 'The consumer group has more members than partitions', why: 'Surplus members sit idle; they do not trigger continuous rebalancing.'},
{text: 'Offsets are being committed before processing', why: 'That risks message loss rather than rebalancing.'},
{text: 'Under-replicated partitions are forcing leader elections', why: 'A real availability problem, and it would not correlate with slow message processing.'},
]}
explanation={<>Fetch fewer records per poll, move slow work off the poll loop, or raise <code>max.poll.interval.ms</code> deliberately. Enabling the new consumer group protocol (KIP-848, stable since 4.0) also makes rebalances incremental rather than stop-the-world.</>}
reference={{label: 'Consuming', href: '/knowledge-base/kafka#consuming'}}
/>

<Quiz
question="Which configurations protect data that must not be lost?"
type="multiple"
options={[
{text: 'acks=all on the producer', correct: true, why: 'The write is acknowledged only once all in-sync replicas have it, rather than just the leader.'},
{text: 'min.insync.replicas=2 with replication.factor=3', correct: true, why: 'Tolerates one broker failure while still requiring two acknowledgements — the standard production pairing with acks=all.'},
{text: 'enable.idempotence=true on the producer', correct: true, why: 'Prevents duplicates from producer retries, giving exactly-once semantics within Kafka.'},
{text: 'Committing consumer offsets only after processing succeeds', correct: true, why: 'A crash then causes redelivery rather than silent loss — which is why handlers must be idempotent.'},
{text: 'acks=1 for lower latency on important topics', why: 'The leader acknowledges before replication completes, so a leader failure at the wrong moment loses the record silently.'},
]}
explanation={<>Producer idempotence gives exactly-once <em>within Kafka</em> — which is not exactly-once end to end. The moment a consumer sends an email or calls a payment API, no broker can undo it, so idempotent handlers remain mandatory.</>}
reference={{label: 'Producing', href: '/knowledge-base/kafka#producing'}}
/>

<Quiz
question="A new service needs the current state of every customer record, and the customer topic uses `cleanup.policy=compact`. How does it bootstrap?"
options={[
{
text: 'Read the topic from offset zero — compaction retains the most recent record per key, so replaying it yields current state for every key',
correct: true,
why: 'A compacted topic is a durable key-value snapshot as well as a stream. Older records for a key are discarded, so a full read reconstructs current state.',
},
{text: 'Query the producing service\'s database directly for a snapshot', why: 'It works and reintroduces the coupling the event stream exists to remove.'},
{text: 'Request a replay from the Kafka brokers via an admin API', why: 'There is no such API — consumers simply set their own offset.'},
{text: 'Read only the last record in each partition', why: 'A partition holds many keys; the last record is one key\'s latest value, not every key\'s.'},
]}
explanation={<>This is what makes event sourcing and change-data-capture work on Kafka. Use compacted topics for state that should be retained indefinitely, and time-based retention for event streams where you only need to replay a bounded window.</>}
reference={{label: 'Retention and compaction', href: '/knowledge-base/kafka#retention-and-compaction'}}
/>

---

## References

- [Kafka documentation](https://kafka.apache.org/documentation/) — configuration,
  operations and APIs.
- [Kafka design](https://kafka.apache.org/documentation/#design) — why the log
  model works the way it does.
- [Kafka 4.0 release announcement](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
  — KRaft-only, and the new consumer group protocol.
- [Kafka 4.1 release announcement](https://kafka.apache.org/blog/2025/09/04/apache-kafka-4.1.0-release-announcement/)
  — Queues for Kafka (KIP-932) in preview.
- [Confluent: Schema Registry](https://docs.confluent.io/platform/current/schema-registry/index.html)
  — compatibility modes and evolution rules.
- [Queues](/knowledge-base/operations/queues) — the simpler alternative, and when
  it is the right one.
