---
title: 'Background Workers'
description: 'Running and supervising work outside the request cycle — concurrency, graceful shutdown, scheduling, locking, deploys and monitoring.'
---

# Background Workers

## Introduction

Workers are the processes that consume [queues](/knowledge-base/operations/queues)
and run scheduled jobs. This page is about operating them, rather than about
designing the messages they consume.

**Workers fail differently from web servers, and that is the whole difficulty.**
A broken endpoint produces an error a user reports within minutes. A broken
worker produces silence: the queue grows, jobs quietly stop, and nobody finds out
until a customer asks where their invoice went.

**Four properties a production worker needs:**

1. **Supervision** — it restarts when it crashes and starts on boot.
2. **Graceful shutdown** — deploys do not kill jobs mid-flight.
3. **Appropriate concurrency** — enough throughput without exhausting resources.
4. **Visibility** — you know it is alive and keeping up.

Most background-work incidents trace to one of these being absent, not to the job
logic being wrong.

---

## Running Workers

**A worker is a separate long-running process**, not a thread inside your web
server. Sharing a process means a slow job blocks requests, and scaling one
forces you to scale the other.

```js
// worker.js
import {Worker} from 'bullmq';

const worker = new Worker(
  'emails',
  async (job) => {
    await sendEmail(job.data);
  },
  {connection, concurrency: 5},
);
```

**Supervise it with systemd** (or your platform's equivalent):

```ini
# /etc/systemd/system/worker@.service — a template, so you can run several
[Unit]
Description=Queue worker %i
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/srv/myapp
ExecStart=/usr/bin/node worker.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now worker@1 worker@2 worker@3
```

**`TimeoutStopSec` is the directive that matters here.** It gives in-flight jobs
time to finish before systemd sends `SIGKILL`. Set it above your longest job, or
deploys will kill work mid-execution. On Kubernetes, the equivalent is
`terminationGracePeriodSeconds`.

**Separate workers per queue class.** One pool for fast, high-volume jobs
(emails, webhooks) and another for slow ones (video encoding, reports). Otherwise
a single ten-minute job blocks a thousand one-second jobs behind it — the
head-of-line blocking problem, and the most common cause of "why did my email
take an hour?"

See [VPS: systemd](/knowledge-base/hosting/vps#process-supervision-with-systemd).

---

## Graceful Shutdown

Every deploy stops workers. Without graceful shutdown, whatever they were doing
is lost or half-done.

```js
let shuttingDown = false;

process.on('SIGTERM', async () => {
  shuttingDown = true;
  console.log('SIGTERM received, finishing in-flight jobs');
  await worker.close(); // stop taking new jobs, wait for current ones
  await db.end();
  process.exit(0);
});
```

**The sequence:**

1. **Stop accepting new jobs** immediately.
2. **Finish what is in flight**, up to a timeout.
3. **Close connections** cleanly.
4. **Exit 0.**

**Most job runners implement this**, and you have to call it — BullMQ's
`worker.close()`, Sidekiq's built-in handling, Celery's warm shutdown.

**Long jobs need checkpointing.** A four-hour job cannot finish during a
thirty-second shutdown window. Either split it into resumable chunks, or record
progress so a restart continues rather than starting over.

**Test it.** Send `SIGTERM` to a worker processing a job and confirm the job
completes. This takes two minutes and is almost never done, which is why "jobs
disappear during deploys" is such a common report.

---

## Concurrency

**Concurrency within a worker** — how many jobs one process handles at once.
**Worker count** — how many processes.

| Workload                              | Approach                            |
| ------------------------------------- | ----------------------------------- |
| **I/O-bound** (HTTP, database, email) | High concurrency in fewer processes |
| **CPU-bound** (image, video, PDF)     | Concurrency 1, one process per core |
| **Mixed**                             | Separate queues and separate pools  |

**In Node, CPU-bound work with high concurrency is actively harmful** — the event
loop is single-threaded, so ten concurrent image resizes do not run in parallel;
they interleave and all finish late. Set concurrency to 1 and run more processes,
or move the work to a worker thread.

**Concurrency multiplies resource use.** Ten workers at concurrency 10 is a
hundred simultaneous jobs, and therefore up to a hundred database connections.
**Check your connection pool before raising concurrency** — exhausting the
database pool is the usual first casualty, and it takes the web application down
with it.

**Prefetch** is how many messages a consumer reserves in advance. Too high and
one worker hoards messages while others idle; too low and you pay a round trip
per job. A small multiple of concurrency is a reasonable default.

**Scale on the oldest message age**, not on CPU. That is the metric that reflects
whether users are waiting.

---

## Scheduled Jobs

Recurring work — nightly reports, cleanup, syncing.

| Approach                                                                 | Notes                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **System cron**                                                          | Simple; no visibility; awkward with multiple servers       |
| **systemd timers**                                                       | Logs to the journal; `Persistent=true` catches missed runs |
| **In-app scheduler** (BullMQ repeatable, Celery beat, Laravel scheduler) | Same monitoring as other jobs; usually best                |
| **Platform scheduler** (EventBridge, Cloud Scheduler)                    | Managed; triggers your endpoint or job                     |

**Prefer scheduling into the queue** rather than running work directly in cron.
The scheduled trigger enqueues a job; the worker runs it. You get retries,
monitoring, concurrency control and DLQs — everything the queue already provides.

**The multi-server problem:** cron on three servers runs the job three times. Use
a leader lock, an in-app scheduler with a shared backend, or a platform
scheduler.

```js
// Distributed lock — only one instance proceeds
const lock = await redis.set('cron:daily-report', hostname, {NX: true, EX: 3600});
if (!lock) return;
```

**Set the lock TTL above the job's maximum duration**, or a second instance
starts while the first is still running. And **use a lock even when you have one
server today** — the day you add a second is not the day you want to discover
this.

**Monitor that scheduled jobs actually ran.** A cron job that silently stops is
invisible by design. Dead-man's-switch monitoring — Healthchecks.io, Cronitor, or
a metric with an alert on staleness — is how you find out. This is one of the
highest-value alerts you can add, because the failure is otherwise completely
silent.

---

## Deploys

Workers need different handling from web servers during a deploy.

**The order that avoids most problems:**

1. Run migrations (backward compatible — see
   [CI/CD](/knowledge-base/hosting/ci-cd#database-migrations)).
2. Deploy and restart workers.
3. Deploy web servers.

**Old workers must tolerate new messages, and new workers old ones.** During any
rolling deploy both versions run. Adding a required field to a message payload
breaks every old worker still consuming — the same expand–contract discipline
migrations need applies to message schemas.

**Pause queues for risky deploys** rather than draining them, if your broker
supports it. Messages accumulate safely and processing resumes afterwards.

**Watch queue depth during and after a deploy.** A worker that fails to start
after deployment is silent, and depth is the signal that shows it.

---

## Monitoring

**Worker liveness is the first thing to check and the easiest to forget.**

```js
// Heartbeat: a metric that goes stale if the worker dies
setInterval(() => workerHeartbeat.set(Date.now() / 1000), 10_000);
```

```promql
# Alert: no heartbeat in five minutes
time() - worker_heartbeat_timestamp_seconds > 300
```

Track:

- **Heartbeat / liveness** per worker.
- **Oldest message age** — the most actionable queue signal.
- **Job duration**, as a histogram, per job type.
- **Failure rate and DLQ depth.**
- **Concurrency utilisation** — are workers saturated or idle?
- **Scheduled job last-run time**, with an alert on staleness.

**Log with the job ID and trace context.** A job is a unit of work like a request
and deserves the same correlation. Propagate the trace context from the producer
so the job's spans join the request that created it — see
[OpenTelemetry: context propagation](/knowledge-base/operations/opentelemetry#context-propagation).

---

## Do's and Don'ts

### Do

- Run workers as separate supervised processes.
- Handle `SIGTERM` and finish in-flight jobs.
- Set `TimeoutStopSec` above your longest job.
- Separate fast and slow work into different queues and pools.
- Match concurrency to the workload type.
- Check the connection pool before raising concurrency.
- Schedule into the queue rather than running work in cron.
- Use a distributed lock for scheduled jobs, even with one server.
- Alert on scheduled jobs that stop running.
- Track worker heartbeats and oldest message age.
- Propagate trace context from producer to worker.

### Don't

- Don't run workers inside the web server process.
- Don't use `SIGKILL` for routine restarts.
- Don't mix ten-minute jobs with one-second jobs in one queue.
- Don't set high concurrency for CPU-bound work in Node.
- Don't raise concurrency without checking database connections.
- Don't run cron on every server without a lock.
- Don't add required message fields without a compatibility window.
- Don't assume a worker is running because it was yesterday.

---

## Common Mistakes

**No graceful shutdown.** Every deploy kills jobs mid-execution. With
at-least-once delivery they are redelivered — with side effects already half
applied.

**Head-of-line blocking.** One slow job type starves everything sharing the
queue.

**Concurrency exhausting the database pool.** Workers take every connection and
the web application starts failing. The symptom appears in the wrong place
entirely.

**CPU-bound work at high concurrency in Node.** Everything interleaves, nothing
parallelises, and every job finishes late.

**Cron running on every instance.** Three servers, three duplicate nightly
reports, three sets of emails.

**Silently stopped scheduled jobs.** Nobody notices for weeks, because success
and non-execution look identical.

**Breaking message compatibility.** A new required field, and every old worker
fails until the rollout completes.

**No worker liveness monitoring.** The queue grows for hours before anyone
notices.

**Long jobs without checkpointing.** Killed at shutdown, restarted from the
beginning, killed again at the next deploy.

---

## Debugging

| Symptom                            | Where to look                                                 |
| ---------------------------------- | ------------------------------------------------------------- |
| Queue growing, workers idle        | Consumer crashed or lost its connection                       |
| Jobs lost during deploys           | No graceful shutdown, or `TimeoutStopSec` too short           |
| Fast jobs delayed                  | Slow jobs in the same queue — separate the pools              |
| Database connection errors         | Concurrency × worker count exceeds the pool                   |
| Scheduled job ran three times      | Cron on multiple servers with no lock                         |
| Scheduled job never ran            | Timer disabled, or the lock is stuck — check its TTL          |
| Worker restarts constantly         | Check `journalctl -u worker@1`; likely OOM or a startup error |
| Job succeeded but nothing happened | Wrong queue, or an exception swallowed by a bare catch        |

**`journalctl -u worker@1 -f` first.** Workers fail at startup for ordinary
reasons — a missing environment variable, an unreachable broker — and the logs
say so immediately.

---

## FAQ

**How many workers?**
Enough that the oldest message age stays low at peak. Start with two or three
and scale on that metric.

**Same machine as the web app?**
Fine at small scale, and separate them once workers can starve the web
application of CPU or memory. Separate processes regardless.

**How do I run one-off scripts?**
Through the same queue with a manual trigger, so you get logging, retries and
timeouts. An ad-hoc SSH script has none of those and no record it ran.

**What about serverless workers?**
Lambda triggered by SQS works well for bursty, short jobs. Watch cold starts,
the 15-minute limit, and database connection exhaustion under concurrency —
see [AWS](/knowledge-base/hosting/aws#compute).

**How do I test workers?**
Test the handler as a plain function. Add integration tests with a real broker
in a container for delivery, retry and shutdown behaviour.

**Should workers have health endpoints?**
They have no HTTP server by default. Either add a minimal one for a liveness
probe, or use a heartbeat metric — the latter is simpler and usually enough.

---

## Check your understanding

<Quiz
question="Every deploy causes some background jobs to fail or be re-run with side effects half-applied. What is missing?"
options={[
{
text: 'Graceful shutdown — the worker should stop accepting new jobs on SIGTERM, finish in-flight ones, and only then exit',
correct: true,
why: 'Without it the process is killed mid-job. Under at-least-once delivery the job is redelivered, but its side effects were already partly applied.',
},
{text: 'A larger dead-letter queue', why: 'A DLQ catches jobs that fail repeatedly; these jobs were interrupted rather than failing.'},
{text: 'More worker replicas', why: 'More workers means more jobs killed per deploy, not fewer.'},
{text: 'Longer retry backoff', why: 'Backoff changes retry timing, not what happens when a process is killed.'},
]}
explanation={<>Handle <code>SIGTERM</code>, call your runner's close method, and set <code>TimeoutStopSec</code> (or <code>terminationGracePeriodSeconds</code>) above your longest job. Then test it: send SIGTERM to a worker mid-job and confirm the job completes. It takes two minutes and is almost never done.</>}
reference={{label: 'Graceful shutdown', href: '/knowledge-base/operations/background-workers#graceful-shutdown'}}
/>

<Quiz
question="A Node worker processes image resizing with concurrency set to 20. Throughput is poor and every job finishes late. Why?"
options={[
{
text: 'Image resizing is CPU-bound and Node is single-threaded, so twenty concurrent jobs interleave on one event loop rather than running in parallel',
correct: true,
why: 'Concurrency helps only when jobs spend time waiting. CPU-bound work has nothing to wait on, so high concurrency just makes everything finish late together.',
},
{text: 'The queue prefetch is too low', why: 'Prefetch affects fetching overhead, not whether CPU work parallelises.'},
{text: 'Redis cannot deliver messages fast enough at that concurrency', why: 'Message delivery is not the bottleneck for image processing.'},
{text: 'Concurrency above 10 is not supported by most job runners', why: 'Far higher values are supported and appropriate for I/O-bound work.'},
]}
explanation={<>Set concurrency to 1 for CPU-bound work and run one process per core, or move the work to a worker thread. Keep high concurrency for I/O-bound jobs — HTTP calls, database queries, sending email — where the process is mostly waiting.</>}
reference={{label: 'Concurrency', href: '/knowledge-base/operations/background-workers#concurrency'}}
/>

<Quiz
question="A nightly report is scheduled with system cron on three application servers. Customers receive three copies. What is the fix?"
options={[
{
text: 'A distributed lock so only one instance proceeds, or an in-app or platform scheduler with a shared backend',
correct: true,
why: 'Cron runs independently on every machine and has no knowledge of the others. Something shared has to arbitrate which instance runs the job.',
},
{text: 'Stagger the cron times so the runs do not overlap', why: 'The job then runs three times at three different moments, which is the same problem spread out.'},
{text: 'Run the job on only one server and document which', why: 'It works until that server is replaced, rebuilt or scaled — a convention nobody will remember.'},
{text: 'Make the report generation idempotent', why: 'Sound practice generally, and it does not stop three emails from being sent.'},
]}
explanation={<>Set the lock TTL above the job's maximum duration, or a second instance starts while the first is still running. Use a lock even when you have one server today — the day you add a second is not the day to discover this.</>}
reference={{label: 'Scheduled jobs', href: '/knowledge-base/operations/background-workers#scheduled-jobs'}}
/>

<Quiz
question="Which are correct practices for operating workers in production?"
type="multiple"
options={[
{text: 'Separate queues and worker pools for fast and slow job types', correct: true, why: 'Otherwise one ten-minute job blocks a thousand one-second jobs behind it — head-of-line blocking.'},
{text: 'Checking the database connection pool before raising concurrency', correct: true, why: 'Ten workers at concurrency 10 is a hundred simultaneous jobs and up to a hundred connections. Exhausting the pool takes the web application down too.'},
{text: 'A heartbeat metric with an alert on staleness', correct: true, why: 'Workers die silently. A queue with zero live consumers looks healthy until you check.'},
{text: 'Alerting when a scheduled job has not run recently', correct: true, why: 'Non-execution and success look identical from the outside, so a stopped cron job is invisible without an explicit staleness alert.'},
{text: 'Running workers as threads inside the web server for simpler deployment', why: 'A slow job then blocks requests, and you cannot scale workers independently of web capacity.'},
]}
explanation={<>Background work fails silently by nature — the failures that hurt are the ones nobody is watching for. Liveness and staleness alerts are the ones that pay for themselves.</>}
reference={{label: 'Monitoring', href: '/knowledge-base/operations/background-workers#monitoring'}}
/>

<Quiz
question="During a rolling deploy, a new version adds a required field to a job payload. Old workers begin failing. What principle was violated?"
options={[
{
text: 'Message schemas need the same expand–contract discipline as database migrations — both versions run simultaneously during a rolling deploy',
correct: true,
why: 'Old workers consume messages produced by new code and vice versa. A newly required field is a breaking change for whichever side has not been updated.',
},
{text: 'Workers should have been deployed after the web servers', why: 'Deploying workers first is the usual order, and it does not make an incompatible payload compatible.'},
{text: 'The queue should have been drained before deploying', why: 'Draining helps with in-flight messages and does nothing about producers still emitting the new shape.'},
{text: 'Message payloads should never change', why: 'They change constantly — the requirement is a compatibility window, not immutability.'},
]}
explanation={<>Add the field as optional, deploy everywhere, then start requiring it in a later release. The same reasoning that makes column renames unsafe mid-deploy applies to every contract shared between two running versions.</>}
reference={{label: 'Deploys', href: '/knowledge-base/operations/background-workers#deploys'}}
/>

---

## References

- [BullMQ: workers and graceful shutdown](https://docs.bullmq.io/guide/workers)
  — concurrency, closing and events.
- [Celery: workers guide](https://docs.celeryq.dev/en/stable/userguide/workers.html)
  — concurrency, prefetch and warm shutdown.
- [Laravel: queues and workers](https://laravel.com/docs/queues) — supervision,
  timeouts and scheduled jobs.
- [systemd.service: KillSignal and TimeoutStopSec](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
  — the shutdown contract.
- [Sidekiq best practices](https://github.com/sidekiq/sidekiq/wiki/Best-Practices)
  — small payloads, idempotency and concurrency.
- [Queues](/knowledge-base/operations/queues) — the message design these workers
  consume.
