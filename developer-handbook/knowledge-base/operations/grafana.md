---
title: 'Grafana'
description: 'Dashboards and visualisation over your telemetry — data sources, panels, variables, alerting, provisioning as code, and the LGTM stack.'
---

# Grafana

## Introduction

Grafana queries data sources — Prometheus, Loki, Tempo, PostgreSQL, CloudWatch,
dozens more — and renders dashboards and alerts over them. It stores no
telemetry itself; it is a query and presentation layer.

**Most dashboards are bad, and they fail the same way:** they show everything the
data source offers rather than what a responder needs. A wall of forty panels is
decorative. Nobody reads it at 3 a.m.

**The test for any dashboard: what question does it answer, and who is asking?**

- "Is the service healthy right now?" → an overview: golden signals, above the
  fold, no scrolling.
- "Why is checkout slow?" → a drill-down, opened deliberately.
- "How many signups this month?" → a business dashboard, for a different
  audience entirely.

A dashboard trying to serve all three serves none. Build one per question.

**This page assumes [Monitoring](/knowledge-base/operations/monitoring) for what
to measure and [Prometheus](/knowledge-base/operations/prometheus) for the query
language.**

---

## Data Sources

| Source                        | For                            |
| ----------------------------- | ------------------------------ |
| **Prometheus / Mimir**        | Metrics                        |
| **Loki**                      | Logs                           |
| **Tempo**                     | Traces                         |
| **PostgreSQL, MySQL**         | Business data queried directly |
| **CloudWatch, Azure Monitor** | Cloud provider metrics         |
| **Elasticsearch**             | Logs and documents             |

**Configure data source correlations.** Grafana can link from a log line to its
trace, and from a trace span to the logs for that trace, provided you tell it
which field carries the trace ID. This turns three tools into one investigation —
and it is a five-minute configuration that most installations skip.

**Mixed data sources in one dashboard** let you overlay a business metric from
PostgreSQL on infrastructure metrics from Prometheus. Occasionally exactly what
you need, and worth knowing is possible.

---

## Panels and Queries

**Panel types worth knowing:**

| Type               | Use for                                     |
| ------------------ | ------------------------------------------- |
| **Time series**    | The default; anything over time             |
| **Stat**           | One big number — current error rate, uptime |
| **Gauge**          | A value against a threshold                 |
| **Table**          | Per-instance detail, top-N lists            |
| **Heatmap**        | Latency distributions over time             |
| **Logs**           | Loki output inline                          |
| **State timeline** | Up/down status across many targets          |

**Heatmaps are underused for latency.** A p99 line hides whether you have one
slow cohort or a uniform shift; a heatmap shows the whole distribution, and
bimodal latency — two distinct populations of users — becomes immediately
obvious in a way percentile lines never make it.

**Query performance:**

- **Use recording rules** for anything expensive. A dashboard that takes twenty
  seconds is a dashboard nobody opens during an incident.
- **Set a sensible `$__rate_interval`** rather than a hard-coded window; it
  adapts to the selected time range.
- **Limit series per panel.** Fifty overlapping lines convey nothing — aggregate,
  or use `topk`.
- **Avoid `Instant` queries** on panels that need history.

**Units and thresholds are not decoration.** Set the unit (seconds, bytes,
percent) so axes are readable, and set thresholds so "bad" is visible without
reading the number.

---

## Variables

Variables turn one dashboard into many.

```
$environment   → label_values(up, environment)
$service       → label_values(up{environment="$environment"}, job)
$instance      → label_values(up{job="$service"}, instance)
```

```promql
sum by (route) (rate(http_requests_total{job="$service", environment="$environment"}[$__rate_interval]))
```

**Chained variables** — each filtered by the previous — are what make a single
dashboard usable across every service and environment, instead of copying it per
service and watching the copies diverge.

**Use `$__rate_interval`**, not a fixed `[5m]`. Grafana computes a window
appropriate to the selected range and the scrape interval, which stops your
graphs from breaking when someone zooms out to thirty days.

**Repeat panels or rows by a variable** to render one panel per instance
automatically.

**Keep the variable count small.** Six dropdowns above the graphs is a
configuration screen, not a dashboard.

---

## Dashboards for Incidents

**The overview dashboard, in order, no scrolling:**

1. **Is it up?** A stat panel: current availability, error rate.
2. **Golden signals.** Latency (p50/p95/p99), traffic, errors, saturation.
3. **By dimension.** Errors by route, latency by endpoint.
4. **Dependencies.** Database, cache, third-party APIs.

**Annotate deploys.** Overlaying deployment markers answers "did we cause this?"
instantly, and that is the first question in almost every incident. Wire it into
your pipeline:

```bash
curl -X POST "$GRAFANA_URL/api/annotations" \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Deploy v1.4.2","tags":["deploy","api"]}'
```

**Link panels to drill-downs.** A panel showing errors by route should link to
the logs for that route with the time range preserved. Grafana's data links
carry `$__from` and `$__to`, so the drill-down opens at the moment you were
looking at.

**Delete unused dashboards.** They rot, and a stale dashboard is worse than none
— someone will trust it during an incident.

---

## Alerting

Grafana's unified alerting can evaluate rules against any data source, not only
Prometheus, which is its main advantage over Prometheus-native rules — you can
alert on a business metric queried straight from PostgreSQL.

**Structure:**

- **Alert rule** — a query, a condition, an evaluation interval, and a pending
  period.
- **Notification policy** — routes by label to a contact point, with grouping.
- **Contact point** — Slack, PagerDuty, email, webhook.
- **Mute timing** — recurring maintenance windows.

**The pending period is Prometheus's `for`**: the condition must hold that long
before firing. Without it, every transient spike pages someone.

**Which alerting to use:**

- **Prometheus-native rules** if you are Prometheus-centric — they evaluate even
  when Grafana is down, which matters.
- **Grafana alerting** when you need multiple data sources, or want alert rules
  managed alongside dashboards.

Do not run both for the same condition; you will get duplicate pages and a
disagreement about which is authoritative.

See [Monitoring: alerting](/knowledge-base/operations/monitoring#alerting) for
what makes an alert worth having.

---

## Dashboards as Code

**Click-built dashboards drift, get accidentally deleted, and cannot be
reviewed.** Provision them from files instead.

```yaml
# provisioning/dashboards/main.yml
apiVersion: 1
providers:
  - name: 'services'
    folder: 'Services'
    type: file
    disableDeletion: true
    allowUiUpdates: false
    options:
      path: /etc/grafana/dashboards
```

**Options:**

- **JSON in git**, provisioned as above. Simple, verbose, and the diffs are
  unpleasant.
- **Grafonnet** (Jsonnet) — composable, with real abstraction over repeated
  panels.
- **Terraform provider** — dashboards alongside the rest of your infrastructure.
- **Grafana Foundation SDK** — generate dashboards from TypeScript, Go or
  Python.

**Set `allowUiUpdates: false`** so nobody edits a provisioned dashboard in the UI
and loses the change on the next restart. Editing in the UI to explore, then
exporting the JSON, is a reasonable workflow — silently editing production
dashboards is not.

---

## The LGTM Stack

Grafana Labs' open-source set, designed to work together:

| Component   | Signal        | Notes                                      |
| ----------- | ------------- | ------------------------------------------ |
| **Loki**    | Logs          | Indexes labels, not content — cheap        |
| **Grafana** | Visualisation | The layer you look at                      |
| **Tempo**   | Traces        | Object-storage backed, inexpensive         |
| **Mimir**   | Metrics       | Prometheus-compatible, long-term, scalable |

**Loki's design is the interesting one.** It indexes only a small label set and
stores log content compressed, so queries narrow by label first and then grep.
Far cheaper than a full-text index — and **high-cardinality values must be log
fields, not labels**, or you recreate the cardinality problem in a system
designed to avoid it.

**Tempo does not index traces either.** You look them up by trace ID, which you
get from a log line or a metric exemplar. That constraint is why the correlation
configuration matters: without a path from metric to trace ID, Tempo is hard to
use.

**Grafana Alloy** is the current collector — an OpenTelemetry Collector
distribution that replaced the older Grafana Agent, which is now end-of-life.

---

## Do's and Don'ts

### Do

- Build one dashboard per question, with the overview above the fold.
- Configure data source correlations between metrics, logs and traces.
- Use variables and `$__rate_interval` rather than hard-coded values.
- Annotate deploys automatically from your pipeline.
- Use recording rules for expensive queries.
- Set units and thresholds on every panel.
- Provision dashboards from version control.
- Use heatmaps for latency distributions.
- Add data links from panels to drill-downs.
- Delete dashboards nobody opens.

### Don't

- Don't build a dashboard with forty panels.
- Don't hard-code time windows in queries.
- Don't render fifty series on one panel.
- Don't duplicate the same alert in both Grafana and Prometheus.
- Don't use high-cardinality Loki labels.
- Don't alert without a pending period.
- Don't let click-built dashboards be the source of truth.
- Don't keep dashboards that reference metrics no longer emitted.

---

## Common Mistakes

**Dashboards showing everything.** Unreadable under pressure, which is the only
time they matter.

**No deploy annotations.** The first question in every incident goes unanswered.

**Hard-coded `[5m]` windows.** Graphs break when the range is widened.

**Slow queries.** A twenty-second dashboard is not used during an incident. Use
recording rules.

**Metrics, logs and traces unlinked.** Three tabs and manual timestamp matching,
when a five-minute configuration would have joined them.

**High-cardinality Loki labels.** Recreates the exact problem Loki's design
avoids.

**Duplicate alerting.** Two systems, two pages, and an argument about which one
is right.

**Dashboards only in the UI.** Deleted, drifted, or edited by someone who has
since left.

**Averages on panels.** Same problem as everywhere else — the tail disappears.

---

## Debugging

| Symptom                       | Where to look                                                    |
| ----------------------------- | ---------------------------------------------------------------- |
| Panel shows "No data"         | Query returns nothing — test it in Explore                       |
| Dashboard very slow           | Expensive queries or too wide a range; add recording rules       |
| Variable empty                | Its query returns nothing; check the label exists                |
| Alert not firing              | Evaluation interval, pending period, or the condition never true |
| Duplicate notifications       | Alerts defined in both Grafana and Prometheus                    |
| Graph flat at zero            | Unit mismatch, or `rate()` on a gauge                            |
| Links lose the time range     | Data link missing `$__from` and `$__to`                          |
| Provisioned dashboard reverts | `allowUiUpdates: false` — edit the file                          |

**Explore is the debugger.** Run the query there, without panel configuration in
the way, and you find out immediately whether the problem is the data or the
presentation.

---

## FAQ

**Grafana or a vendor dashboard?**
Grafana if you want one pane over multiple sources, or to avoid lock-in. Vendor
dashboards are more polished and cover only that vendor's data.

**Grafana Cloud or self-hosted?**
Self-hosting Grafana itself is easy; the storage backends are the work. Grafana
Cloud has a usable free tier and removes the operational burden.

**Can I use it without Prometheus?**
Yes — CloudWatch, PostgreSQL, Elasticsearch and many others all work directly.

**How do I share a dashboard?**
Export JSON, or use a snapshot for a point-in-time view. Public dashboards exist
and expose data without authentication, so be deliberate.

**Should I use community dashboards?**
As a starting point, yes — there are thousands. Expect to prune heavily; most
show far more than you need.

**How do I handle multiple environments?**
One dashboard with an `$environment` variable, rather than a copy per
environment that slowly diverges.

---

## Check your understanding

<Quiz
question="An incident response dashboard has forty panels covering every available metric. Why is this a problem?"
options={[
{
text: 'Nobody can find the relevant signal under pressure — a dashboard should answer one specific question for one audience',
correct: true,
why: 'Density is not information. During an incident the responder needs the golden signals immediately, not a complete inventory of what the data source offers.',
},
{text: 'Grafana limits dashboards to twenty panels', why: 'There is no such limit.'},
{text: 'Forty panels cannot be provisioned from code', why: 'Panel count has no bearing on provisioning.'},
{text: 'It uses too much browser memory', why: 'It can be slow, and the real cost is that the dashboard goes unused when it matters.'},
]}
explanation={<>Build an overview with the golden signals above the fold and no scrolling, and keep drill-downs as separate dashboards opened deliberately. Then delete dashboards nobody opens — a stale one is worse than none, because someone will trust it mid-incident.</>}
reference={{label: 'Dashboards for incidents', href: '/knowledge-base/operations/grafana#dashboards-for-incidents'}}
/>

<Quiz
question="A panel query uses `rate(http_requests_total[5m])`. When someone changes the dashboard range to 30 days, the graph becomes sparse and misleading. What should it use instead?"
options={[
{
text: '$__rate_interval, which Grafana computes from the selected range and the scrape interval',
correct: true,
why: 'A fixed 5m window is far too short once each pixel represents hours of data, so most of the range is unsampled.',
},
{text: 'A longer fixed window such as [1h]', why: 'It fixes the 30-day view and breaks the 15-minute one. Fixed windows are the problem.'},
{text: 'irate() instead of rate()', why: 'irate() uses only the last two samples and is even noisier over wide ranges.'},
{text: 'An Instant query', why: 'That returns a single current value with no history at all.'},
]}
explanation={<>Pair <code>$__rate_interval</code> with template variables for environment and service, and one dashboard covers every service in every environment — instead of per-service copies that slowly diverge.</>}
reference={{label: 'Variables', href: '/knowledge-base/operations/grafana#variables'}}
/>

<Quiz
question="A team stores logs in Loki and adds `user_id` as a Loki label so they can filter by customer. What goes wrong?"
options={[
{
text: 'Loki indexes labels, so a label per user creates enormous index cardinality — recreating the exact problem Loki\'s design exists to avoid',
correct: true,
why: 'Loki\'s cheapness comes from indexing a small bounded label set and storing content compressed. Unbounded labels destroy that model.',
},
{text: 'Loki does not support filtering by label', why: 'Label filtering is its primary query mechanism — the issue is which values belong in labels.'},
{text: 'User IDs must be hashed before storage', why: 'A privacy consideration, not the operational failure here.'},
{text: 'Loki rejects labels with more than 100 distinct values', why: 'There are configurable limits, and the failure is usually degradation rather than rejection.'},
]}
explanation={<>Keep <code>user_id</code> as a <em>field</em> in the structured log line and filter on it after narrowing by bounded labels such as service and level. Queries narrow by label first, then grep the content.</>}
reference={{label: 'The LGTM stack', href: '/knowledge-base/operations/grafana#the-lgtm-stack'}}
/>

<Quiz
question="Which practices make Grafana genuinely useful during an incident?"
type="multiple"
options={[
{text: 'Automatic deploy annotations pushed from the CI pipeline', correct: true, why: '"What changed?" is the first question in nearly every incident, and markers answer it in seconds.'},
{text: 'Data source correlations linking metrics to traces and traces to logs', correct: true, why: 'It turns three tools into one continuous investigation, and it is a short configuration most installations skip.'},
{text: 'Recording rules behind expensive dashboard queries', correct: true, why: 'A dashboard that takes twenty seconds to load is one nobody opens under pressure.'},
{text: 'Data links that carry the current time range into the drill-down', correct: true, why: 'The drill-down opens at the moment you were looking at, rather than the default range.'},
{text: 'Defining the same alert in both Grafana and Prometheus for redundancy', why: 'You get duplicate pages and a disagreement about which system is authoritative. Pick one per condition.'},
]}
explanation={<>Prometheus-native rules keep evaluating even when Grafana is down, which is an argument for them; Grafana alerting wins when you need to alert across multiple data sources.</>}
reference={{label: 'Alerting', href: '/knowledge-base/operations/grafana#alerting'}}
/>

<Quiz
question="A dashboard's p99 latency line looks stable, but users report wildly inconsistent experiences. Which panel type would reveal what a percentile line hides?"
options={[
{
text: 'A heatmap, which shows the whole latency distribution and makes a bimodal split between two user populations immediately visible',
correct: true,
why: 'A single percentile is one point on a distribution. A heatmap shows the shape, so two distinct clusters of fast and slow requests are obvious.',
},
{text: 'A gauge showing the current p99 value', why: 'Less information than the line, not more.'},
{text: 'A stat panel showing the average', why: 'Averages hide the tail even more thoroughly than percentiles do.'},
{text: 'A state timeline of instance health', why: 'Useful for availability, and it says nothing about latency distribution.'},
]}
explanation={<>Heatmaps are consistently underused for latency. A stable p99 with a bimodal distribution usually means one cohort — a region, a tenant, a client version — is having a very different experience from everyone else.</>}
reference={{label: 'Panels and queries', href: '/knowledge-base/operations/grafana#panels-and-queries'}}
/>

---

## References

- [Grafana documentation](https://grafana.com/docs/grafana/latest/) — panels,
  variables, data sources.
- [Grafana Alerting](https://grafana.com/docs/grafana/latest/alerting/) — rules,
  notification policies and contact points.
- [Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
  — dashboards and data sources as code.
- [Loki: labels best practices](https://grafana.com/docs/loki/latest/get-started/labels/)
  — why cardinality matters here too.
- [Grafana Alloy](https://grafana.com/docs/alloy/latest/) — the current
  collector, replacing Grafana Agent.
- [Prometheus](/knowledge-base/operations/prometheus) — the query language most
  of these panels use.
