---
title: 'Observability'
description: 'Answering questions you did not anticipate — the three signals, cardinality, distributed tracing, and working an incident with all of them.'
---

# Observability

## Introduction

**Monitoring tells you that something is wrong. Observability lets you work out
why — including for failures nobody predicted.**

The distinction is about _unknown unknowns_. A dashboard answers questions you
thought to ask when you built it. Observability is the property of being able to
ask a new question of your production system and get an answer, without shipping
code first.

**The question that tests it:** "Checkout is failing for some users. Which
users?" If you can slice by customer tier, region, browser, feature flag and API
version without deploying anything, your system is observable. If you have to
add a log line and wait for a deploy, it is monitored but not observable.

**Three signals, and they answer different questions:**

| Signal      | Answers                               | Cost                             |
| ----------- | ------------------------------------- | -------------------------------- |
| **Metrics** | How many, how fast, over time         | Cheap; aggregatable; low detail  |
| **Logs**    | What happened in this specific case   | Expensive at volume; full detail |
| **Traces**  | Where did the time go across services | Moderate; shows causality        |

**Do not skip monitoring to build this.** Knowing something is broken beats
being able to explore why, when you have neither. See
[Monitoring](/knowledge-base/operations/monitoring) first.

---

## The Three Signals Together

The signals are most useful when they are linked, and least useful in isolation.

A worked example — the API is slow:

1. **Metric.** p99 latency on `/api/orders` went from 200 ms to 4 s at 14:32.
   _You now know what and when._
2. **Trace.** Open a slow trace. 3.8 s of the 4 s is inside a single database
   span. _You now know where._
3. **Log.** Jump from that span to the logs carrying the same `traceId`. The
   query is doing a sequential scan because a migration dropped an index. _You
   now know why._

**The linkage is what makes this work**, and it is not automatic. Metrics need
exemplars pointing at sample traces; traces and logs need the same `traceId`.
Wire that up deliberately — it is the difference between three tools and one
investigation.

**Instrument once with OpenTelemetry** and emit all three, so the correlation is
built in rather than retrofitted. See
[OpenTelemetry](/knowledge-base/operations/opentelemetry).

---

## Cardinality

The concept that decides what your observability stack can do and what it costs.

**Cardinality is the number of distinct values a field can take.** `http_method`
has about nine. `user_id` has as many as you have users.

**In metrics, cardinality is multiplicative and dangerous.** Each unique label
combination is a separate time series stored forever. A metric with
`endpoint` × `status` × `region` might be 500 series — fine. Add `user_id` and
it is 500 × your user count, which is how Prometheus servers run out of memory.

**In traces and logs, high cardinality is the entire point.** Being able to
filter to one customer, one request, one feature flag is what makes the question
"which users?" answerable.

**The practical rule:**

- **Metrics** — bounded labels only. Method, status class, endpoint _pattern_
  (`/users/:id`, never `/users/12345`), region, service.
- **Traces and logs** — attach everything: user ID, tenant, request ID, feature
  flags, version.

**Wide events are the modern approach.** Rather than many narrow log lines, emit
one richly attributed event per unit of work, with fifty or more fields. You
then slice by any of them after the fact. This is the model behind Honeycomb and
increasingly behind OpenTelemetry span attributes.

---

## Distributed Tracing

A trace follows one request across every service it touches.

```
Trace: checkout request                                   [============] 1.2s
├── POST /api/checkout            (api-gateway)           [============] 1.2s
│   ├── validate_cart             (order-service)         [==]           120ms
│   ├── SELECT items              (postgres)              [=]             40ms
│   ├── charge_card               (payment-service)       [========]     800ms
│   │   └── POST stripe.com/v1    (external)              [=======]      780ms
│   └── publish order.created     (kafka)                 [=]             30ms
```

**Concepts:**

- **Trace** — the whole request, identified by a `traceId`.
- **Span** — one unit of work, with a start, duration, attributes and a parent.
- **Context propagation** — passing the trace ID across process boundaries via
  the `traceparent` header (W3C Trace Context).
- **Span attributes** — key/value detail attached to a span. Put your
  high-cardinality data here.

**What tracing is uniquely good at:**

- **Finding where the time actually goes.** The example above shows 780 ms in an
  external API call, which no per-service metric would have attributed
  correctly.
- **N+1 queries.** They are unmistakable — 200 identical sibling spans.
- **Understanding dependencies** you did not know existed.
- **Tail latency.** Compare a fast trace with a slow one for the same endpoint.

**Sampling is necessary at volume.** Tracing every request is expensive.

| Approach          | How                               | Trade-off                                                           |
| ----------------- | --------------------------------- | ------------------------------------------------------------------- |
| **Head sampling** | Decide at the start, e.g. keep 1% | Simple; may discard the interesting ones                            |
| **Tail sampling** | Decide after the trace completes  | Keeps all errors and slow traces; needs a collector buffering spans |

**Tail sampling is worth the extra component.** Keeping 100% of errors and slow
traces plus 1% of successes gives you almost everything you want at a fraction
of the cost — and head sampling's habit of discarding the one trace you needed
is genuinely maddening.

---

## Instrumenting a Service

**Start with auto-instrumentation.** OpenTelemetry SDKs instrument HTTP servers
and clients, database drivers, and queue libraries automatically. That covers
most of the value for very little work.

```js
// instrumentation.js — loaded before the app
import {NodeSDK} from '@opentelemetry/sdk-node';
import {getNodeAutoInstrumentations} from '@opentelemetry/auto-instrumentations-node';

new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
}).start();
```

**Then add manual spans for business operations** — the things your service does
that a library cannot name:

```js
import {trace} from '@opentelemetry/api';

const tracer = trace.getTracer('checkout');

async function processOrder(order) {
  return tracer.startActiveSpan('process_order', async (span) => {
    span.setAttributes({
      'order.id': order.id,
      'order.item_count': order.items.length,
      'customer.tier': order.customer.tier,
    });
    try {
      return await doWork(order);
    } catch (err) {
      span.recordException(err);
      span.setStatus({code: 2}); // ERROR
      throw err;
    } finally {
      span.end();
    }
  });
}
```

**Attribute generously.** Every attribute is a dimension you can slice by later,
and adding one costs almost nothing. The attributes you wish you had are always
the ones you did not think to add.

**Instrument the boundaries first**: inbound requests, outbound calls, database
queries, queue operations. That is where time is spent and where failures cross
services.

---

## Working an Incident

A repeatable sequence, rather than clicking around under pressure:

1. **Confirm impact.** Which SLI is breached, and by how much? Are users
   affected or is this a monitoring artefact?
2. **Establish when.** Find the change point. Then check what happened at that
   moment — deploys, config changes, traffic shifts, a dependency's status page.
3. **Narrow the scope.** All users or some? One region, one tenant, one client
   version? **This is where high cardinality earns its cost.**
4. **Follow a trace.** Take one failing request and look at where it went wrong.
5. **Read the logs for that trace.** Detail on the specific failure.
6. **Mitigate first, understand later.** Roll back, disable the flag, scale up.
   Diagnosis can wait; users cannot.
7. **Write it up.** Blamelessly, with the timeline and what would have shortened
   detection.

**"What changed?" resolves most incidents.** Deploy annotations on dashboards
answer it in seconds, which is why they are worth setting up before you need
them.

---

## Cost

Observability data is often the second-largest infrastructure line item after
compute.

- **Metrics** are cheap per data point and expensive per _series_. Cardinality
  is the whole cost model.
- **Logs** are expensive per gigabyte. Sample the boring ones, keep every error.
- **Traces** are moderate, and tail sampling reduces them dramatically.

**Where the money goes wrong:** unbounded metric labels, debug logging left on
in production, no retention limits, and every signal kept at 100% fidelity when
95% of it is never read.

**A reasonable default posture:** 100% of errors and slow traces, 1–5% of
successful ones, metrics with strictly bounded labels, 14 days of hot log
retention.

---

## Do's and Don'ts

### Do

- Set up monitoring before observability.
- Instrument with OpenTelemetry so you are not locked in.
- Propagate trace context across every service boundary.
- Put the trace ID in every log line.
- Attach high-cardinality attributes to spans and logs.
- Keep metric labels strictly bounded.
- Use tail sampling to keep errors and slow traces.
- Add business attributes — tier, plan, feature flags — not just technical ones.
- Annotate deploys on dashboards.
- Start with auto-instrumentation, then add business spans.

### Don't

- Don't put user IDs or full URLs in metric labels.
- Don't collect signals you never query.
- Don't rely on head sampling alone at low rates.
- Don't leave debug logging on in production.
- Don't instrument with a vendor SDK when OTel works.
- Don't build dashboards without knowing which question they answer.
- Don't skip context propagation and expect traces to join up.
- Don't treat observability as a replacement for good error handling.

---

## Common Mistakes

**Collecting all three signals with nothing linking them.** Three separate tools
and no path between them. Wire trace IDs into logs and exemplars into metrics.

**High cardinality in metrics.** The classic way to kill Prometheus. Endpoint
_patterns_, never concrete paths.

**Head sampling at 1%.** The incident you are investigating is almost certainly
not in the sample.

**Missing context propagation.** Traces stop at the first service boundary and
the picture is useless.

**Instrumenting everything except the interesting part.** Auto-instrumentation
shows HTTP and SQL; nobody has instrumented the business logic where the time
actually goes.

**Vendor-specific instrumentation.** Changing provider becomes a rewrite. OTel
is the reason this is now avoidable.

**Treating observability as a purchase.** The tool is a small part; the
instrumentation and the attributes are the work.

**No mitigation plan.** Perfect visibility into an outage you cannot stop.

---

## Debugging

| Symptom                            | Cause                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| Traces stop at a service boundary  | Context not propagated; missing `traceparent`            |
| Trace has gaps                     | A component not instrumented, or spans not exported      |
| Cannot find a specific request     | Sampling discarded it; use tail sampling                 |
| Metrics backend out of memory      | Cardinality explosion; find the offending label          |
| Logs and traces will not correlate | Trace ID not injected into the logger                    |
| Spans have no useful detail        | Attributes never added                                   |
| Traces missing entirely            | Exporter misconfigured or the collector is down          |
| Async work orphaned                | Context lost across a queue; propagate it in the message |

**Context loss across asynchronous boundaries is the recurring one.** A job
published to a queue and processed later needs the trace context carried in the
message, or the worker's spans start a new trace with no parent.

---

## FAQ

**Do I need all three signals?**
Start with metrics and logs. Add traces when you have more than one service, or
when "where is the time going?" becomes hard to answer.

**Which vendor?**
Instrument with OpenTelemetry and the question becomes reversible. Grafana
(Loki/Tempo/Mimir) is the strong open-source stack; Honeycomb is exceptional for
wide-event exploration; Datadog and New Relic cover everything at a price.

**Is this worth it for a single service?**
Metrics and structured logs, yes, immediately. Distributed tracing has less to
offer with one process, though it still shows where time goes internally.

**How much sampling is right?**
Keep 100% of errors and slow traces. 1–10% of successful ones is typical, tuned
to volume and budget.

**What is a wide event?**
One richly attributed record per unit of work, with dozens of fields, instead of
many narrow log lines. It makes arbitrary slicing possible after the fact.

**Does this replace debugging locally?**
No. It tells you what is happening in production, which is where the bugs you
cannot reproduce live.

---

## Check your understanding

<Quiz
question="What distinguishes observability from monitoring?"
options={[
{
text: 'Monitoring answers questions you anticipated; observability lets you ask new questions of production without shipping code first',
correct: true,
why: 'Dashboards and alerts cover known failure modes. Observability is about unknown unknowns — slicing by a dimension nobody thought to graph.',
},
{text: 'Observability means collecting more metrics than monitoring does', why: 'Volume is not the distinction — a great many metrics can still answer only the questions they were designed for.'},
{text: 'Monitoring is for infrastructure and observability is for applications', why: 'Both apply at every layer.'},
{text: 'Observability replaces monitoring once implemented', why: 'You need both, and monitoring comes first — knowing something is broken beats exploring why when you have neither.'},
]}
explanation={<>The test: "checkout is failing for some users — which users?" If you can slice by tier, region, browser and feature flag without deploying, the system is observable. If you must add a log line and wait for a deploy, it is monitored.</>}
reference={{label: 'Introduction', href: '/knowledge-base/operations/observability#introduction'}}
/>

<Quiz
question="Why is adding `user_id` as a metric label dangerous, when adding it as a span attribute is recommended?"
options={[
{
text: 'Each unique label combination creates a separate time series stored indefinitely, so cardinality multiplies — whereas span attributes are per-request data with no such multiplication',
correct: true,
why: 'Metrics are pre-aggregated across dimensions; every distinct combination is its own series. Traces and logs are already per-event, so extra attributes cost only storage for that event.',
},
{text: 'Metric labels cannot hold string values', why: 'They hold strings fine; the problem is how many distinct ones there are.'},
{text: 'User IDs are personal data and cannot be stored in metrics', why: 'A separate and real privacy consideration, and not the technical reason this breaks.'},
{text: 'Span attributes are sampled, so they cost less', why: 'Sampling helps, and the fundamental difference is series multiplication versus per-event storage.'},
]}
explanation={<>Keep metric labels strictly bounded — method, status class, endpoint <em>pattern</em> such as <code>/users/:id</code> rather than <code>/users/12345</code> — and attach everything else to spans and logs, where high cardinality is exactly what makes "which users?" answerable.</>}
reference={{label: 'Cardinality', href: '/knowledge-base/operations/observability#cardinality'}}
/>

<Quiz
question="A team samples 1% of traces at the start of each request. During an incident they cannot find any trace of the failing requests. What would have helped?"
options={[
{
text: 'Tail sampling — deciding after the trace completes, so 100% of errors and slow traces are kept alongside a small fraction of successes',
correct: true,
why: 'Head sampling decides before the outcome is known, so a 1% rate discards 99% of errors along with everything else.',
},
{text: 'Raising head sampling to 10%', why: 'Ten times the cost and still discards 90% of the traces you actually need.'},
{text: 'Longer trace retention', why: 'Retention cannot recover traces that were never recorded.'},
{text: 'More span attributes', why: 'Valuable for slicing traces you have, and useless for traces that were discarded.'},
]}
explanation={<>Tail sampling needs a collector that buffers spans until the trace completes — an extra component, and worth it. Keeping every error and slow trace plus 1–5% of successes gives you nearly everything at a fraction of the cost.</>}
reference={{label: 'Distributed tracing', href: '/knowledge-base/operations/observability#distributed-tracing'}}
/>

<Quiz
question="Traces show the full request path within a service but stop at every service boundary. What is missing?"
options={[
{
text: 'Context propagation — the traceparent header is not being sent on outbound calls or read on inbound ones',
correct: true,
why: 'Each service starts a fresh root span because it never receives the parent context, so the trace fragments into disconnected pieces.',
},
{text: 'The services use different OpenTelemetry SDK versions', why: 'Versions interoperate; W3C Trace Context is the wire format.'},
{text: 'Sampling decisions differ between services', why: 'Inconsistent sampling produces partial traces, not a clean break at every boundary.'},
{text: 'The collector cannot merge spans from multiple services', why: 'Merging by trace ID is its normal function — there is no shared trace ID here.'},
]}
explanation={<>The same failure appears across asynchronous boundaries: a job published to a queue needs the trace context carried <em>in the message</em>, or the worker's spans start an unparented trace. This is the most common gap in otherwise well-instrumented systems.</>}
reference={{label: 'Debugging', href: '/knowledge-base/operations/observability#debugging'}}
/>

<Quiz
question="Which practices make the three signals work together rather than as three separate tools?"
type="multiple"
options={[
{text: 'Injecting the trace ID into every log line', correct: true, why: 'It is what lets you jump from a slow span straight to the logs for that exact request.'},
{text: 'Attaching exemplars to metrics that point at sample traces', correct: true, why: 'It turns "p99 got worse" into "here is a trace of a slow request", which is the next question every time.'},
{text: 'Instrumenting once with OpenTelemetry rather than per-vendor SDKs', correct: true, why: 'Correlation is built in, and changing provider stops being a rewrite.'},
{text: 'Annotating deploys on dashboards', correct: true, why: '"What changed?" resolves most incidents, and deploy markers answer it in seconds.'},
{text: 'Collecting all three signals at full fidelity and correlating them later', why: 'Cost without benefit — most of it is never queried. Sample deliberately and spend the budget on errors and slow requests.'},
]}
explanation={<>The linkage is not automatic; it has to be wired deliberately. It is the difference between three dashboards you switch between and one continuous investigation from metric to trace to log.</>}
reference={{label: 'The three signals together', href: '/knowledge-base/operations/observability#the-three-signals-together'}}
/>

---

## References

- [OpenTelemetry: Observability Primer](https://opentelemetry.io/docs/concepts/observability-primer/)
  — the concepts, vendor-neutrally.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) — the propagation
  standard every SDK implements.
- [Google SRE Workbook: Monitoring](https://sre.google/workbook/monitoring/) —
  signals, and what to do with them.
- [Honeycomb: Observability Engineering](https://www.honeycomb.io/blog) — wide
  events and high-cardinality analysis.
- [OpenTelemetry sampling](https://opentelemetry.io/docs/concepts/sampling/) —
  head versus tail, with configuration.
- [Monitoring](/knowledge-base/operations/monitoring) — the prerequisite.
