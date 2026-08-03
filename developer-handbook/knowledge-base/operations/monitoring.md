---
title: 'Monitoring'
description: 'Knowing when something is wrong before users report it — golden signals, metric types, SLOs, error budgets and alerts people act on.'
---

# Monitoring

## Introduction

Monitoring watches known signals and tells you when they cross a threshold.

**The hard part is not collecting metrics.** Collecting is easy; every framework
and platform will hand you hundreds of them. The hard part is choosing what to
alert on, because **every alert that fires without requiring action trains the
team to ignore the next one** — including the one that mattered.

**The single most useful reframing:** alert on symptoms, not causes.

- ❌ "CPU is above 80%" — so what? If users are happy, this is not a problem.
- ✅ "The checkout error rate exceeded 2% for five minutes" — users are affected.

High CPU might be fine. A full disk might be fine for hours. What is never fine
is users failing to complete what they came to do. Alert on that, and use
everything else for diagnosis once you are already looking.

**Monitoring is not observability.** Monitoring answers questions you thought to
ask in advance. Observability is being able to answer questions you had not
thought of. You need both, and monitoring comes first. See
[Observability](/knowledge-base/operations/observability).

---

## The Four Golden Signals

From Google's SRE practice, and still the best starting list:

| Signal         | Question                   | Typical metric                             |
| -------------- | -------------------------- | ------------------------------------------ |
| **Latency**    | How long do requests take? | Request duration, split by success/failure |
| **Traffic**    | How much demand?           | Requests per second                        |
| **Errors**     | What proportion fail?      | 5xx rate, exception rate                   |
| **Saturation** | How full is the system?    | Queue depth, connection pool, memory       |

**Measure latency for successes and failures separately.** A failing request is
often fast — a connection refused returns in a millisecond — so mixing them makes
latency _improve_ during an outage. This inversion has misled more than one team
mid-incident.

**For infrastructure, USE is the counterpart:** Utilisation, Saturation, Errors,
per resource. Golden signals describe the service your users experience; USE
describes the machine underneath it.

**Saturation is the leading indicator.** Latency and errors tell you something is
wrong now. A connection pool at 90% or a queue growing steadily tells you
something will be wrong in twenty minutes, which is enough time to act.

---

## Metric Types

| Type          | Behaviour                                              | Examples                                       |
| ------------- | ------------------------------------------------------ | ---------------------------------------------- |
| **Counter**   | Only increases; reset to zero on restart               | Requests served, errors, bytes sent            |
| **Gauge**     | Goes up and down                                       | Memory in use, queue depth, active connections |
| **Histogram** | Buckets observations; percentiles computed server-side | Request duration, payload size                 |
| **Summary**   | Percentiles computed client-side                       | Rarely the right choice                        |

**Counters are queried as rates, not values.** The raw number is meaningless —
what you want is `rate(http_requests_total[5m])`. Counter resets on restart are
handled by the query function, which is exactly why counters must only ever
increase.

**Histograms are what you want for latency**, because they aggregate correctly
across instances. Summaries compute percentiles per instance, and **percentiles
cannot be averaged** — the mean of three instances' p99 is not the p99. This is
the most common statistical error in monitoring setups.

**Never alert on averages.** An average request time of 200 ms is consistent with
99% of users at 50 ms and 1% at 15 seconds. Use p50 for the typical experience,
p95 and p99 for the tail. **The tail is where your unhappy users are**, and at
scale the p99 is thousands of people.

**Labels multiply series.** A metric with labels for endpoint, method and status
creates one time series per combination. **Never label by user ID, request ID,
email or full URL path** — that is unbounded cardinality, and it is the standard
way to fall over a Prometheus server. See
[Prometheus](/knowledge-base/operations/prometheus).

---

## SLIs, SLOs and Error Budgets

**SLI** — a service level _indicator_: a measurement. "Proportion of requests
served successfully in under 300 ms."

**SLO** — a service level _objective_: a target for that measurement. "99.9% over
30 days."

**Error budget** — what the objective permits you to spend. A 99.9% SLO over 30
days allows about **43 minutes** of failure.

| SLO    | Allowed downtime per 30 days |
| ------ | ---------------------------- |
| 99%    | 7 hours 18 minutes           |
| 99.9%  | 43 minutes                   |
| 99.95% | 21 minutes                   |
| 99.99% | 4 minutes 20 seconds         |

**The error budget is the point of the exercise.** It turns reliability from an
argument into a number. Budget remaining? Ship features. Budget exhausted? Stop
shipping and fix reliability. That converts "are we stable enough to deploy?"
from a matter of opinion into a matter of measurement.

**Do not aim for 100%.** It is unachievable, and pursuing it costs enormously
while your users' networks and devices fail more often than your service does.
Pick an objective that reflects what users actually notice.

**Base SLIs on user-visible behaviour.** "The API returned 200" is weaker than
"the user's order was created". Measure the outcome where you can.

---

## Alerting

**Every alert should be actionable, urgent and user-visible.** If it fails any
of those three, it belongs on a dashboard or in a ticket queue — not on a pager.

**Alert on symptoms:**

```yaml
# ✅ Users are affected
- alert: HighErrorRate
  expr: |
    sum(rate(http_requests_total{status=~"5.."}[5m]))
      / sum(rate(http_requests_total[5m])) > 0.02
  for: 5m
  annotations:
    summary: '5xx rate above 2% for 5 minutes'
    runbook: https://wiki.internal/runbooks/high-error-rate
```

**The `for` clause is what stops flapping.** Requiring the condition to hold for
several minutes eliminates the single-scrape spikes that produce most 3 a.m.
pages for nothing.

**Burn-rate alerting is the modern approach.** Rather than a fixed threshold,
alert on how fast you are consuming the error budget: a fast burn (2% of the
budget in an hour) pages immediately; a slow burn (10% over three days) opens a
ticket. This gives you urgency proportional to impact, and it dramatically
reduces false pages.

**Every alert needs a runbook link.** Being paged at 3 a.m. for something you
have never seen, with no documentation, is how people leave teams. The runbook
should say what the alert means, how to confirm it, and what to do first.

**Prune ruthlessly.** Review alerts monthly. Anything that fired and required no
action either needs its threshold changed or needs deleting. **An alert that is
routinely ignored is worse than no alert**, because it also hides the ones that
are not.

---

## What to Actually Monitor

**Start here, in this order:**

1. **External uptime check.** Something outside your infrastructure requesting a
   real page. Free, and it catches total failure — including the failures your
   internal monitoring cannot report because it is also down.
2. **Error rate and latency**, per endpoint.
3. **Saturation** — disk, memory, connection pool, queue depth.
4. **Business metrics** — orders per minute, signups, payments. These often
   detect problems the technical metrics miss entirely: a deploy that breaks the
   checkout button produces perfect 200s and zero orders.
5. **Dependencies** — third-party API error rates and latency.
6. **Certificate and domain expiry.** Unglamorous, entirely preventable, and a
   recurring cause of outages.

**Synthetic checks that exercise a real user journey** — log in, add to basket,
check out — catch broken flows that per-endpoint metrics report as healthy.

---

## Dashboards

**Fewer, better dashboards.** A wall of forty graphs is decorative; nobody reads
it during an incident.

- **One overview per service**: the golden signals, above the fold, no
  scrolling.
- **Order by user impact**, not by system layer.
- **Annotate deploys.** Overlaying deployment markers answers "did we cause
  this?" instantly, and that is the first question in most incidents.
- **Keep drill-down dashboards separate** from the overview.
- **Delete unused dashboards.** They rot, and a stale dashboard actively misleads.

See [Grafana](/knowledge-base/operations/grafana).

---

## On-Call

Monitoring produces pages, and pages land on people.

- **Track alert volume as a metric of its own.** More than a couple of pages per
  shift is a broken system, not a busy one.
- **Every page should have a runbook**, and every incident should improve one.
- **Blameless post-incident reviews.** The question is what made the failure
  possible, not who typed the command.
- **Rotate fairly**, and compensate out-of-hours work.
- **Track time-to-acknowledge and time-to-resolve.** If acknowledgement is slow,
  people have stopped believing the alerts.

**Alert fatigue is the failure mode that matters most**, because it degrades
silently. The team is still paged, still responding, and gradually less
carefully.

---

## Do's and Don'ts

### Do

- Alert on user-visible symptoms.
- Use percentiles, never averages.
- Separate latency for successful and failed requests.
- Define SLOs and track error budgets.
- Use burn-rate alerts rather than fixed thresholds.
- Put a runbook link on every alert.
- Use `for` to require a condition to persist.
- Monitor business metrics alongside technical ones.
- Run an external uptime check.
- Annotate deploys on dashboards.
- Review and delete alerts monthly.

### Don't

- Don't alert on CPU or memory without user impact.
- Don't alert on averages.
- Don't use unbounded label values.
- Don't page for anything that is not urgent and actionable.
- Don't aim for 100% availability.
- Don't build dashboards nobody opens.
- Don't monitor your infrastructure only from inside it.
- Don't leave a routinely ignored alert enabled.
- Don't average percentiles across instances.

---

## Common Mistakes

**Alerting on causes.** High CPU pages someone at 3 a.m. while users are
perfectly happy. Alert on the error rate instead.

**Averages hiding the tail.** A healthy-looking mean with a p99 of fifteen
seconds.

**Mixing failed requests into latency.** Failures are fast, so latency improves
during an outage.

**Unbounded cardinality.** A label per user ID kills the metrics backend.

**No `for` clause.** Every transient spike becomes a page.

**Alerts with no runbook.** The responder starts from nothing under time
pressure.

**Only technical metrics.** Checkout is broken, every endpoint returns 200, and
nothing fires. A business metric would have caught it in minutes.

**Monitoring only from inside.** Your infrastructure is down, and so is the
monitoring that would have told you.

**Averaging percentiles across instances.** Statistically meaningless, and
routinely done.

**Never pruning alerts.** They accumulate until the team filters the channel
out.

---

## Debugging

| Symptom                            | Where to look                                          |
| ---------------------------------- | ------------------------------------------------------ |
| Alert fired, nothing wrong         | Threshold too tight, or missing `for`                  |
| Users complain, nothing fired      | No SLI covers the failing path; add a synthetic check  |
| Metrics stopped                    | Scrape target down, or a relabelling change dropped it |
| Prometheus out of memory           | Cardinality — find the offending label                 |
| Latency improved during an outage  | Failed requests included in the histogram              |
| Dashboard slower than the incident | Query range too wide; use recording rules              |
| Percentiles look wrong             | Histogram buckets do not span the actual range         |

**Check whether the metric exists before trusting a quiet dashboard.** A panel
showing "no data" and a panel showing zero look similar at a glance and mean
completely different things.

---

## FAQ

**Where do I start with nothing in place?**
An external uptime check and error tracking. Both take under an hour and catch
most outright failures. Then error rate and latency per endpoint.

**Which stack?**
[Prometheus](/knowledge-base/operations/prometheus) plus
[Grafana](/knowledge-base/operations/grafana) if you want to run it yourself;
Datadog, Grafana Cloud or New Relic if you would rather not. Managed is usually
right below a certain scale.

**How many alerts should exist?**
Few enough that every page is taken seriously. For a typical service, five to
fifteen genuinely paging alerts is plenty.

**What SLO should I pick?**
Start by measuring current performance for a month, then set an objective
slightly above it. An SLO you have never met is a target nobody believes.

**Do I need on-call for a small team?**
If the service matters overnight, yes. If it does not, say so explicitly and
alert during business hours — an honest policy beats an unstaffed pager.

**Monitoring or observability first?**
Monitoring. Knowing that something is broken beats being able to explore why,
when you have neither.

---

## Check your understanding

<Quiz
question="During an outage, a service's p99 latency graph improves sharply. What is the most likely explanation?"
options={[
{
text: 'Failed requests are included in the latency histogram, and failures return quickly — a connection refused takes a millisecond',
correct: true,
why: 'Mixing successes and failures inverts the signal: the more requests that fail fast, the better latency appears.',
},
{text: 'The service genuinely got faster under reduced load', why: 'Possible in principle, and a sharp improvement coinciding with an outage points at measurement.'},
{text: 'The metrics scraper stopped collecting data', why: 'That shows as a gap or stale data, not an improved value.'},
{text: 'Percentile calculation is unreliable at low request volumes', why: 'Noisier at low volume, and it would not produce a consistent improvement.'},
]}
explanation={<>Split latency by outcome, so the success histogram reflects the experience of users who got a response and failures are counted separately. This inversion has misled teams mid-incident into believing the service recovered.</>}
reference={{label: 'The four golden signals', href: '/knowledge-base/operations/monitoring#the-four-golden-signals'}}
/>

<Quiz
question="A team pages on-call whenever CPU exceeds 80%. What is wrong with this alert?"
options={[
{
text: 'It alerts on a cause rather than a symptom — high CPU with happy users is not a problem, and it trains the team to ignore pages',
correct: true,
why: 'Alerts should fire when users are affected. Resource metrics are for diagnosis once you are already looking.',
},
{text: '80% is too low a threshold; 95% would be correct', why: 'Adjusting the number does not fix alerting on the wrong kind of signal.'},
{text: 'CPU should be measured as a gauge rather than a counter', why: 'It is a gauge, and the metric type is not the issue.'},
{text: 'CPU cannot be measured accurately in containers', why: 'A real subtlety around limits and throttling, and not why this alert is wrong.'},
]}
explanation={<>Alert on error rate, latency against your SLO, and saturation that predicts imminent failure. Keep CPU on the dashboard for diagnosis. Every non-actionable page erodes trust in every other alert.</>}
reference={{label: 'Alerting', href: '/knowledge-base/operations/monitoring#alerting'}}
/>

<Quiz
question="A service reports an average response time of 200 ms and the team considers performance healthy. What might this be hiding?"
options={[
{
text: 'A long tail — 99% of requests at 50 ms and 1% at 15 seconds produces the same average, and that 1% is thousands of users at scale',
correct: true,
why: 'The mean is dominated by the bulk of requests and says nothing about the distribution\'s shape, which is where unhappy users live.',
},
{text: 'Nothing — the average is the standard latency measure', why: 'It is common and close to useless for latency, precisely because of tail behaviour.'},
{text: 'That the sample size is too small', why: 'A real caveat at low volume, and unrelated to why averages mislead.'},
{text: 'That some requests were not recorded', why: 'Possible, and it is not what the average conceals here.'},
]}
explanation={<>Use p50 for the typical experience and p95/p99 for the tail — and use histograms rather than summaries, because percentiles computed per instance cannot be averaged across instances. The mean of three p99 values is not the p99.</>}
reference={{label: 'Metric types', href: '/knowledge-base/operations/monitoring#metric-types'}}
/>

<Quiz
question="Which of these are sound alerting practices?"
type="multiple"
options={[
{text: 'A `for` clause requiring the condition to hold for several minutes', correct: true, why: 'Eliminates single-scrape spikes, which cause most pages that turn out to be nothing.'},
{text: 'A runbook link in every alert annotation', correct: true, why: 'Being paged at 3 a.m. for an unfamiliar alert with no documentation is how people leave teams.'},
{text: 'Burn-rate alerts that page on fast error-budget consumption and ticket on slow', correct: true, why: 'Urgency proportional to impact, and far fewer false pages than fixed thresholds.'},
{text: 'Monthly review deleting alerts that fired but required no action', correct: true, why: 'An alert that is routinely ignored is worse than none, because it also masks the ones that matter.'},
{text: 'Paging for anything unusual so nothing is missed', why: 'This is how alert fatigue starts. Anything not urgent, actionable and user-visible belongs on a dashboard or in a ticket queue.'},
]}
explanation={<>Alert fatigue degrades silently — the team is still paged, still responding, and gradually less carefully. Track pages per shift as a metric in its own right.</>}
reference={{label: 'Alerting', href: '/knowledge-base/operations/monitoring#alerting'}}
/>

<Quiz
question="A deploy breaks the checkout button in the browser. Every endpoint returns 200, latency is normal, and no alert fires. What monitoring would have caught it?"
options={[
{
text: 'A business metric — orders per minute — and a synthetic check that exercises the full checkout journey',
correct: true,
why: 'Technical metrics describe the server\'s view. A front-end break produces perfectly healthy responses and zero completed purchases.',
},
{text: 'A lower latency threshold', why: 'Latency is normal; there is nothing slow about serving a broken page.'},
{text: 'More granular CPU and memory monitoring', why: 'Resource metrics have no visibility into user outcomes.'},
{text: 'Alerting on 4xx rates as well as 5xx', why: 'Worth having, and a button that never fires a request produces no status code at all.'},
]}
explanation={<>Base SLIs on user-visible outcomes wherever you can: "the user's order was created" is a far stronger indicator than "the API returned 200". Business metrics frequently detect problems minutes before any technical signal moves.</>}
reference={{label: 'What to actually monitor', href: '/knowledge-base/operations/monitoring#what-to-actually-monitor'}}
/>

---

## References

- [Google SRE Book: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)
  — the golden signals, in their original context.
- [Google SRE Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
  — burn-rate alerting, worked through.
- [Prometheus: Metric types](https://prometheus.io/docs/concepts/metric_types/)
  — counters, gauges, histograms and summaries.
- [Brendan Gregg: The USE Method](https://www.brendangregg.com/usemethod.html) —
  the infrastructure counterpart to golden signals.
- [Implementing SLOs](https://sre.google/workbook/implementing-slos/) — choosing
  indicators and objectives that mean something.
- [Observability](/knowledge-base/operations/observability) — answering the
  questions monitoring did not anticipate.
