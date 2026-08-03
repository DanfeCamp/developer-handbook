---
title: 'OpenTelemetry'
description: 'Vendor-neutral instrumentation for traces, metrics and logs — API, SDK, Collector, semantic conventions, propagation and sampling.'
---

# OpenTelemetry

## Introduction

OpenTelemetry (OTel) is a standard set of APIs, SDKs and a collector for
producing telemetry without binding your code to a vendor.

**The problem it solves is lock-in.** Before OTel, instrumenting for Datadog
meant Datadog's SDK throughout your codebase. Moving to New Relic meant
reinstrumenting everything, which meant nobody moved. Instrumentation was a
one-way door.

**With OTel you instrument once** and change backends by reconfiguring the
Collector. The instrumentation in your code does not change.

**Why it won:** it is a CNCF project — the second most active after Kubernetes —
and every major observability vendor now ingests OTLP natively, because their
customers required it. It merged OpenTracing and OpenCensus, ending a
standards split that helped nobody.

**Maturity by signal:** tracing and metrics are stable across the major
languages; **logs are stable in the specification and less complete in practice**
— the usual approach is to keep your existing logger and inject the trace ID
into it, rather than routing logs through OTel.

This page is the implementation of the concepts on the
[Observability page](/knowledge-base/operations/observability).

---

## The Three Components

| Component     | What it is                                                | Who uses it                  |
| ------------- | --------------------------------------------------------- | ---------------------------- |
| **API**       | Interfaces for creating spans and metrics                 | Application and library code |
| **SDK**       | The implementation: sampling, batching, export            | Configured once, at startup  |
| **Collector** | A standalone process that receives, processes and exports | Infrastructure               |

**The API/SDK split is deliberate and useful.** A library can depend on the API
alone and emit spans. If no SDK is configured, those calls are no-ops costing
nothing. This is why libraries can ship instrumentation without imposing a
telemetry stack on their users.

**The Collector is optional but nearly always worth running.** It lets you:

- Change backends without touching applications.
- Do tail sampling, which needs a component that sees whole traces.
- Redact sensitive attributes centrally.
- Batch and retry, so a backend outage does not affect your service.
- Add resource attributes — environment, region, cluster — in one place.

Run it as a sidecar or as a per-node agent, and often a gateway tier behind it.

---

## Getting Started

Auto-instrumentation gives you most of the value immediately.

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

```js
// instrumentation.js
import {NodeSDK} from '@opentelemetry/sdk-node';
import {getNodeAutoInstrumentations} from '@opentelemetry/auto-instrumentations-node';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
process.on('SIGTERM', () => sdk.shutdown());
```

```bash
node --import ./instrumentation.js server.js
```

**Load instrumentation before the application.** Auto-instrumentation works by
patching modules as they load, so anything imported first is not instrumented.
This is the single most common setup mistake, and it presents as "some spans are
missing" rather than as an error.

**Configuration by environment variable** is standard across every language, so
the same variables work everywhere:

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.version=1.4.2
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

**Zero-code instrumentation** goes further in some languages: Java has an agent
JAR, Python has `opentelemetry-instrument`, .NET has an automatic installer. No
code changes at all.

---

## Manual Instrumentation

Auto-instrumentation covers HTTP, databases and queues. It cannot know what your
business logic does.

```js
import {trace, SpanStatusCode} from '@opentelemetry/api';

const tracer = trace.getTracer('checkout-service', '1.4.2');

async function applyDiscount(order, code) {
  return tracer.startActiveSpan('apply_discount', async (span) => {
    span.setAttributes({
      'discount.code': code,
      'order.total_pence': order.totalPence,
      'customer.tier': order.customer.tier,
    });

    try {
      const result = await lookupAndApply(order, code);
      span.setAttribute('discount.applied_pence', result.discountPence);
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({code: SpanStatusCode.ERROR, message: err.message});
      throw err;
    } finally {
      span.end();
    }
  });
}
```

**`startActiveSpan` sets the span as current**, so anything called inside it —
including auto-instrumented database calls — becomes a child automatically. Use
it rather than `startSpan` unless you specifically want a detached span.

**Always `end()` in a `finally`.** An unended span is never exported, and the
trace has a hole where the work should be.

**`recordException` alone does not mark the span failed.** Set the status too, or
your error-rate queries over traces will miss it.

**Custom metrics** work the same way:

```js
import {metrics} from '@opentelemetry/api';

const meter = metrics.getMeter('checkout-service');
const ordersCompleted = meter.createCounter('orders.completed', {
  description: 'Orders that reached payment confirmation',
});

ordersCompleted.add(1, {'payment.method': method, 'customer.tier': tier});
```

**Keep metric attributes bounded** — the cardinality rules apply exactly as they
do in [Prometheus](/knowledge-base/operations/prometheus).

---

## Semantic Conventions

Standardised names for common attributes, so dashboards and tooling work across
services and languages without per-service configuration.

```
http.request.method       GET
http.response.status_code 200
url.path                  /api/orders
server.address            api.example.com
db.system.name            postgresql
db.query.text             SELECT * FROM orders WHERE id = $1
messaging.system          kafka
service.name              checkout-api
deployment.environment    production
```

**Use them.** A vendor dashboard that expects `http.response.status_code` will
not find `status`, and you will end up rebuilding dashboards you could have had
for free.

**Note the churn.** HTTP conventions were stabilised with renames from the older
forms (`http.method` → `http.request.method`, `http.status_code` →
`http.response.status_code`), and database conventions stabilised more recently
with `db.system` → `db.system.name`. If you find old examples online, check the
attribute names against the current specification — this is the most common
source of confusion in OTel material.

**Add your own namespaced attributes** for business data: `order.id`,
`customer.tier`, `feature.flag.new_checkout`. Prefix with your domain and keep
names stable.

---

## Context Propagation

How a trace crosses process boundaries.

**W3C Trace Context is the default**, carried in headers:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                │
             │  trace-id                         span-id          flags
             version
```

Auto-instrumentation injects and extracts these for HTTP automatically. **Two
places where it commonly does not work:**

**1. Queues and asynchronous work.** A job published now and processed in ten
minutes needs the context carried in the message body or headers:

```js
import {propagation, context} from '@opentelemetry/api';

// Producer
const carrier = {};
propagation.inject(context.active(), carrier);
await queue.add('process-order', {orderId, _otel: carrier});

// Consumer
const parent = propagation.extract(context.active(), job.data._otel);
context.with(parent, () => processOrder(job.data));
```

**2. Custom transports.** Anything not using a standard HTTP client needs manual
inject/extract.

**Baggage** propagates arbitrary key/value data alongside the trace context — a
tenant ID, say, available to every downstream service. **It is sent on every
request and is not encrypted**, so keep it small and never put anything sensitive
in it.

---

## The Collector

```yaml
receivers:
  otlp:
    protocols:
      grpc: {endpoint: 0.0.0.0:4317}
      http: {endpoint: 0.0.0.0:4318}

processors:
  batch:
    timeout: 5s
  memory_limiter:
    check_interval: 1s
    limit_percentage: 80
  attributes:
    actions:
      - key: http.request.header.authorization
        action: delete
  tail_sampling:
    policies:
      - name: errors
        type: status_code
        status_code: {status_codes: [ERROR]}
      - name: slow
        type: latency
        latency: {threshold_ms: 1000}
      - name: sample-rest
        type: probabilistic
        probabilistic: {sampling_percentage: 5}

exporters:
  otlphttp:
    endpoint: https://otlp.vendor.example/v1/traces
  prometheus:
    endpoint: 0.0.0.0:8889

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling, attributes, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
```

**The pipeline model:** receivers take data in, processors transform it,
exporters send it out. Signals have separate pipelines.

**Processor order matters, and `batch` goes last.** Batching before sampling
means the sampler is deciding on batches rather than traces. Put
`memory_limiter` first, so it can shed load before anything else allocates.

**Tail sampling requires all spans of a trace to reach the same collector
instance.** With multiple collectors you need a load-balancing exporter in front
that routes by trace ID — otherwise sampling decisions are made on fragments,
and traces come out incomplete.

**Two distributions:** `otelcol` (core) and `otelcol-contrib` (everything). Most
real deployments need contrib.

---

## Sampling

| Sampler                    | Behaviour                                     |
| -------------------------- | --------------------------------------------- |
| `always_on`                | Sample everything — fine for development      |
| `traceidratio`             | A fixed proportion                            |
| `parentbased_traceidratio` | Respect the parent's decision, else the ratio |
| Tail sampling (Collector)  | Decide after seeing the whole trace           |

**`parentbased_*` is the correct default for services.** Without it, downstream
services make independent decisions and you get partial traces — the parent
sampled, the child not, and a gap where the interesting work was.

**Head sampling is cheap; tail sampling is useful.** The combination most teams
land on: `parentbased_traceidratio` at a high rate in the SDK, tail sampling in
the Collector keeping 100% of errors and slow traces plus a few percent of the
rest.

---

## Do's and Don'ts

### Do

- Load instrumentation before the application starts.
- Start with auto-instrumentation, then add business spans.
- Follow semantic conventions for standard attributes.
- Namespace your own attributes and keep names stable.
- Use `startActiveSpan` so children attach automatically.
- End spans in a `finally`, and set error status as well as recording the
  exception.
- Propagate context explicitly through queues.
- Run a Collector rather than exporting straight to a vendor.
- Use `parentbased` samplers.
- Redact sensitive attributes in the Collector.

### Don't

- Don't import application modules before the SDK.
- Don't create a span per trivial function — spans are not free.
- Don't put unbounded values in metric attributes.
- Don't put sensitive data in baggage.
- Don't tail-sample without routing whole traces to one collector.
- Don't put `batch` before the sampler.
- Don't mix old and new semantic convention names.
- Don't route logs through OTel just because you can — injecting the trace ID
  into your existing logger is usually better.

---

## Common Mistakes

**Instrumentation loaded too late.** Modules imported before the SDK are never
patched, so some spans simply never appear.

**Unended spans.** Never exported; the trace has a hole.

**`recordException` without a status.** The span looks successful in every
error-rate query.

**Context lost across a queue.** Worker spans start a new, unparented trace.

**Non-parent-based sampling.** Partial traces with missing middles.

**Old semantic convention names.** Vendor dashboards silently show nothing.

**Cardinality in metric attributes.** Same failure as Prometheus labels.

**Tail sampling across load-balanced collectors** without trace-ID routing.
Incomplete traces, inconsistently.

**Exporting directly to a vendor from every service.** Every configuration
change becomes a fleet-wide deploy.

---

## Debugging

```yaml
# Collector: see what is actually arriving
exporters:
  debug:
    verbosity: detailed
```

```bash
# SDK: verbose diagnostics
OTEL_LOG_LEVEL=debug
```

| Symptom                      | Cause                                                    |
| ---------------------------- | -------------------------------------------------------- |
| No telemetry at all          | Endpoint wrong; exporter not configured; SDK not started |
| Some spans missing           | Instrumentation loaded after the modules it patches      |
| Traces truncated             | Context not propagated, or non-parent-based sampling     |
| Spans never appear           | `end()` not called                                       |
| High memory in the Collector | No `memory_limiter`; batch too large                     |
| Vendor shows no data         | Wrong OTLP path (`/v1/traces`), auth header, or protocol |
| Attributes missing           | Set after `end()`, or dropped by a processor             |
| Duplicate spans              | Both an agent and manual instrumentation active          |

**Add the `debug` exporter first.** Knowing whether data reaches the Collector
splits the problem cleanly in two, and most OTel debugging stalls because nobody
established that.

---

## FAQ

**Do I need the Collector?**
Not to start — exporting straight to a backend works. Add it before you need
tail sampling, central redaction, or the ability to change backends without
deploying.

**Does it slow my application down?**
A few percent with reasonable sampling. Batching and asynchronous export keep it
off the request path. Instrumenting extremely hot code paths individually is
where cost appears.

**Can I use it with Prometheus?**
Yes — the Collector exports Prometheus format, or scrapes Prometheus endpoints
and forwards them. See [Prometheus](/knowledge-base/operations/prometheus).

**What about logs?**
The specification is stable; practice is still settling. The pragmatic approach
is to keep your existing logger and inject `trace_id` and `span_id` into every
line.

**Which backend?**
Anything speaking OTLP: Grafana Tempo, Jaeger, Honeycomb, Datadog, New Relic,
Grafana Cloud. That interchangeability is the point.

**Is it stable?**
Traces and metrics are stable in the major languages. Check your specific
language's status page — maturity varies.

---

## Check your understanding

<Quiz
question="A Node service is set up with OpenTelemetry auto-instrumentation, but HTTP and database spans are missing while manual spans appear. What is the likely cause?"
options={[
{
text: 'The SDK was started after application modules were imported, so auto-instrumentation could not patch them',
correct: true,
why: 'Auto-instrumentation patches modules as they load. Anything imported before the SDK starts is never wrapped, and this fails silently.',
},
{text: 'The exporter endpoint is wrong', why: 'Then manual spans would be missing too — the fact that some spans arrive proves export works.'},
{text: 'Auto-instrumentation does not cover HTTP and databases', why: 'They are the primary things it covers.'},
{text: 'The sampler is discarding library spans specifically', why: 'Samplers operate per trace, not per instrumentation source.'},
]}
explanation={<>Load instrumentation first — <code>node --import ./instrumentation.js server.js</code>, or a language agent. This is the most common OTel setup mistake, and because it produces missing data rather than an error, it is easy to miss.</>}
reference={{label: 'Getting started', href: '/knowledge-base/operations/opentelemetry#getting-started'}}
/>

<Quiz
question="Jobs published to a queue produce worker spans that appear as separate root traces, disconnected from the request that enqueued them. How do you fix it?"
options={[
{
text: 'Inject the trace context into the job payload when publishing, and extract it in the worker before processing',
correct: true,
why: 'Auto-instrumentation propagates context over HTTP headers. A queue message crossing a time gap carries nothing unless you put it there.',
},
{text: 'Increase the span export timeout', why: 'Timeouts affect delivery, not parentage.'},
{text: 'Use always_on sampling in the worker', why: 'The worker would sample more traces, all of them still unparented.'},
{text: 'Run the worker and producer in the same process', why: 'Defeats the purpose of a queue to work around an instrumentation gap.'},
]}
explanation={<>Use <code>propagation.inject</code> into a carrier object stored on the message, and <code>propagation.extract</code> plus <code>context.with</code> in the consumer. Asynchronous boundaries are where context propagation almost always breaks first.</>}
reference={{label: 'Context propagation', href: '/knowledge-base/operations/opentelemetry#context-propagation'}}
/>

<Quiz
question="A service catches an error and calls `span.recordException(err)` before rethrowing. Error-rate queries over traces still show the span as successful. Why?"
options={[
{
text: 'recordException attaches an event to the span but does not change its status — you must also set the status to ERROR',
correct: true,
why: 'They are separate operations by design: recording an exception is informational, while status is what queries and dashboards filter on.',
},
{text: 'The exception was recorded after the span ended', why: 'A real failure mode, and the described order is correct here.'},
{text: 'Rethrowing clears recorded exceptions', why: 'Rethrowing has no effect on the span.'},
{text: 'Exceptions are only recorded when the span is the root', why: 'Any span can record an exception.'},
]}
explanation={<>Call <code>span.setStatus({'{code: SpanStatusCode.ERROR}'})</code> alongside <code>recordException</code>, and end the span in a <code>finally</code> — an unended span is never exported at all.</>}
reference={{label: 'Manual instrumentation', href: '/knowledge-base/operations/opentelemetry#manual-instrumentation'}}
/>

<Quiz
question="Which are correct when configuring the OpenTelemetry Collector?"
type="multiple"
options={[
{text: 'Place memory_limiter first in the processor chain', correct: true, why: 'It can shed load before other processors allocate memory, which is the only order in which it protects anything.'},
{text: 'Place batch last, after any sampling processor', correct: true, why: 'Batching before sampling means the sampler operates on batches rather than complete traces.'},
{text: 'Route all spans of a trace to the same collector instance when tail sampling', correct: true, why: 'Sampling decisions need the whole trace. Without trace-ID-aware load balancing you get decisions made on fragments.'},
{text: 'Delete sensitive attributes such as authorization headers in the collector', correct: true, why: 'Central redaction applies to every service at once, rather than depending on each one getting it right.'},
{text: 'Use the core otelcol distribution for production deployments', why: 'Most real deployments need components that only ship in otelcol-contrib.'},
]}
explanation={<>The Collector is where configuration that would otherwise be a fleet-wide deploy becomes a config change — sampling, redaction, and which backend receives the data.</>}
reference={{label: 'The Collector', href: '/knowledge-base/operations/opentelemetry#the-collector'}}
/>

<Quiz
question="Why is `parentbased_traceidratio` usually the correct SDK sampler for a service, rather than plain `traceidratio`?"
options={[
{
text: 'It respects the upstream service\'s sampling decision, so a trace is either fully sampled or fully dropped rather than fragmented',
correct: true,
why: 'With independent per-service decisions, a parent can be sampled while its child is not, leaving gaps exactly where the interesting work happened.',
},
{text: 'It samples a higher proportion of traces', why: 'The ratio is the same; what differs is who decides.'},
{text: 'It is required for the Collector to accept spans', why: 'The Collector accepts spans under any sampler.'},
{text: 'It automatically keeps all error traces', why: 'That is tail sampling in the Collector, decided after the outcome is known.'},
]}
explanation={<>The common arrangement: <code>parentbased_traceidratio</code> at a generous rate in the SDK, with tail sampling in the Collector keeping 100% of errors and slow traces plus a few percent of successes.</>}
reference={{label: 'Sampling', href: '/knowledge-base/operations/opentelemetry#sampling'}}
/>

---

## References

- [OpenTelemetry documentation](https://opentelemetry.io/docs/) — concepts,
  language SDKs and status.
- [Semantic conventions](https://opentelemetry.io/docs/specs/semconv/) — the
  attribute names to use, with stability markers.
- [Collector configuration](https://opentelemetry.io/docs/collector/configuration/)
  — receivers, processors, exporters and pipelines.
- [Sampling](https://opentelemetry.io/docs/concepts/sampling/) — head, tail and
  parent-based behaviour.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) — the `traceparent`
  format.
- [Observability](/knowledge-base/operations/observability) — the concepts this
  page implements.
