---
title: 'Idempotency & State'
description: 'The properties that make code safe to retry, test and scale — idempotency, purity and side effects, immutability, and statelessness.'
---

# Idempotency & State

## Introduction

Four properties that are not features, and decide how much trouble a system
causes over its life:

| Property       | Means                                | Buys you                    |
| -------------- | ------------------------------------ | --------------------------- |
| **Idempotent** | Doing it twice equals doing it once  | Safe retries                |
| **Pure**       | Same input, same output, no effects  | Trivial testing and caching |
| **Immutable**  | Values are not modified in place     | No action at a distance     |
| **Stateless**  | No client data held between requests | Horizontal scaling          |

**They share a theme: making it safe for something to happen more than once, in
more than one place, in an order you did not plan.**

That is not a theoretical concern. Networks retry. Load balancers move requests
between instances. Queues redeliver. Users double-click. A system built without
these properties works perfectly until it meets any of that, and then fails in
ways that are extremely hard to reproduce.

---

## Idempotency

An operation is **idempotent** if performing it twice has the same effect as
performing it once.

**Why it matters concretely:** networks fail _after_ the server has processed a
request but _before_ the response arrives. The client cannot distinguish "never
arrived" from "succeeded but the reply was lost". **Every retry is therefore a
potential duplicate.**

HTTP defines `GET`, `PUT` and `DELETE` as idempotent; `POST` is not.

**The standard fix is an idempotency key:**

```http
POST /api/payments
Idempotency-Key: 9f2b1c4e-6b2a-4c0e-9a1a-2f5d3e7c1b88

{"amount": 2500, "currency": "GBP"}
```

The server stores the key with the result. A repeat with the same key returns
the stored result instead of charging the card twice.

```js
async function charge(key, payload) {
  const existing = await db.idempotencyKeys.find(key);
  if (existing) return existing.response;

  // Unique constraint on `key` — two concurrent requests cannot both proceed.
  await db.idempotencyKeys.insert({key, status: 'in_progress'});

  const result = await paymentProvider.charge(payload);
  await db.idempotencyKeys.update(key, {status: 'done', response: result});
  return result;
}
```

**The client must generate the key**, before the first attempt, and reuse it on
every retry. A server-generated key cannot help, because the whole problem is
that the client does not know whether the first attempt landed.

**A unique constraint is what actually enforces it.** Check-then-insert has a
race; the database does not. See
[Concurrency](/knowledge-base/general/concurrency#race-conditions-without-threads).

**Natural idempotency is better where you can get it.** `SET status = 'paid'` is
safe to repeat; `SET balance = balance + 100` is not. Prefer absolute
assignments to relative adjustments when the operation might be retried.

**Any operation with an external side effect needs this** — charging a card,
sending an email, provisioning a resource, publishing an event. Add the
idempotency key _before_ you add retries, or the retries make things worse. See
[Queues](/knowledge-base/operations/queues#delivery-semantics), where
at-least-once delivery makes this mandatory rather than optional.

---

## Purity and Side Effects

A **pure** function returns the same output for the same input and changes
nothing outside itself.

```js
// ❌ Impure — reads the clock, writes to a log, depends on module state.
function priceFor(item) {
  logger.info('pricing', item.id);
  return item.base * taxRate * (Date.now() > SALE_END ? 1 : 0.8);
}

// ✅ Pure — everything it needs is an argument.
function priceFor(item, {taxRate, isSale}) {
  return item.base * taxRate * (isSale ? 0.8 : 1);
}
```

Pure functions are trivially testable — no mocks, no setup, no clock control —
and they are cacheable, parallelisable and reorderable.

**Side effects are the point of the program.** Writing to a database, sending a
request, reading the clock, logging: without them the program does nothing. The
goal is not to eliminate them but to stop them being scattered everywhere.

**The useful pattern is a functional core and an imperative shell:** pure logic
in the middle, effects pushed to the edges where they are easy to see and easy
to fake in tests. A pricing rule, a validation, a state transition — all pure.
The reading and writing happens at the boundary.

**The test is a good proxy.** If testing a function requires mocking three
modules and freezing the clock, the effects are too deep. Pass the values in.

---

## Immutability

Mutating shared data creates action at a distance — a change here, a failure
somewhere unrelated.

```js
// ❌ sort() mutates in place — the caller's array is now reordered too.
function topThree(scores) {
  return scores.sort((a, b) => b - a).slice(0, 3);
}

// ✅ toSorted() returns a new array.
function topThree(scores) {
  return scores.toSorted((a, b) => b - a).slice(0, 3);
}
```

**`toSorted`, `toReversed`, `toSpliced` and `with`** are the non-mutating
counterparts to the classic array methods, and are available across current
runtimes. `Object.freeze` enforces shallow immutability where you want the
guarantee.

**Immutability underpins change detection.** React re-renders because object
identity changed — which is why mutating state in place appears to do nothing:

```js
// ❌ Same array reference — React sees no change.
setItems((prev) => {
  prev.push(item);
  return prev;
});

// ✅ New reference.
setItems((prev) => [...prev, item]);
```

**Watch shared defaults.** Default parameter objects, module-level constants and
class fields are shared between calls. Mutating one leaks state between requests
— a genuinely dangerous bug in a server, because one user's data can appear in
another's response.

**Structural sharing makes this cheap.** Copying the top level while reusing
unchanged sub-objects is what Immer and persistent data structures do, so
immutability rarely costs what people fear. Deep-cloning large objects on every
change does cost, and is usually unnecessary.

---

## Statelessness

A **stateless** service keeps no client-specific data between requests;
everything needed is in the request or in shared storage.

**This is what makes horizontal scaling possible.** Any instance can serve any
request, losing an instance loses nothing, and instances can be added, removed
or restarted freely.

**In-memory sessions are the classic violation:**

```js
// ❌ Works on one server. Breaks behind a load balancer.
const sessions = new Map();

// ✅ Shared storage — any instance can serve any request.
await redis.set(`session:${id}`, data, {EX: 3600});
```

They work perfectly in staging with one instance and fail in production with
four, where users are randomly logged out depending on which instance answers.
Put sessions in Redis or a signed cookie. See
[Sessions and Cookies](/knowledge-base/security/sessions-and-cookies).

**The same mistake in other clothes:**

- **In-memory caches** that differ per instance, so users see inconsistent data.
- **Uploaded files on local disk**, invisible to other instances and lost on
  redeploy. Use object storage — see
  [File Uploads](/knowledge-base/web/file-uploads).
- **Rate-limit counters in process memory**, giving an effective limit of N ×
  your instance count.
- **Scheduled jobs on every instance**, running three times. See
  [Background Workers](/knowledge-base/operations/background-workers#scheduled-jobs).
- **WebSocket state** assuming the same client reconnects to the same instance.

**Sticky sessions are a workaround, not a fix.** They reintroduce the problem
the moment an instance restarts, and they make deploys and autoscaling worse.

**Stateless does not mean there is no state** — it means the state lives
somewhere shared and durable rather than in one process's memory.

---

## Do's and Don'ts

### Do

- Make retryable operations idempotent before adding retries.
- Have the client generate idempotency keys, and reuse them across attempts.
- Enforce uniqueness with a database constraint, not a check-then-insert.
- Prefer absolute assignments to relative adjustments.
- Keep logic pure and push effects to the edges.
- Use `toSorted`, `toReversed` and spread rather than mutating in place.
- Store sessions, uploads and counters in shared storage.
- Assume any instance may serve any request.

### Don't

- Don't retry a non-idempotent call.
- Don't mutate arguments, shared defaults or module-level state.
- Don't keep per-user state in process memory in a multi-instance service.
- Don't write uploads to local disk.
- Don't rely on sticky sessions to make a stateful service work.
- Don't mutate React state in place and expect a re-render.
- Don't deep-clone large objects when structural sharing will do.
- Don't scatter side effects through business logic.

---

## Common Mistakes

**Retrying a non-idempotent call.** An automatic retry on a timed-out `POST`
sends the message twice. Add an idempotency key first.

**Server-generated idempotency keys.** Useless — the client cannot supply one it
never received.

**Check-then-insert for uniqueness.** Two concurrent requests both find nothing
and both insert. Use a unique constraint.

**Mutating a shared default.** Default parameter objects and module-level
constants persist between calls; mutation leaks state between requests.

**`sort()` on a caller's array.** The caller's data is silently reordered.

**In-memory sessions behind a load balancer.** Works in staging, random logouts
in production.

**Uploads on local disk.** Invisible to other instances, gone on redeploy.

**Rate limiting per process.** Four instances means four times the intended
limit.

**Mutating React state.** No identity change, no re-render, and it looks like a
framework bug.

---

## Debugging

| Symptom                                   | Likely cause                              |
| ----------------------------------------- | ----------------------------------------- |
| Duplicate charges or emails               | Non-idempotent operation being retried    |
| Random logouts in production only         | In-memory sessions across instances       |
| Uploaded file 404s sometimes              | Local disk storage with several instances |
| Rate limit allows more than configured    | Counters in process memory                |
| A UI component does not re-render         | State mutated in place                    |
| Data appears in the wrong user's response | Mutated shared module-level state         |
| Scheduled job runs several times          | Cron on every instance without a lock     |
| Test passes alone, fails in a suite       | Shared mutable state between tests        |

**"Works on one instance" is the diagnostic.** If a bug disappears when you
scale to one replica, it is a statelessness problem — and that check takes
seconds.

**"Fails only under retry or double-click"** points at idempotency. Reproduce by
sending the same request twice deliberately.

---

## FAQ

**Is `GET` guaranteed idempotent?**
By specification, yes, and only if you implement it that way. A `GET` that
increments a counter violates the contract, and caches and prefetchers will
surprise you.

**Where should idempotency keys be stored?**
In your database, with a unique constraint and a TTL — 24 hours is typical.
Storing them only in a cache risks losing them exactly when a retry arrives.

**Does immutability hurt performance?**
Rarely. Structural sharing means copying the top level and reusing the rest.
Deep-cloning large objects on every change does cost, and is usually
unnecessary.

**Can a service be completely stateless?**
The service, yes. The system needs state somewhere — a database, a cache, object
storage. The point is that it is shared, not that it is absent.

**Are sticky sessions ever acceptable?**
As a short-term measure while migrating to shared storage. Long-term they make
deploys, autoscaling and instance failure worse.

**How do I make an event consumer idempotent?**
A unique constraint on the event ID, checked before processing. See
[Queues](/knowledge-base/operations/queues#delivery-semantics).

---

## Check your understanding

<Quiz
question="A payment endpoint occasionally charges customers twice. Logs show the client retried after a timeout, and the original request had in fact succeeded. What is the correct fix?"
options={[
{
text: 'Accept an Idempotency-Key header, store the result against it, and return the stored result for repeats',
correct: true,
why: 'The network cannot tell you whether a lost response means the work happened. An idempotency key lets the server recognise a duplicate and replay the original outcome.',
},
{
text: 'Increase the client timeout so retries do not happen',
why: 'It reduces the frequency but does not remove the race — a slow response or a dropped connection still produces a duplicate.',
},
{
text: 'Change the endpoint from POST to PUT, since PUT is idempotent',
why: 'The HTTP method is a contract, not an implementation. Calling it PUT does not make a charge idempotent on its own.',
},
{
text: 'Wrap the charge in a database transaction',
why: 'A transaction makes one request atomic. It says nothing about two separate requests arriving with the same intent.',
},
]}
explanation={<>Any operation with an external side effect — charging a card, sending an email, provisioning a resource — needs an idempotency key before it needs retries. The client must generate it before the first attempt and reuse it, since the whole problem is that the client cannot tell whether that attempt landed.</>}
reference={{label: 'Idempotency', href: '/knowledge-base/general/idempotency-and-state#idempotency'}}
/>

<Quiz
question="A service stores user sessions in a module-level Map. It works in staging (one instance) and fails in production (four instances behind a load balancer), where users are randomly logged out. What principle is being violated?"
options={[
{
text: 'Statelessness — per-client state in process memory cannot be seen by other instances',
correct: true,
why: 'Any instance must be able to serve any request. In-memory session state means only one of the four instances recognises the user.',
},
{
text: 'Idempotency — the login request is not safe to retry',
why: 'Idempotency concerns duplicate effects from retries. Here the request is handled correctly, just by an instance that has never seen the session.',
},
{
text: 'Immutability — the Map is being mutated concurrently',
why: 'Mutation is not the issue; the Map in each process is internally consistent. The problem is that there are four of them.',
},
{
text: 'Loose coupling — the session store is coupled to the web layer',
why: 'A real design smell, and the fix does decouple them, but the failure is caused specifically by state living in process memory.',
},
]}
explanation={<>Move the session to shared storage — Redis or a signed cookie — and the service becomes horizontally scalable. Sticky sessions are a workaround that reintroduces the problem the moment an instance restarts.</>}
reference={{label: 'Statelessness', href: '/knowledge-base/general/idempotency-and-state#statelessness'}}
/>

<Quiz
question="What is wrong with this function, from the caller's point of view?"
options={[
{
text: 'sort() mutates in place, so the caller\'s array is silently reordered as a side effect of asking for the top three',
correct: true,
why: 'The caller passed a value and got their own data modified. Any later code relying on the original order now breaks, far from the cause.',
},
{text: 'slice(0, 3) creates an unnecessary copy', width: false, why: 'slice returns a new array without touching the original — that part is correct.'},
{text: 'The comparator is backwards for descending order', why: '(a, b) => b - a is correct for descending.'},
{text: 'It fails when the array has fewer than three elements', why: 'slice handles short arrays gracefully, returning what exists.'},
]}
explanation={<>Use <code>toSorted</code>, and prefer <code>toReversed</code>, <code>toSpliced</code> and <code>with</code> over their mutating equivalents. This is also why mutating React state appears to do nothing — the reference is unchanged, so nothing detects a change.</>}
reference={{label: 'Immutability', href: '/knowledge-base/general/idempotency-and-state#immutability'}}>

```js
function topThree(scores) {
  return scores.sort((a, b) => b - a).slice(0, 3);
}
```

</Quiz>

<Quiz
question="Which of these violate statelessness in a multi-instance service?"
type="multiple"
options={[
{text: 'Uploaded files written to the local filesystem', correct: true, why: 'Other instances cannot see them, and a redeploy or a replaced container loses them. Use object storage.'},
{text: 'Rate-limit counters held in process memory', correct: true, why: 'Each instance counts separately, so the effective limit becomes N times what was configured.'},
{text: 'An in-memory cache serving user-specific data', correct: true, why: 'Instances diverge, so the same user sees different data depending on which one answers.'},
{text: 'A scheduled job started by every instance without a lock', correct: true, why: 'The job runs once per instance — three nightly reports instead of one.'},
{text: 'A signed cookie carrying the session identity', why: 'The state travels with the request rather than living in one process, so any instance can serve it. This is the fix, not the problem.'},
]}
explanation={<>Stateless does not mean stateless <em>systems</em> — it means the state lives somewhere shared and durable rather than in one process. The quickest diagnostic: if a bug disappears when you scale to a single replica, it is this.</>}
reference={{label: 'Statelessness', href: '/knowledge-base/general/idempotency-and-state#statelessness'}}
/>

<Quiz
question="Two concurrent signup requests for the same email both succeed, creating duplicate accounts, despite code that checks whether the email exists before inserting. Why, and what is the reliable fix?"
options={[
{
text: 'Check-then-insert has a race — both requests find nothing before either writes. A unique constraint on the column is enforced by the database regardless of concurrency',
correct: true,
why: 'The gap between the read and the write is a window in which another request can do the same thing. Only the database can close it atomically.',
},
{text: 'The application should retry the check after the insert', width: false, why: 'That detects the duplicate after creating it, leaving cleanup to do.'},
{text: 'The requests should be serialised through a queue', width: false, why: 'It works and imposes a large architectural cost to solve what a constraint solves in one line.'},
{text: 'The email should be normalised before checking', why: 'Normalisation is genuinely important and orthogonal — identical normalised values still race.'},
]}
explanation={<>The same reasoning applies to idempotency keys: a unique constraint on the key means two concurrent retries cannot both proceed. Let the database enforce uniqueness and handle the constraint violation as an expected outcome.</>}
reference={{label: 'Idempotency', href: '/knowledge-base/general/idempotency-and-state#idempotency'}}
/>

---

## References

- [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
  — a reference implementation of idempotency keys.
- [RFC 9110: HTTP Semantics — idempotent methods](https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods)
  — what the specification actually requires.
- [The Twelve-Factor App: Processes](https://12factor.net/processes) — the
  statelessness argument, stated originally.
- [MDN: `Array.prototype.toSorted()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted)
  — the non-mutating array methods.
- [Gary Bernhardt: Boundaries](https://www.destroyallsoftware.com/talks/boundaries)
  — the functional core, imperative shell pattern.
- [Queues](/knowledge-base/operations/queues) — where at-least-once delivery
  makes idempotency mandatory.
