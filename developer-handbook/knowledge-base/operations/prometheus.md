---
title: 'Prometheus'
description: 'Pull-based metrics collection and alerting — the data model, PromQL, cardinality, recording rules and Alertmanager.'
---

# Prometheus

## Introduction

Prometheus scrapes metrics from HTTP endpoints your services expose, stores them
as time series, and evaluates rules against them with its own query language,
PromQL. It is the de facto standard for metrics in the cloud-native world, and
the second CNCF project to graduate after Kubernetes.

**Two design decisions shape everything about using it:**

**1. It pulls, rather than receiving pushes.** Prometheus fetches `/metrics` from
your services on a schedule. This means service discovery tells Prometheus what
exists, the scrape itself is a health check, and there is no client-side buffer
to lose. The awkward case is short-lived jobs that finish before anyone scrapes
them — hence the Pushgateway, which exists for exactly that and should not be
used for anything else.

**2. Every metric is a name plus labels.** `http_requests_total{method="GET",
status="200"}` is one time series; changing any label value creates another. This
dimensional model is what makes PromQL powerful, and **it is also how people
destroy their Prometheus server**, because the number of series is the entire
cost model.

**What it is not:** a long-term store (use Thanos, Mimir or Cortex), a logging
system, or an event store. It samples numeric values over time. Anything needing
per-event detail belongs in [logs](/knowledge-base/operations/logging) or
[traces](/knowledge-base/operations/observability).

---

## Exposing Metrics

A service exposes plain text on `/metrics`:

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/orders",status="200"} 48219
http_requests_total{method="GET",route="/api/orders",status="500"} 37

# HELP http_request_duration_seconds Request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="/api/orders",le="0.1"} 45102
http_request_duration_seconds_bucket{route="/api/orders",le="0.5"} 48001
http_request_duration_seconds_bucket{route="/api/orders",le="+Inf"} 48256
http_request_duration_seconds_sum{route="/api/orders"} 4102.3
http_request_duration_seconds_count{route="/api/orders"} 48256
```

```js
import client from 'prom-client';
import express from 'express';

client.collectDefaultMetrics();

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // route pattern, never the concrete path
    end({method: req.method, route: req.route?.path ?? 'unknown', status: res.statusCode});
  });
  next();
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

**Naming conventions matter**, because tooling and dashboards rely on them:

- `snake_case`, prefixed with the subsystem: `http_`, `db_`, `queue_`.
- **Base units**: seconds, not milliseconds; bytes, not megabytes.
- **Counters end in `_total`**.
- The name describes what is measured; labels describe the dimensions.

**Choose histogram buckets to span your actual latency range.** The defaults
rarely fit. If every observation lands in the top bucket, your p99 is a
fabrication — the quantile is interpolated within a bucket, so a bucket covering
1 s to infinity can only ever produce a guess.

---

## Scraping

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'api'
    static_configs:
      - targets: ['api-1:3000', 'api-2:3000']
        labels: {environment: production}

  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs: [{role: pod}]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
```

**Service discovery is the point.** Kubernetes, EC2, Consul, DNS and file-based
discovery all work, so targets appear and disappear as infrastructure changes
without editing config.

**`up` is free and valuable.** Prometheus records `up{job="api"}` as 1 or 0 for
every target on every scrape, giving you instance-level availability with no
instrumentation at all.

**15 seconds is a sensible default interval.** Shorter multiplies storage;
longer makes brief incidents invisible. Whatever you choose, **rate windows must
be at least four times the scrape interval** — `rate(x[1m])` on a 30-second
interval has two data points and produces nonsense.

---

## Cardinality

The one operational concern that matters more than everything else combined.

**Each unique label combination is a separate time series**, held in memory and
on disk. Series count is the cost model.

```js
// ✅ bounded — a few hundred series
{method: 'GET', route: '/api/orders/:id', status: '200'}

// ❌ unbounded — one series per user, forever
{method: 'GET', route: '/api/orders/12345', user_id: 'usr_31a'}
```

**The killers, all of them common:**

- User IDs, session IDs, request IDs, email addresses.
- **Full URL paths** instead of route patterns. `/api/orders/12345` is the
  single most frequent cause.
- Error messages as labels.
- Timestamps or anything derived from time.
- Unsanitised input echoed into a label.

**Series are not freed when they stop being written.** They stay in memory until
they age out of the retention window, so an accidental high-cardinality deploy
degrades the server for hours after it is reverted.

**Find offenders before they find you:**

```promql
# Which metrics have the most series?
topk(10, count by (__name__)({__name__=~".+"}))

# How many series per job?
count by (job)({__name__=~".+"})
```

**Rule of thumb:** a label is acceptable only if you can state its complete set
of possible values. If you cannot, it belongs on a span or a log line, not a
metric.

---

## PromQL

```promql
# Request rate per second, last 5 minutes
rate(http_requests_total[5m])

# Error ratio
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# p95 latency by route
histogram_quantile(
  0.95,
  sum by (le, route) (rate(http_request_duration_seconds_bucket[5m]))
)

# Memory growth over the last hour
delta(process_resident_memory_bytes[1h])

# Instances that are down
up == 0

# Disk full within 4 hours, based on the last 6 hours' trend
predict_linear(node_filesystem_avail_bytes[6h], 4 * 3600) < 0
```

**Rules that prevent most PromQL mistakes:**

- **`rate()` on counters, never on gauges.** `rate()` assumes monotonic increase
  and corrects for resets; applied to a gauge it produces meaningless output.
- **`rate()` before `sum()`, always.** `sum(rate(x[5m]))` is correct;
  `rate(sum(x)[5m])` mishandles counter resets when instances restart.
- **Keep `le` in the grouping** for `histogram_quantile`, or it cannot compute
  anything.
- **`increase()` is `rate()` × the window**, and it is easier to read for
  "how many in the last hour".
- **`irate()` is for graphs of volatile signals**, not for alerts — it uses only
  the last two points and is far too noisy to threshold on.

**Instant vector versus range vector** is the distinction that confuses
newcomers: `http_requests_total` is the current value per series; `[5m]` makes it
a range of values, and functions like `rate()` require a range.

---

## Recording and Alerting Rules

**Recording rules precompute expensive queries** on a schedule:

```yaml
groups:
  - name: api
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job) (rate(http_requests_total[5m]))

      - record: job:http_errors:ratio5m
        expr: |
          sum by (job) (rate(http_requests_total{status=~"5.."}[5m]))
            / sum by (job) (rate(http_requests_total[5m]))
```

Dashboards then query the precomputed series and load instantly. **The naming
convention is `level:metric:operation`**, and following it keeps recording rules
distinguishable from raw metrics at a glance.

**Alerting rules:**

```yaml
groups:
  - name: alerts
    rules:
      - alert: HighErrorRate
        expr: job:http_errors:ratio5m{job="api"} > 0.02
        for: 5m
        labels: {severity: page}
        annotations:
          summary: 'Error rate {{ $value | humanizePercentage }} on {{ $labels.job }}'
          runbook: https://wiki.internal/runbooks/high-error-rate

      - alert: DiskWillFill
        expr: predict_linear(node_filesystem_avail_bytes[6h], 4*3600) < 0
        for: 30m
        labels: {severity: ticket}
```

**`for` is what prevents flapping** — the condition must hold continuously.
**`predict_linear` is the underused one**: it alerts before the disk is full
rather than after, which is the difference between a ticket and an outage.

See [Monitoring](/knowledge-base/operations/monitoring) for what to alert on.

---

## Alertmanager

Prometheus evaluates rules; Alertmanager decides who hears about them.

```yaml
route:
  group_by: [alertname, cluster]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: slack
  routes:
    - matchers: [severity="page"]
      receiver: pagerduty
    - matchers: [severity="ticket"]
      receiver: jira

inhibit_rules:
  - source_matchers: [alertname="InstanceDown"]
    target_matchers: [severity="page"]
    equal: [instance]

receivers:
  - name: pagerduty
    pagerduty_configs: [{service_key: '...'}]
```

**Grouping is what keeps an incident to one notification** instead of forty —
when a cluster fails, every service alerts at once, and `group_by` collapses
them.

**Inhibition suppresses consequences of a known cause.** If an instance is down,
do not also page about every alert firing on that instance. This is the feature
that most reduces noise during a real incident.

**Silences** mute alerts during planned maintenance. Set an expiry — a permanent
silence is a deleted alert that nobody knows is deleted.

---

## Storage and Scale

**Local storage is the default**: efficient, and deliberately not clustered.
Retention defaults to 15 days.

```bash
--storage.tsdb.retention.time=30d
--storage.tsdb.retention.size=100GB
```

**Prometheus does not replicate.** For high availability, run two identical
servers scraping the same targets — each is independent, and Alertmanager
deduplicates identical alerts.

**For long-term storage and global query**, use remote write to Thanos, Mimir,
Cortex or a managed service. These add downsampling, object storage and querying
across many Prometheus servers.

**Sizing:** roughly 1–2 bytes per sample after compression. A million active
series at 15-second scrapes is a few hundred gigabytes a year — but **memory,
not disk, is the binding constraint**, and memory scales with active series.
Which brings you back to cardinality.

---

## Do's and Don'ts

### Do

- Use route patterns as labels, never concrete paths.
- Follow naming conventions: `snake_case`, base units, `_total` on counters.
- Choose histogram buckets that span your real latency range.
- Use `rate()` before `sum()`.
- Keep `le` in the grouping for `histogram_quantile`.
- Precompute dashboard queries with recording rules.
- Use `for` on every alert.
- Group and inhibit alerts in Alertmanager.
- Alert on `up == 0` for instance availability.
- Audit series counts regularly.

### Don't

- Don't put user IDs, request IDs or full paths in labels.
- Don't use `rate()` on a gauge.
- Don't use a rate window shorter than four scrape intervals.
- Don't use `irate()` in alerting rules.
- Don't use the Pushgateway for anything except batch jobs.
- Don't expect Prometheus to be a long-term store.
- Don't rely on averages when you have histograms.
- Don't leave silences without an expiry.
- Don't scrape every second because you can.

---

## Common Mistakes

**Cardinality explosion.** The full URL path as a label. The server runs out of
memory and stays degraded for hours after the fix.

**`rate(sum(...))` instead of `sum(rate(...))`.** Wrong at exactly the moment it
matters — when an instance restarts.

**Dropping `le`.** `histogram_quantile` silently returns nothing useful.

**Buckets that do not fit.** Everything in `+Inf` means every quantile is
invented.

**Rate window too short.** Fewer than two samples in the window gives gaps and
zeroes.

**Averages instead of quantiles.** The tail — where your unhappy users are — is
invisible.

**Pushgateway as a general ingest.** It never expires metrics, and it becomes a
single point of failure holding stale data forever.

**No `for` clause.** Every transient spike pages someone.

**Assuming high availability.** Two servers are two independent copies, not a
cluster.

---

## Debugging

```promql
# Highest-cardinality metrics
topk(10, count by (__name__)({__name__=~".+"}))

# Series per job
count by (job)({__name__=~".+"})

# Scrape health and duration
up
scrape_duration_seconds
```

| Symptom                | Cause                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Out of memory          | Cardinality; find the metric with `topk`                                   |
| Target missing         | Service discovery or relabelling dropped it; check Status → Targets        |
| Query returns nothing  | Label mismatch, or the metric name is wrong                                |
| Quantiles look wrong   | Buckets do not span the range, or `le` was dropped                         |
| Gaps in graphs         | Scrape failures, or a rate window that is too short                        |
| Alert never fires      | `for` too long; or the expression never evaluates true — test it in the UI |
| Alert fires constantly | No `for`, or the threshold is inside normal variation                      |
| Slow dashboards        | Wide ranges over raw series; add recording rules                           |

**The expression browser is the debugger.** Paste the alert expression in and
look at the result — most "the alert did not fire" reports are an expression that
never evaluated true, and thirty seconds in the UI shows it.

---

## FAQ

**Prometheus or a managed service?**
Self-host if you want control and have the operational capacity. Grafana Cloud,
Amazon Managed Prometheus and Datadog remove the storage and scaling work. The
query language and instrumentation are the same either way.

**How does it relate to OpenTelemetry?**
OTel is the instrumentation standard; Prometheus is a storage and query system.
The OTel Collector can export to Prometheus, and Prometheus can ingest OTLP.
Instrument with OTel and store in Prometheus is a common, sensible pairing. See
[OpenTelemetry](/knowledge-base/operations/opentelemetry).

**How do I monitor a batch job?**
The Pushgateway — jobs push on completion. This is its only legitimate use;
metrics there never expire, so keep it narrow.

**Do I need Grafana?**
Prometheus has a basic expression browser. For dashboards you want
[Grafana](/knowledge-base/operations/grafana), which is the standard pairing.

**How long should I retain data?**
15–30 days locally covers most operational needs. Anything longer belongs in
remote storage with downsampling.

**What about push-based metrics?**
The pull model is intrinsic. If you genuinely need push, use OTLP into the
Collector and export from there.

---

## Check your understanding

<Quiz
question="A team labels their request metric with the full URL path, so `/api/orders/12345` and `/api/orders/67890` are separate label values. What happens?"
options={[
{
text: 'Cardinality explodes — one time series per distinct path, held in memory, and the server eventually runs out of memory',
correct: true,
why: 'Each unique label combination is a separate series. An unbounded label value means unbounded series, and series count is Prometheus\'s entire cost model.',
},
{text: 'Prometheus automatically aggregates similar paths', why: 'It does no such normalisation — label values are opaque strings.'},
{text: 'Queries become slower but storage is unaffected', why: 'Both are affected, and memory is the binding constraint.'},
{text: 'The scrape fails once the metric exceeds a size limit', why: 'There is a body size limit, and the usual outcome is gradual memory exhaustion rather than a clean failure.'},
]}
explanation={<>Use the route <em>pattern</em> — <code>/api/orders/:id</code> — as the label. Note also that series are not freed when they stop being written: they persist until they age out of retention, so a bad deploy degrades the server for hours after it is reverted.</>}
reference={{label: 'Cardinality', href: '/knowledge-base/operations/prometheus#cardinality'}}
/>

<Quiz
question="Why is `sum(rate(http_requests_total[5m]))` correct where `rate(sum(http_requests_total)[5m])` is wrong?"
options={[
{
text: 'rate() corrects for counter resets per series; summing first merges series so a restart on one instance looks like a decrease in the total',
correct: true,
why: 'Counter reset handling only works on individual counters. Once summed, a restart produces a drop that rate() cannot distinguish from a genuine decline.',
},
{text: 'The second form is invalid PromQL syntax', why: 'Subquery syntax makes something similar expressible, and it is semantically wrong rather than unparseable.'},
{text: 'sum() cannot be applied to counters', why: 'Summing rates across instances is exactly the normal pattern.'},
{text: 'rate() requires a single time series as input', why: 'It operates on every series in a range vector independently.'},
]}
explanation={<>The general rule: <strong>always rate before you aggregate</strong>. This is wrong precisely when it matters most — during a deploy or a crash loop, when instances are restarting.</>}
reference={{label: 'PromQL', href: '/knowledge-base/operations/prometheus#promql'}}
/>

<Quiz
question="A p99 latency panel shows a suspiciously round value that never changes. The histogram's largest finite bucket boundary is one second, and real latencies are 2–8 seconds. What is happening?"
options={[
{
text: 'Every observation lands in the +Inf bucket, so histogram_quantile has no information above 1 second and the result is interpolated fiction',
correct: true,
why: 'Quantiles are estimated by interpolating within buckets. With everything above the largest finite boundary there is nothing to interpolate between.',
},
{text: 'The metric is a summary rather than a histogram', why: 'Summaries have their own aggregation problem, and the symptom here points at bucket boundaries.'},
{text: 'The scrape interval is too long to compute quantiles', why: 'Scrape interval affects resolution over time, not bucket coverage.'},
{text: 'histogram_quantile requires an odd number of buckets', why: 'No such requirement exists.'},
]}
explanation={<>Choose buckets that span the range you actually observe, and remember to keep <code>le</code> in the grouping — <code>sum by (le, route)</code> — or the function cannot compute anything at all.</>}
reference={{label: 'Exposing metrics', href: '/knowledge-base/operations/prometheus#exposing-metrics'}}
/>

<Quiz
question="Which of these are correct Prometheus practices?"
type="multiple"
options={[
{text: 'Using `for` on every alerting rule', correct: true, why: 'It requires the condition to hold continuously, eliminating the single-scrape spikes behind most false pages.'},
{text: 'Precomputing dashboard queries with recording rules', correct: true, why: 'Dashboards then read a precomputed series instead of aggregating raw data over a wide range.'},
{text: 'Alerting on `up == 0` for instance availability', correct: true, why: 'Prometheus records it on every scrape for every target, at no instrumentation cost.'},
{text: 'Using predict_linear to alert before a disk fills rather than after', correct: true, why: 'The difference between a ticket during working hours and an outage at 3 a.m.'},
{text: 'Using irate() in alerting expressions for faster detection', why: 'irate() uses only the last two samples and is far too noisy to threshold on. It is for graphing volatile signals.'},
]}
explanation={<>Rate windows must also be at least four times the scrape interval — <code>rate(x[1m])</code> on a 30-second scrape has two data points and produces nonsense.</>}
reference={{label: 'Recording and alerting rules', href: '/knowledge-base/operations/prometheus#recording-and-alerting-rules'}}
/>

<Quiz
question="A cluster failure causes forty separate alerts to page on-call simultaneously. Which Alertmanager features address this?"
options={[
{
text: 'Grouping to collapse related alerts into one notification, and inhibition to suppress alerts that are consequences of a known cause',
correct: true,
why: 'group_by collapses alerts sharing labels into a single notification; inhibit_rules stop an InstanceDown alert from also paging for every alert firing on that instance.',
},
{text: 'Increasing repeat_interval so notifications are sent less often', why: 'It reduces repeats of the same notification, not the initial flood of forty distinct ones.'},
{text: 'Adding a longer `for` clause to every rule', why: 'It delays the flood rather than consolidating it — a genuine cluster failure persists.'},
{text: 'Creating a permanent silence for the noisiest alerts', why: 'A permanent silence is a deleted alert nobody knows is deleted. Silences need expiry dates.'},
]}
explanation={<>Inhibition is the feature that most reduces noise during a real incident: when the cause is already known and paged, its consequences should not page again.</>}
reference={{label: 'Alertmanager', href: '/knowledge-base/operations/prometheus#alertmanager'}}
/>

---

## References

- [Prometheus documentation](https://prometheus.io/docs/introduction/overview/)
  — concepts, configuration and operation.
- [PromQL basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
  — selectors, vectors and functions.
- [Metric and label naming](https://prometheus.io/docs/practices/naming/) — the
  conventions tooling assumes.
- [Histograms and summaries](https://prometheus.io/docs/practices/histograms/) —
  bucket choice and quantile estimation.
- [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/)
  — routing, grouping, inhibition and silences.
- [Grafana](/knowledge-base/operations/grafana) — the dashboarding half of the
  pairing.
