---
title: 'Webhooks'
description: 'Receiving and sending server-to-server event notifications reliably — signature verification, idempotency, retries, ordering and testing.'
---

# Webhooks

## Introduction

A webhook is an HTTP request one server sends to another when something
happens. Instead of you asking "has the payment settled yet?" every ten seconds,
the payment provider tells you the moment it does.

**The problem it solves.** Polling is wasteful and slow: you make thousands of
requests that return nothing, and you still learn about the event up to a full
interval late. A webhook is a single request at the moment of the event.

**The trade.** Polling is simple and entirely under your control. A webhook
inverts the relationship — you now operate a public endpoint that a third party
calls, at a time you do not choose, with a payload you must authenticate, that
may arrive twice, out of order, or not at all.

Almost everything on this page follows from those four facts.

:::warning A webhook endpoint is a public, unauthenticated URL
Anyone who discovers it can post to it. **Signature verification is not
optional** — without it, anyone can tell your system that an invoice was paid.
:::

---

## Receiving Webhooks

### Verify the signature

The single most important thing on this page. Providers sign the payload with a
shared secret; you recompute the signature and compare.

```ts
import {createHmac, timingSafeEqual} from 'node:crypto';

export async function POST(request: Request) {
  // Read the RAW body. Parsing first destroys the exact bytes that were signed.
  const raw = await request.text();
  const signature = request.headers.get('x-webhook-signature') ?? '';
  const timestamp = request.headers.get('x-webhook-timestamp') ?? '';

  // Reject old requests so a captured payload cannot be replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || age > 300) {
    return new Response('Stale timestamp', {status: 400});
  }

  const expected = createHmac('sha256', process.env.WEBHOOK_SECRET!)
    .update(`${timestamp}.${raw}`) // sign the timestamp too, or it can be swapped
    .digest('hex');

  // Constant-time comparison — a plain === leaks information through timing.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response('Invalid signature', {status: 401});
  }

  const event = JSON.parse(raw);
  // …
}
```

Three details, each of which is a real vulnerability when omitted:

1. **Sign and read the raw body.** JSON parsing and re-serialising changes
   whitespace and key order, so the recomputed signature will not match. This
   produces a "signature always invalid" bug that looks like a configuration
   problem. Most frameworks parse the body for you — you usually have to opt out
   for this one route.
2. **Include the timestamp in the signed payload and reject old ones.** Without
   it, an attacker who captures one valid request can replay it indefinitely.
3. **Compare in constant time.** A byte-by-byte `===` returns faster on an early
   mismatch, which is enough to recover a signature given enough attempts.

Use the provider's own SDK where one exists — `stripe.webhooks.constructEvent`
and its equivalents get all three right.

### Respond immediately, process asynchronously

Providers impose short timeouts, often 5–10 seconds, and treat a slow response
as a failure — which triggers a retry, and you process the same event twice.

```ts
export async function POST(request: Request) {
  const event = await verifyAndParse(request);

  // Persist and acknowledge. Do the work elsewhere.
  await db.webhookEvent.create({data: {id: event.id, type: event.type, payload: event}});
  await queue.enqueue('process-webhook', {eventId: event.id});

  return new Response(null, {status: 200}); // fast, always
}
```

**Never do the real work inline.** Charging a card, sending email, calling
another API — all of it belongs in a queue. The endpoint's only jobs are:
verify, persist, acknowledge. See
[Queues](/knowledge-base/operations/queues).

### Be idempotent

Providers guarantee **at-least-once** delivery. Duplicates happen when your
response is slow, when the network drops the acknowledgement, or when the
provider's own retry logic fires. Assume every event may arrive more than once.

```ts
const seen = await db.webhookEvent.findUnique({where: {id: event.id}});
if (seen) return new Response(null, {status: 200}); // already handled; still 200

await db.webhookEvent.create({data: {id: event.id, ...}});
```

Deduplicate on the **provider's event id**, not on a hash of the payload — two
genuinely distinct events can carry identical payloads.

Use a unique constraint on the event id so the database enforces it. A
check-then-insert race under concurrent delivery will otherwise let both
through; see
[Data Modelling](/knowledge-base/databases/data-modelling#isolation-levels).

### Do not trust the payload

Even a correctly signed webhook only proves the message came from the provider —
not that the data in it is current. For anything consequential, **fetch the
resource from the provider's API** using the id in the event:

```ts
// The event says the payment succeeded. Confirm it independently.
const payment = await stripe.paymentIntents.retrieve(event.data.object.id);
if (payment.status !== 'succeeded') return;
```

This also protects against acting on a stale event that arrived out of order.

### Return the right status

- **`2xx`** — received. Send it as soon as you have persisted the event.
- **`4xx`** — do not retry; something is permanently wrong with this request.
  Most providers stop retrying and may disable the endpoint.
- **`5xx`** or a timeout — retry, please.

**Return 200 for an event you do not recognise.** A `400` on an unknown event
type tells the provider your endpoint is broken; you simply do not handle that
type yet.

---

## Sending Webhooks

If you are the provider, you owe consumers the same guarantees.

### Payload and headers

```http
POST /webhooks/acme HTTP/1.1
Content-Type: application/json
X-Acme-Event-Id: evt_01J9XQ7F3K
X-Acme-Event-Type: order.paid
X-Acme-Timestamp: 1785312000
X-Acme-Signature: sha256=a1b2c3…
User-Agent: Acme-Webhooks/1.0

{
  "id": "evt_01J9XQ7F3K",
  "type": "order.paid",
  "created_at": "2026-08-03T10:00:00Z",
  "data": {"order_id": "ord_1024", "total_pence": 2500}
}
```

- **A unique event id**, so consumers can deduplicate.
- **A type**, namespaced as `resource.action`.
- **A timestamp**, included in the signature.
- **Thin or fat?** A _thin_ payload carries only ids and requires a callback; a
  _fat_ one carries the data. Thin is safer — it avoids leaking data to a
  misconfigured endpoint and cannot go stale — but doubles the request count.
  Many providers send fat payloads and document that consumers should re-fetch
  anything consequential.

### Retries with exponential backoff

```text
attempt 1: immediately
attempt 2: +10s
attempt 3: +1m
attempt 4: +10m
attempt 5: +1h
attempt 6: +6h
then: disable the endpoint and email the owner
```

Add **jitter** so a consumer coming back online is not hit by every queued
retry simultaneously — a thundering herd that knocks them over again.

Give consumers a **dashboard**: recent deliveries, response codes, payloads, and
a manual replay button. It removes most support tickets.

### Ordering is not guaranteed

Retries and parallel delivery mean `order.paid` can arrive before
`order.created`. Do not build a system that depends on ordering.

Two mitigations. As a **sender**, include a sequence number or a version so
consumers can detect out-of-order events. As a **consumer**, make handlers
order-independent — check current state rather than assuming a prior event
arrived, and ignore an event older than the state you already hold.

### Security obligations as a sender

- **Sign every payload**, and document the algorithm precisely.
- **Support secret rotation** — send two signatures during an overlap window.
- **Publish your source IP ranges** so consumers can allowlist them.
- **Prevent SSRF.** A consumer-supplied URL is an outbound request from your
  infrastructure. Resolve the hostname and reject private ranges — `127.0.0.1`,
  `10.0.0.0/8`, `169.254.169.254` (the cloud metadata endpoint) — and re-check
  after redirects, or your webhook sender becomes a proxy into your own network.
- **Timeout aggressively** (5–10 s) and cap response size.
- **HTTPS only.**

---

## Testing

Webhooks are awkward to test because the caller is somebody else's server.

```bash
# Expose localhost to the internet
ngrok http 3000
cloudflared tunnel --url http://localhost:3000

# Provider CLIs are better: forward real events, and trigger synthetic ones
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger payment_intent.succeeded
```

In an automated test, skip the network entirely — construct a signed request and
call the handler:

```ts
it('marks the order paid, and is idempotent', async () => {
  const body = JSON.stringify({id: 'evt_1', type: 'order.paid', data: {orderId: 'ord_1'}});
  const headers = signedHeaders(body); // same HMAC the provider would produce

  await handler(new Request(url, {method: 'POST', body, headers}));
  await handler(new Request(url, {method: 'POST', body, headers})); // replay

  expect(await db.order.findUnique({where: {id: 'ord_1'}})).toMatchObject({status: 'paid'});
  expect(await db.webhookEvent.count()).toBe(1); // deduplicated
});
```

**Test the replay explicitly.** Idempotency is the thing most likely to be
broken and least likely to be noticed until it charges someone twice. Also test
an invalid signature, a stale timestamp and an unknown event type.

---

## Webhooks or Something Else?

| Need                                         | Use                                                           |
| -------------------------------------------- | ------------------------------------------------------------- |
| Server-to-server event notification          | **Webhooks**                                                  |
| Server → browser updates                     | [Server-Sent Events](/knowledge-base/apis/server-sent-events) |
| Bidirectional, low latency                   | [WebSockets](/knowledge-base/apis/websockets)                 |
| High-volume internal event streaming         | [Kafka](/knowledge-base/kafka) or a message queue             |
| Occasional check, simple, no public endpoint | Polling — genuinely fine at low frequency                     |

Polling is underrated. If you need to know within five minutes and the volume is
small, a scheduled job is simpler than operating a signed public endpoint.

---

## Do's and Don'ts

### Do

- Verify the signature against the **raw** body, in constant time.
- Reject requests with a stale or missing timestamp.
- Persist the event and return 2xx within a second; process asynchronously.
- Deduplicate on the provider's event id, with a unique constraint.
- Re-fetch consequential data from the provider's API.
- Return 200 for unknown event types.
- Test replays, bad signatures and stale timestamps.
- As a sender: retry with backoff and jitter, and offer a delivery dashboard.

### Don't

- Don't parse the body before verifying the signature.
- Don't compare signatures with `===`.
- Don't do slow work inline in the handler.
- Don't assume events arrive once, or in order.
- Don't trust payload contents for anything consequential.
- Don't return 4xx for an event type you have not implemented.
- Don't log full payloads — they routinely contain personal data.
- Don't send to a consumer-supplied URL without SSRF protection.

---

## Debugging

| Symptom                            | Cause and fix                                                           |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Signature always invalid           | The body was parsed before verification. Read the raw text.             |
| Works locally, fails in production | A proxy or WAF modifying the body, or a different secret.               |
| Events processed twice             | No deduplication, or a check-then-insert race. Add a unique constraint. |
| Provider reports timeouts          | Work being done inline. Enqueue and return immediately.                 |
| Endpoint disabled by the provider  | Repeated non-2xx responses. Check their delivery log.                   |
| Events arrive out of order         | Expected. Make handlers order-independent.                              |
| Some events never arrive           | Check the provider's delivery log first — often a 4xx you returned.     |
| Duplicate charges                  | Idempotency missing on the downstream action, not just the endpoint.    |

Always start with the **provider's delivery log**. It shows what they sent, what
you returned and when they retried — which usually answers the question before
you look at your own logs.

---

## FAQ

**What if my endpoint is down?**
The provider retries with backoff, typically over hours or days. Persisting the
event on arrival means a later processing failure does not lose it. Most
providers also allow manual replay.

**Should I use a queue?**
Yes, for anything beyond a trivial state change. It decouples acknowledgement
from processing, which is what keeps you inside the provider's timeout.

**How do I handle a burst of thousands of events?**
The endpoint should be cheap enough to absorb it — verify, insert, enqueue. The
queue provides the buffer, and workers scale independently.

**Can I use one endpoint for all providers?**
Better not to. Each has its own signature scheme and payload shape; one route
per provider keeps verification explicit and unambiguous.

**How do I secure the endpoint beyond signatures?**
IP allowlisting where the provider publishes ranges, an unguessable path
segment, and rate limiting. All are secondary to the signature.

**What about ordering guarantees?**
Assume none. If order genuinely matters, use a sequence number and buffer, or
re-fetch current state instead of applying a diff.

---

## Check your understanding

<Quiz
question="A Stripe webhook handler rejects every event with 'invalid signature', though the secret is correct and it works in the Stripe CLI. What is the most likely cause?"
options={[
{
text: 'The framework parsed the JSON body before verification, so the recomputed signature is over re-serialised bytes rather than the original ones',
correct: true,
why: 'Signatures cover the exact bytes sent. Parsing and re-serialising changes whitespace and key order. Read the raw text and disable automatic body parsing for that route.',
},
{text: 'The webhook secret needs to be URL-encoded', why: 'It is used as an HMAC key as-is; encoding it would break verification everywhere, including the CLI.'},
{text: 'The endpoint must be registered with a specific content type', why: 'Content type does not alter the bytes used for signing.'},
{text: 'Signature verification requires the Node runtime rather than Edge', why: 'Both provide Web Crypto or equivalent HMAC. The problem is which bytes are hashed.'},
]}
explanation={<>Two related requirements: include the timestamp in the signed payload and reject stale ones to prevent replay, and compare with a constant-time function rather than <code>===</code>.</>}
reference={{label: 'Verify the signature', href: '/knowledge-base/apis/webhooks#verify-the-signature'}}
/>

<Quiz
question="A webhook handler charges a card, sends an email, then returns 200. It takes 8 seconds. What goes wrong?"
options={[
{
text: 'The provider times out, treats the delivery as failed and retries — so the card is charged again',
correct: true,
why: 'Providers typically time out at 5–10 seconds. A timeout is a failed delivery to them, even though the work completed. Persist, enqueue, return 200, and process asynchronously.',
},
{text: 'Nothing, as long as it eventually returns 200', why: 'The 200 arrives after the provider has already given up and scheduled a retry.'},
{text: 'The signature expires during processing', why: 'Verification happens at the start; processing time does not invalidate it.'},
{text: 'The provider will send the next event only after this one completes', why: 'Deliveries are generally concurrent, not serialised per endpoint.'},
]}
explanation={<>Two fixes together: keep the endpoint fast (verify, persist, enqueue, acknowledge) <em>and</em> make the downstream action idempotent, because at-least-once delivery means duplicates are inevitable regardless.</>}
reference={{label: 'Respond immediately, process asynchronously', href: '/knowledge-base/apis/webhooks#respond-immediately-process-asynchronously'}}
/>

<Quiz
question="Which of these are required for a robust webhook consumer?"
type="multiple"
options={[
{text: 'Constant-time signature comparison', correct: true, why: 'A byte-by-byte === returns early on mismatch, leaking enough timing information to recover a valid signature.'},
{text: 'Rejecting requests whose signed timestamp is old', correct: true, why: 'Without it, a captured valid request can be replayed indefinitely.'},
{text: 'Deduplicating on the provider’s event id, enforced by a unique constraint', correct: true, why: 'Delivery is at-least-once, and a check-then-insert race under concurrent delivery lets duplicates through without a constraint.'},
{text: 'Returning 200 for event types you do not handle', correct: true, why: 'A 4xx signals a permanently broken endpoint and can get you disabled. You simply do not implement that type yet.'},
{text: 'Returning 500 whenever validation of the payload contents fails', why: 'A 5xx asks for a retry, and a payload your code rejects will fail identically every time. Acknowledge it and record the problem.'},
]}
explanation={<>The four correct answers map to the four properties of the channel: it is public, replayable, at-least-once, and evolving.</>}
reference={{label: 'Receiving webhooks', href: '/knowledge-base/apis/webhooks#receiving-webhooks'}}
/>

<Quiz
question="You are building a webhook sender that posts to URLs customers configure. What is the most serious security risk?"
options={[
{
text: 'SSRF — a customer can point the URL at an internal address such as the cloud metadata endpoint and use your infrastructure as a proxy',
correct: true,
why: 'The request originates inside your network. 169.254.169.254 can expose instance credentials; private ranges expose internal services. Resolve and validate the host, and re-check after redirects.',
},
{text: 'Customers might receive events they did not subscribe to', why: 'A real bug, but a scoping error rather than a way into your infrastructure.'},
{text: 'The payload might be too large for their server', why: 'An interoperability concern, not a security one.'},
{text: 'Retries could overwhelm the customer’s endpoint', why: 'Genuine — mitigated with backoff and jitter — but it affects them, not your network boundary.'},
]}
explanation={<>Validate the resolved IP rather than the hostname string: DNS can resolve a public-looking name to a private address, and a redirect can change the target after validation.</>}
reference={{label: 'Security obligations as a sender', href: '/knowledge-base/apis/webhooks#security-obligations-as-a-sender'}}
/>

<Quiz
question="An order-processing system applies events as they arrive. Occasionally `order.shipped` is processed before `order.paid`, leaving inconsistent state. What is the right fix?"
options={[
{
text: 'Make handlers order-independent — check current state or re-fetch the resource rather than assuming a prior event was applied',
correct: true,
why: 'Retries and parallel delivery mean ordering is never guaranteed. A handler that reconciles against current state is correct regardless of arrival order.',
},
{text: 'Ask the provider to guarantee ordered delivery', why: 'Almost none do, and a single retry breaks ordering even where a best effort is made.'},
{text: 'Process webhooks in a single-threaded worker', why: 'Serialises your processing but does nothing about the order they arrive in.'},
{text: 'Reject events that arrive out of order with a 4xx', why: 'A 4xx tells the provider to stop retrying, so you permanently lose the event.'},
]}
explanation={<>A sequence number or version in the payload lets you detect and discard stale events. Re-fetching the resource from the provider's API achieves the same thing and also guards against acting on outdated data.</>}
reference={{label: 'Ordering is not guaranteed', href: '/knowledge-base/apis/webhooks#ordering-is-not-guaranteed'}}
/>

---

## References

- [Stripe: Webhooks](https://docs.stripe.com/webhooks) — the reference
  implementation most providers imitate, including signature verification and
  the best-practices guide.
- [GitHub: Securing your webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
  — HMAC validation with constant-time comparison.
- [Standard Webhooks](https://www.standardwebhooks.com/) — an emerging
  cross-provider specification for payload and signature format.
- [OWASP: Server-Side Request Forgery Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
  — essential if you send to customer-supplied URLs.
- [OpenAPI webhooks](https://spec.openapis.org/oas/latest.html#fixed-fields-0) —
  describing the events you send. See
  [OpenAPI](/knowledge-base/apis/openapi).
