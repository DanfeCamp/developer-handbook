---
title: 'Logging'
description: 'Recording what happened in a form you can search — structure, levels, correlation IDs, redaction, retention and cost.'
---

# Logging

## Introduction

Logs are the record of what your system did. During an incident they are usually
the first thing you reach for, and usually the thing that disappoints you.

**The difference between logs that help and logs that do not is structure.**

```js
// ❌ Prose. Human-readable, machine-hostile.
console.log(`User ${userId} failed login from ${ip} at ${new Date()}`);

// ✅ An event with fields. Queryable.
logger.warn({event: 'login_failed', userId, ip, reason: 'bad_password'});
```

The first can only be grepped. The second answers "how many failed logins came
from this IP in the last hour, and for how many distinct users" — the question
you actually have at 3 a.m.

**Three principles, and everything else follows:**

1. **Log events, not sentences.** A log line is a structured record with fields.
2. **Make them correlatable.** Every line from one request carries the same
   request ID.
3. **Never log secrets or personal data.** Logs are copied, shipped to third
   parties and retained far longer than you think.

**Logs are one of three signals**, alongside metrics and traces. Logs tell you
what happened in detail; metrics tell you how often and how fast; traces tell you
where the time went. See [Observability](/knowledge-base/operations/observability).

---

## Structured Logging

Emit JSON in production, and let your logger pretty-print in development.

```js
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password'],
  formatters: {level: (label) => ({level: label})},
});

logger.info(
  {event: 'order_created', orderId, userId, amountPence: 4999},
  'order created',
);
```

```json
{
  "level": "info",
  "time": 1754236800000,
  "event": "order_created",
  "orderId": "ord_9f2",
  "userId": "usr_31a",
  "amountPence": 4999,
  "msg": "order created"
}
```

**Field conventions that pay off:**

| Field                   | Why                                                       |
| ----------------------- | --------------------------------------------------------- |
| `event`                 | A stable machine name; the message text can change freely |
| `traceId` / `requestId` | Ties every line of one request together                   |
| `userId`, `tenantId`    | Scope a query to one customer                             |
| `durationMs`            | Numeric, so you can aggregate it                          |
| `err`                   | The serialised error, with stack                          |

**Keep field names and types stable.** A field that is a string in one place and
a number in another breaks the index in most log platforms, and the queries you
write on it silently return partial results.

**Use the logger's serialisers for errors.** `JSON.stringify(err)` produces `{}`
— `message` and `stack` are non-enumerable. Every mature logging library has an
error serialiser; use it, or you will lose every stack trace.

**Libraries:** `pino` (Node, fast), `winston` (Node, flexible), `structlog`
(Python), Monolog (PHP), `zerolog`/`slog` (Go), Logback with an encoder (JVM).

---

## Levels

Use them consistently or they mean nothing.

| Level   | For                                         | Example                               |
| ------- | ------------------------------------------- | ------------------------------------- |
| `fatal` | The process cannot continue                 | Cannot bind the port                  |
| `error` | An operation failed and someone should look | Payment provider returned 500         |
| `warn`  | Unexpected but handled                      | Retried a request; fell back to cache |
| `info`  | Notable business events                     | Order created, user registered        |
| `debug` | Detail for diagnosis                        | Query parameters, branch taken        |
| `trace` | Very fine-grained                           | Loop iterations, raw payloads         |

**The rule that keeps `error` meaningful: `error` means a human should look.**
If nobody investigates it, it is a `warn`. A log level that fires constantly and
is always ignored has trained everyone to ignore the real ones.

**A caught and handled exception is not an error.** A retry that succeeded is a
`warn` at most, often `info`. Logging at `error` for every transient network
blip is why alerting on error rate stops working.

**Make the level runtime-configurable**, via `LOG_LEVEL`. Being able to raise
verbosity on one instance during an incident, without a deploy, is worth
arranging in advance.

**Default to `info` in production.** `debug` in production is expensive, noisy
and — because debug logs are written casually — the most common route to
accidentally logging a secret.

---

## Correlation

A single request touching four services produces log lines in four places. Without
a shared identifier they cannot be reassembled.

**Generate a request ID at the edge, propagate it everywhere.** The standard is
W3C Trace Context — the `traceparent` header — which is what OpenTelemetry uses,
so adopting it now means tracing works later with no changes.

```js
import {AsyncLocalStorage} from 'node:async_hooks';

const context = new AsyncLocalStorage();

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  context.run({requestId}, next);
});

// Every log call picks it up automatically
const log = (obj, msg) => logger.info({...obj, ...context.getStore()}, msg);
```

**`AsyncLocalStorage` is what makes this bearable** — the alternative is
threading a context object through every function signature in the codebase.
Python has `contextvars`, Go has `context.Context`, Java has MDC.

**Return the request ID to the client** in a response header. When a user
reports a problem and quotes that ID, you find their exact request in seconds.

**Propagate it on every outbound call**, including to third parties that echo it
back.

---

## What Never to Log

Logs are shipped to vendors, retained for months, and readable by anyone with
dashboard access.

**Never log:**

- Passwords, even hashed or "just for debugging".
- Session tokens, API keys, JWTs, refresh tokens.
- Full card numbers, CVVs, bank details.
- Health data, government identifiers.
- Entire request bodies on authentication endpoints.
- `Authorization` and `Cookie` headers.

**Redact at the logger, not the call site.** Call-site discipline fails the
moment someone adds a quick `logger.debug(req.body)`. Configure a redaction list
in the logger itself so it applies everywhere:

```js
redact: {
  paths: ['req.headers.authorization', 'req.headers.cookie',
          '*.password', '*.token', '*.creditCard'],
  censor: '[REDACTED]',
}
```

**Personal data is a retention question, not just a redaction one.** Under GDPR,
logs containing personal data are personal data: they need a retention period, a
lawful basis, and the ability to delete on request. **Log identifiers, not
people** — `userId: "usr_31a"` rather than an email address — and the problem
largely disappears.

**If a secret is logged, treat it as leaked.** Rotate it. Deleting the log line
does not undo the copies already shipped to your aggregator, your backups and
your vendor.

See [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

---

## Where Logs Go

**Write to stdout.** The application should not manage files, rotation or
shipping — that is the platform's job. This is the twelve-factor rule and it is
correct: systemd captures stdout into the journal, Docker into its logging
driver, Kubernetes to the node.

```js
// ✅ the process writes to stdout; the platform routes it
logger.info({event: 'started', port});
```

**Then aggregate centrally.** Logs on individual machines are useless the moment
you have more than one, and gone when a container is replaced.

| Option                         | Notes                                                 |
| ------------------------------ | ----------------------------------------------------- |
| **Grafana Loki**               | Indexes labels not content; cheap; pairs with Grafana |
| **Elasticsearch / OpenSearch** | Full-text search; powerful; operationally heavy       |
| **Datadog / New Relic**        | Fully managed; excellent; expensive at volume         |
| **CloudWatch Logs**            | Native on AWS; set retention or it never expires      |
| **Better Stack, Axiom**        | Managed, reasonably priced for smaller volumes        |

**Loki's model is worth understanding** because it inverts the usual trade: it
indexes only a small set of labels and stores the rest compressed. Queries
narrow by label first, then grep. Much cheaper than a full-text index — and it
means **high-cardinality values must be log fields, not labels**. A label per
user ID will destroy it.

---

## Cost and Volume

Logging is often the largest observability line item, and it grows silently.

- **Set a retention period.** 7–14 days hot for debugging, longer in cheap cold
  storage if you need it for compliance. CloudWatch defaults to _never expire_.
- **Sample high-volume, low-value logs.** Keep every error; keep 1% of
  successful health checks.
- **Do not log successful health checks at all.** They are the single largest
  source of useless volume in most systems.
- **Watch cardinality**, especially in Loki and metrics-adjacent systems.
- **Prefer metrics for counting.** "How many requests?" is a counter, not a
  million log lines. Logs are for detail about specific events.

**The test for any log line: what question does it answer?** If you cannot name
one, delete it. Most systems have far too many logs and far too little
structure — the fix is fewer, better lines.

---

## Testing and Auditing

**Assert on logs where they are the contract.** Security-relevant events —
authentication failures, permission denials, administrative actions — should
have tests confirming they are recorded, because that is what an audit will ask
for.

**Audit logs are a different thing from application logs.** They record who did
what to which resource, they must be tamper-evident, and they usually need
longer retention. Keep them in a separate, append-only store rather than mixed
into debug output.

**Log the security events that matter:** login success and failure, logout,
password and email changes, permission changes, privilege escalation, data
export, and administrative actions. Include actor, target, source IP and
outcome.

---

## Do's and Don'ts

### Do

- Emit JSON in production, pretty prose in development.
- Give every event a stable `event` name.
- Propagate a request or trace ID through everything.
- Return the request ID to the client.
- Configure redaction in the logger.
- Log identifiers rather than personal data.
- Write to stdout and let the platform ship it.
- Set retention periods explicitly.
- Use the logger's error serialiser.
- Make the log level configurable at runtime.

### Don't

- Don't log secrets, tokens or full request bodies on auth endpoints.
- Don't use `error` for handled conditions.
- Don't `console.log` in production code.
- Don't interpolate values into the message when they could be fields.
- Don't log successful health checks.
- Don't use high-cardinality values as labels.
- Don't manage log files from inside the application.
- Don't count things with logs when a metric would do.
- Don't `JSON.stringify` an Error and expect a stack trace.

---

## Common Mistakes

**Prose instead of fields.** Grep is not a query language. Nothing aggregates.

**No correlation ID.** Reconstructing one request across services becomes
guesswork with timestamps.

**Logging a secret while debugging.** Then it is in your aggregator, your
backups and your vendor's storage. Rotate it.

**Everything at `error`.** Alerting on error rate becomes useless, and real
errors are invisible in the noise.

**`console.log` scattered through the code.** No levels, no structure, no
redaction, and unshippable.

**Empty error objects.** `JSON.stringify(err)` gives `{}`. Use the serialiser.

**No retention policy.** Years of debug logs at storage rates, and a compliance
problem you did not intend to create.

**High-cardinality labels.** A label per user ID makes Loki or Elasticsearch
unusable.

**Logging inside a tight loop.** Sometimes slower than the work itself, and it
buries everything else.

---

## Debugging

| Symptom                        | Cause                                                 |
| ------------------------------ | ----------------------------------------------------- |
| Logs missing in production     | Level set too high; or written to a file nobody ships |
| Empty error objects            | Missing error serialiser                              |
| Cannot follow a request        | No correlation ID propagated                          |
| Queries return partial results | Inconsistent field types across services              |
| Aggregator bill spiking        | Debug level in production, or health-check noise      |
| Logs stop under load           | Synchronous logging blocking the event loop           |
| Timestamps disagree            | Mixed local time; log UTC everywhere                  |
| Log line truncated             | Platform line-length limit; keep payloads small       |

**Check the level first.** The overwhelming majority of "the logs are missing"
reports are `LOG_LEVEL` set higher than the line being looked for.

**Synchronous logging is a real performance problem.** Writing to a slow
destination on the request path adds latency directly. Use an async transport,
and be aware of the trade: buffered lines can be lost if the process dies.

---

## FAQ

**Which library?**
`pino` for Node — it is fast and structured by default. `structlog` for Python,
Monolog for PHP, `slog` for Go. Any of them beats `console.log`.

**How long should I keep logs?**
7–14 days hot covers most debugging. Compliance requirements dictate the rest,
and cheap cold storage handles it.

**Should I log every request?**
An access log per request is standard and useful. Keep it to one line with
method, path, status, duration and IDs — not the body.

**Logs or metrics?**
Metrics for "how many, how fast" — cheap and aggregatable. Logs for "what
happened in this specific case". Using logs to count is expensive and slow.

**What about the front end?**
Send errors to a service like Sentry rather than logging to the console. Include
the request ID from the server response so front-end and back-end records join
up.

**Is it safe to log a user ID?**
Generally yes — an opaque internal identifier is not directly personal data.
Email addresses, names and IP addresses are, and need a retention policy.

---

## Check your understanding

<Quiz
question="A team logs `User failed login from 203.0.113.9` as a formatted string. What can they not do?"
options={[
{
text: 'Aggregate — they cannot count failed logins per IP, per user or over time without parsing the message text',
correct: true,
why: 'Prose is only greppable. Structured fields turn the same event into something a log platform can group, count and alert on.',
},
{text: 'Read the logs during an incident', why: 'They are readable — the problem is that reading is all you can do.'},
{text: 'Redact sensitive values', why: 'Redaction is configurable either way, though it is easier with named fields.'},
{text: 'Ship the logs to an aggregator', why: 'Shipping works; querying usefully is what fails.'},
]}
explanation={<>Log events with fields — <code>{'{event: \'login_failed\', userId, ip, reason}'}</code> — and give each event a stable <code>event</code> name so the human-readable message can change without breaking queries and alerts.</>}
reference={{label: 'Structured logging', href: '/knowledge-base/operations/logging#structured-logging'}}
/>

<Quiz
question="A Node service logs errors with `logger.error({err: JSON.stringify(error)})`. Every entry shows an empty object. Why?"
options={[
{
text: 'Error message and stack are non-enumerable properties, so JSON.stringify serialises them to {}',
correct: true,
why: 'This is a property of the Error type, not a logger bug. Every stack trace is silently lost.',
},
{text: 'The logger strips error objects for security reasons', why: 'No logger does this by default.'},
{text: 'The error is undefined at the point it is logged', why: 'Then the field would be absent rather than an empty object.'},
{text: 'JSON logs cannot contain nested objects', why: 'They can, and nested fields are normal.'},
]}
explanation={<>Pass the error object directly and let the logger's error serialiser handle it — pino, winston, structlog and Monolog all have one. This single mistake costs teams every stack trace they thought they were recording.</>}
reference={{label: 'Structured logging', href: '/knowledge-base/operations/logging#structured-logging'}}
/>

<Quiz
question="Which values should never appear in application logs?"
type="multiple"
options={[
{text: 'Authorization and Cookie headers', correct: true, why: 'They contain session tokens and API keys — anyone with dashboard access can then impersonate the user.'},
{text: 'Full request bodies on authentication endpoints', correct: true, why: 'That is a plaintext password in your log aggregator, your backups and your vendor\'s storage.'},
{text: 'Passwords, even hashed "just for debugging"', correct: true, why: 'A hash in logs is still a credential artefact, and debug logging is where it invariably happens.'},
{text: 'JWTs and refresh tokens', correct: true, why: 'A logged token is a usable token until it expires — and refresh tokens are long-lived.'},
{text: 'Opaque internal user identifiers such as usr_31a', why: 'These are what you should log instead of emails or names — they scope a query to a customer without recording personal data.'},
]}
explanation={<>Configure the redaction list in the logger rather than relying on call-site discipline, which fails the moment someone adds a quick <code>logger.debug(req.body)</code>. If a secret does get logged, rotate it — deleting the line does not recall the copies already shipped.</>}
reference={{label: 'What never to log', href: '/knowledge-base/operations/logging#what-never-to-log'}}
/>

<Quiz
question="A microservice architecture logs to a central aggregator, but reconstructing a single user request across four services is guesswork. What is missing?"
options={[
{
text: 'A correlation ID generated at the edge and propagated through every service and every log line',
correct: true,
why: 'Without a shared identifier the only join key is a timestamp, which is ambiguous under any real concurrency.',
},
{text: 'Synchronised clocks across the services', why: 'Helpful, and still insufficient — concurrent requests produce interleaved lines at the same instant.'},
{text: 'A higher log level in each service', why: 'More volume without a join key makes reconstruction harder, not easier.'},
{text: 'A single shared log file', why: 'Centralisation is already in place; the records still cannot be linked.'},
]}
explanation={<>Use the W3C Trace Context <code>traceparent</code> header, which is what OpenTelemetry propagates — adopting it now means distributed tracing works later with no changes. Store it in <code>AsyncLocalStorage</code> (or <code>contextvars</code>, or MDC) so every log call picks it up without threading a parameter through every function.</>}
reference={{label: 'Correlation', href: '/knowledge-base/operations/logging#correlation'}}
/>

<Quiz
question="A team's log bill has tripled. Which change is most likely to reduce it without losing diagnostic value?"
options={[
{
text: 'Stop logging successful health checks, set an explicit retention period, and move high-volume counting to metrics',
correct: true,
why: 'Health checks are the single largest source of useless volume, retention defaults are often unlimited, and counting via log lines is far more expensive than a counter.',
},
{text: 'Reduce the log level to warn across all services', why: 'It cuts volume and removes the info-level business events you need during incidents. A blunt instrument.'},
{text: 'Switch to plain text instead of JSON to reduce line size', why: 'A small size saving that costs you every query, which is the reason the logs exist.'},
{text: 'Log to local files instead of stdout', why: 'It hides the cost rather than removing it, and loses the logs when a container is replaced.'},
]}
explanation={<>The general test for any log line is: <em>what question does it answer?</em> If you cannot name one, delete it. Most systems have far too many lines and far too little structure.</>}
reference={{label: 'Cost and volume', href: '/knowledge-base/operations/logging#cost-and-volume'}}
/>

---

## References

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
  — what to log, and what never to.
- [OpenTelemetry: Logs](https://opentelemetry.io/docs/concepts/signals/logs/) —
  how logs relate to traces and metrics.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) — the `traceparent`
  propagation standard.
- [pino documentation](https://getpino.io/) — redaction, serialisers and
  transports.
- [Grafana Loki: labels](https://grafana.com/docs/loki/latest/get-started/labels/)
  — why cardinality matters.
- [The Twelve-Factor App: Logs](https://12factor.net/logs) — the stdout
  argument.
