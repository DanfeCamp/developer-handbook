---
title: 'REST APIs'
description: 'Designing HTTP APIs around resources — methods, status codes, idempotency, errors, versioning, caching and security.'
---

# REST APIs

## Introduction

REST models an API as a set of **resources** manipulated through standard HTTP
methods and status codes. A resource is a noun — an order, a user, a collection
of products — and the method is the verb.

**The problem it solves.** Before it, every API invented its own vocabulary:
`getUserById`, `fetchUser`, `user_lookup`, each with its own error format and
its own idea of what a failure looks like. REST says: use the protocol you
already have. HTTP already has verbs, status codes, caching, content
negotiation and conditional requests. Use them, and every client, proxy, CDN and
debugging tool understands your API without being told.

**A useful clarification.** Roy Fielding's REST requires HATEOAS — responses
containing links describing what you can do next — and almost no API does this.
What the industry calls REST is really **resource-oriented HTTP**, and that is
fine. Nobody will object; what matters is that the conventions you _do_ adopt
are applied consistently, because an API's worst property is being
unpredictable.

**Where something else fits better.** [GraphQL](/knowledge-base/apis/graphql)
when many different clients need different shapes of the same graph. gRPC for
low-latency service-to-service calls with strict contracts.
[WebSockets](/knowledge-base/apis/websockets) or
[SSE](/knowledge-base/apis/server-sent-events) when the server needs to push.

---

## Resources and URIs

```text
GET    /orders              list orders
POST   /orders              create an order
GET    /orders/1024         fetch one
PATCH  /orders/1024         partially update
DELETE /orders/1024         delete
GET    /orders/1024/items   a sub-collection
```

Conventions that make an API predictable:

- **Plural nouns for collections.** `/orders`, not `/order` or `/getOrders`.
- **No verbs in paths.** The HTTP method is the verb. `POST /orders` creates;
  `/createOrder` is redundant.
- **Lowercase, hyphenated.** `/purchase-orders`, not `/purchaseOrders` or
  `/purchase_orders`.
- **Nest only one level.** `/orders/1024/items` is fine;
  `/users/7/orders/1024/items/3` is not — use `/order-items/3`.
- **Identifiers in the path, filters in the query string.**
  `/orders?status=pending&sort=-placed_at`.

### Actions that are not CRUD

Some operations genuinely are not "update this field": cancelling an order,
publishing a post, sending a password reset. Two workable approaches:

```http
POST /orders/1024/cancel          ← a sub-resource as an action. Pragmatic and clear
PATCH /orders/1024 {"status": "cancelled"}   ← a state transition
```

The first is honest about the fact that cancelling has side effects — sending
email, refunding a payment — that a field assignment does not convey. Purists
dislike it; it is widely used and easily understood.

---

## Methods

| Method    | Safe | Idempotent | Body | Use                                   |
| --------- | ---- | ---------- | ---- | ------------------------------------- |
| `GET`     | ✅   | ✅         | No   | Retrieve. **Must never change state** |
| `HEAD`    | ✅   | ✅         | No   | Headers only                          |
| `POST`    | ❌   | ❌         | Yes  | Create; anything non-idempotent       |
| `PUT`     | ❌   | ✅         | Yes  | Replace the whole resource            |
| `PATCH`   | ❌   | ❌*        | Yes  | Partial update                        |
| `DELETE`  | ❌   | ✅         | No   | Remove                                |
| `OPTIONS` | ✅   | ✅         | No   | Capabilities; CORS preflight          |

**Safe** means no state change. **Idempotent** means performing it twice has the
same effect as once.

These are not academic labels. Browsers, proxies and CDNs act on them: a `GET`
may be cached, prefetched or retried automatically. **A `GET` that deletes
something will eventually be triggered by a crawler.**

`PUT` replaces; `PATCH` merges. `PUT /orders/1024` with a partial body should
null the omitted fields — which is why most APIs use `PATCH` for updates.

*`PATCH` is idempotent if the patch is absolute (`{"status": "paid"}`) and not
if it is relative (`{"increment_quantity": 1}`).

### Idempotency for POST

Networks fail after the server has processed a request but before the response
arrives, so **every retry is a potential duplicate**. `POST` is not idempotent,
so anything creating a charge, a message or a resource needs an idempotency key:

```http
POST /payments HTTP/1.1
Idempotency-Key: 9f2b1c4e-6b2a-4c0e-9a1a-2f5d3e7c1b88
Content-Type: application/json

{"amount_pence": 2500, "currency": "GBP"}
```

The server stores the key with the result and returns the stored result for a
repeat, rather than charging twice. See
[Idempotency](/knowledge-base/general/idempotency-and-state#idempotency).

---

## Status Codes

Use the specific one. A `200` with `{"error": "..."}` in the body defeats every
piece of tooling that understands HTTP.

### Success

| Code               | Meaning                                              |
| ------------------ | ---------------------------------------------------- |
| **200** OK         | Success with a body                                  |
| **201** Created    | Resource created — include a `Location` header       |
| **202** Accepted   | Accepted for async processing; not done yet          |
| **204** No Content | Success, deliberately no body (typical for `DELETE`) |

### Client errors

| Code                      | Meaning                                           | Commonly confused with |
| ------------------------- | ------------------------------------------------- | ---------------------- |
| **400** Bad Request       | Malformed syntax — unparseable JSON               | 422                    |
| **401** Unauthorized      | **Not authenticated.** Who are you?               | 403                    |
| **403** Forbidden         | Authenticated, but not permitted                  | 401                    |
| **404** Not Found         | No such resource — or you may not know it exists  | 403                    |
| **409** Conflict          | State conflict: duplicate, version mismatch       | 400                    |
| **410** Gone              | Deliberately removed, permanently                 | 404                    |
| **422** Unprocessable     | Valid syntax, invalid content — failed validation | 400                    |
| **429** Too Many Requests | Rate limited. Include `Retry-After`               | 503                    |

**401 versus 403** is the most-confused pair. 401 means _unauthenticated_ — the
name is a historical error. 403 means _authenticated but not allowed_.

**403 versus 404** is a deliberate choice. Returning 404 for a resource the user
may not access avoids confirming it exists, which prevents enumeration. Many
security guidelines prefer it.

**400 versus 422.** 400 for "this is not valid JSON"; 422 for "this is valid
JSON but `quantity` must be positive". The distinction is useful to clients.

### Server errors

| Code                          | Meaning                                           |
| ----------------------------- | ------------------------------------------------- |
| **500** Internal Server Error | Unexpected failure. Never leak details            |
| **502** Bad Gateway           | An upstream returned something invalid            |
| **503** Service Unavailable   | Temporarily down or overloaded. Add `Retry-After` |
| **504** Gateway Timeout       | An upstream did not respond in time               |

**Only return 5xx when it is your fault.** A validation failure is a 4xx; if
your 5xx rate includes client mistakes, your alerting is useless.

---

## Errors

Return a consistent, machine-readable shape. **RFC 9457 Problem Details** is the
standard, and adopting it means you do not have to invent one:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request contained 2 invalid fields.",
  "instance": "/orders",
  "errors": [
    {"field": "quantity", "code": "min", "message": "Must be at least 1"},
    {"field": "product_id", "code": "not_found", "message": "No such product"}
  ]
}
```

Rules:

- **A stable machine-readable code** (`type`, or a `code` field) that clients can
  branch on. Clients must never parse `message` — it will be reworded or
  translated.
- **Field-level detail** for validation failures, so a form can highlight the
  right input.
- **Never leak internals.** Stack traces, SQL fragments and file paths tell an
  attacker about your stack. Log them with a correlation id and return the id.

```json
{"type": "about:blank", "title": "Internal Server Error", "status": 500,
 "request_id": "01J9XQ7F3K"}
```

---

## Collections

### Filtering and sorting

```text
GET /orders?status=pending&customer_id=7
GET /orders?placed_after=2026-01-01&placed_before=2026-02-01
GET /orders?sort=-placed_at,total       # minus prefix = descending
GET /orders?fields=id,status,total      # sparse fieldset
```

Whatever syntax you choose, apply it everywhere. Two endpoints with different
sort conventions is worse than either convention.

### Pagination

Always paginate a collection. An endpoint returning "all orders" works in
development and takes the site down when a customer has 400,000.

**Cursor pagination** is the right default — stable under concurrent inserts,
and it does not degrade with depth:

```json
{
  "data": [...],
  "page": {
    "next_cursor": "eyJpZCI6MTAyNH0",
    "has_more": true
  }
}
```

Offset pagination (`?page=3&per_page=20`) is easier and has two real problems:
items shift between pages when rows are inserted, and `OFFSET 100000` makes the
database count and discard 100,000 rows. See
[Pagination](/knowledge-base/apis/pagination).

### Responses

Wrap collections in an object rather than returning a bare array — it leaves
room for pagination metadata, and a top-level JSON array has historically been
an attack surface:

```json
{"data": [...], "page": {...}}
```

Be consistent about single resources too: if a collection is `{"data": [...]}`,
a single resource should be `{"data": {...}}`, not a bare object.

---

## Versioning

Every public API needs a plan for breaking changes.

| Strategy     | Example                               | Notes                                                  |
| ------------ | ------------------------------------- | ------------------------------------------------------ |
| **URI path** | `/v1/orders`                          | Ugly, obvious, and by far the most common              |
| **Header**   | `Accept: application/vnd.api.v2+json` | Purer; harder to test in a browser or curl             |
| **Query**    | `/orders?version=2`                   | Easy to forget; caches treat it as a distinct resource |
| **Date**     | `API-Version: 2026-08-03`             | Stripe's model; excellent, and real work to run        |

**Use the URI path** unless you have a reason not to. It is visible in logs, in
a browser and in a bug report.

**What is a breaking change?** Removing or renaming a field, changing a type,
adding a required request field, changing a status code, tightening validation.

**What is not?** Adding an optional request field, adding a response field
(provided clients ignore unknown fields — say so in your documentation), adding
a new endpoint.

Most changes can be additive. Version when you genuinely must, deprecate loudly
with `Deprecation` and `Sunset` headers, and give consumers months.

---

## Caching

The most underused part of HTTP, and the cheapest performance available.

```http
Cache-Control: public, max-age=300, stale-while-revalidate=600
ETag: "a1b2c3d4"
Last-Modified: Sun, 03 Aug 2026 10:00:00 GMT
```

A client with an `ETag` can revalidate cheaply:

```http
GET /orders/1024
If-None-Match: "a1b2c3d4"

HTTP/1.1 304 Not Modified          ← no body; bandwidth saved
```

- **`private`** for anything user-specific, so shared caches and CDNs do not
  store it. Getting this wrong serves one user's data to another — a genuine
  incident, not a theoretical one.
- **`no-store`** for anything sensitive.
- **`stale-while-revalidate`** serves the cached copy instantly while refreshing
  behind it.

`ETag` also enables **optimistic concurrency**, which solves lost updates:

```http
PATCH /orders/1024
If-Match: "a1b2c3d4"

HTTP/1.1 412 Precondition Failed   ← someone else changed it first
```

---

## Security

- **HTTPS only.** Redirect HTTP, and send HSTS.
- **Authenticate every endpoint** unless it is deliberately public. See
  [Authentication](/knowledge-base/security/authentication).
- **Authorise per object, not per route.** "Is this user logged in?" and "may
  they read order 1024?" are different questions, and only the second prevents
  a user reading another's data by changing an id. This is the top entry in the
  OWASP API Security Top 10.
- **Validate every input** against a schema — body, query and path. Type
  annotations prove nothing at runtime.
- **Rate limit**, and return `429` with `Retry-After` and
  `RateLimit-*` headers.
- **Never put secrets or tokens in the URL.** URLs land in logs, browser
  history, referrer headers and analytics. Use the `Authorization` header.
- **Cap request body size**, or an unbounded parser is a denial-of-service
  vector.
- **CORS with an explicit origin allowlist** — never a reflected origin with
  credentials. See [CORS](/knowledge-base/security/cors).
- **Do not expose sequential ids** if the count is commercially sensitive; a
  UUIDv7 avoids leaking how many orders you take.

---

## Documentation

An undocumented API does not exist. Generate an
[OpenAPI](/knowledge-base/apis/openapi) description from your code — or write
the description first and generate the types — so it cannot drift from reality.

Beyond the schema, document the things a schema cannot express: authentication,
rate limits, pagination conventions, error codes, idempotency behaviour,
webhook payloads, and a changelog.

---

## Do's and Don'ts

### Do

- Use plural nouns and let the method be the verb.
- Return the specific status code, including 201 with `Location` and 204.
- Use RFC 9457 Problem Details with a stable machine-readable code.
- Paginate every collection, cursor-based by default.
- Support idempotency keys on anything with side effects.
- Send `ETag` and honour `If-None-Match` / `If-Match`.
- Mark user-specific responses `Cache-Control: private`.
- Authorise per object.
- Publish an OpenAPI description generated from the code.

### Don't

- Don't put verbs in paths, or use `GET` for anything that changes state.
- Don't return 200 with an error in the body.
- Don't return 5xx for client mistakes.
- Don't leak stack traces or SQL in error responses.
- Don't return unbounded collections.
- Don't nest resources more than one level deep.
- Don't put tokens in query strings.
- Don't break clients without a version and a deprecation window.
- Don't make clients parse human-readable error text.

---

## Debugging

| Symptom                           | Cause and fix                                                        |
| --------------------------------- | -------------------------------------------------------------------- |
| Client sees stale data            | A cacheable response without `private`, or too long a `max-age`.     |
| One user sees another's data      | A shared cache stored a user-specific response. Set `private`.       |
| Duplicate charges after a timeout | No idempotency key on a retried `POST`.                              |
| Intermittent 401s                 | Clock skew on JWT expiry, or a token refreshed in one instance only. |
| CORS error from the browser       | Preflight failing. Check `OPTIONS`, allowed headers and methods.     |
| 413 Payload Too Large             | The proxy's body limit is lower than the application's.              |
| Slow list endpoint as data grows  | Missing pagination, deep `OFFSET`, or N+1 behind the endpoint.       |
| Client breaks after a deploy      | A field was renamed or removed without a version bump.               |

`curl -i` shows the status line and headers, which is where most of the answer
usually is.

---

## FAQ

**Does my API have to be truly RESTful?**
No. Nearly nothing is, by Fielding's definition. Be consistent and use HTTP
properly; that is what delivers the practical benefits.

**PUT or PATCH?**
`PATCH` for partial updates, which is nearly always what a client wants. `PUT`
only when replacing the entire representation.

**How do I return a validation error for several fields?**
`422` with an `errors` array containing a field, a stable code and a message.

**Should I use HATEOAS?**
Rarely worth it. Almost no client follows links dynamically, and it adds
significant payload and complexity for benefit few consumers use.

**How do I handle long-running operations?**
`202 Accepted` with a `Location` pointing at a status resource the client polls,
or a [webhook](/knowledge-base/apis/webhooks) when it completes.

**REST or GraphQL?**
REST for a public API with well-understood resources, cacheability and broad
client support. GraphQL when many clients need different shapes of one graph.
See [GraphQL](/knowledge-base/apis/graphql).

---

## Check your understanding

<Quiz
question="A client sends a valid JSON body, but `quantity` is 0 and the API requires at least 1. What status code is correct?"
options={[
{
text: '422 Unprocessable Content — the syntax is valid but the content fails validation',
correct: true,
why: '400 means the request could not be parsed. 422 distinguishes "I understood you and the values are wrong", which lets a client tell a bug from a user error.',
},
{text: '400 Bad Request', why: 'Widely used and acceptable, but less precise: it conflates malformed syntax with failed validation.'},
{text: '500 Internal Server Error', why: 'Nothing failed on the server. A 5xx for a client mistake makes error-rate alerting meaningless.'},
{text: '200 OK with an error object in the body', why: 'Defeats every proxy, cache, client library and monitoring tool that understands HTTP status codes.'},
]}
explanation={<>Pair it with RFC 9457 Problem Details and a per-field <code>errors</code> array carrying stable codes, so a form can highlight the right input without parsing prose.</>}
reference={{label: 'Status codes', href: '/knowledge-base/apis/rest#client-errors'}}
/>

<Quiz
question="A payment endpoint occasionally charges customers twice. Logs show a client retry after a timeout, where the original request had in fact succeeded. What is the correct fix?"
options={[
{
text: 'Accept an Idempotency-Key header, store the result against it, and return the stored result on a repeat',
correct: true,
why: 'A lost response is indistinguishable from a lost request. An idempotency key lets the server recognise the duplicate and replay the original outcome instead of charging again.',
},
{text: 'Change the endpoint from POST to PUT, since PUT is idempotent', why: 'The method is a contract, not an implementation. Renaming it does not make a charge idempotent.'},
{text: 'Increase the client timeout so retries do not occur', why: 'Reduces frequency without removing the race — a dropped connection still produces a duplicate.'},
{text: 'Wrap the charge in a database transaction', why: 'A transaction makes one request atomic. It says nothing about two separate requests with the same intent.'},
]}
explanation={<>Any endpoint with an external side effect — charging, emailing, provisioning — needs idempotency <em>before</em> it needs retries.</>}
reference={{label: 'Idempotency for POST', href: '/knowledge-base/apis/rest#idempotency-for-post'}}
/>

<Quiz
question="Which of these are breaking changes requiring a new API version?"
type="multiple"
options={[
{text: 'Renaming a response field from total to total_pence', correct: true, why: 'Every client reading total now gets undefined. Add the new field, deprecate the old, remove it in the next version.'},
{text: 'Adding a required field to a request body', correct: true, why: 'Existing clients do not send it and start failing validation immediately.'},
{text: 'Changing a 200 response to a 202 for the same operation', correct: true, why: 'Clients branch on status codes, and the semantics change from "done" to "accepted".'},
{text: 'Adding a new optional query parameter', why: 'Purely additive — existing clients that omit it are unaffected.'},
{text: 'Adding a new field to a response', why: 'Additive, provided you have documented that clients must ignore unknown fields. Say so explicitly.'},
]}
explanation={<>Most evolution can be additive. Reserve version bumps for genuine breaks, and when you do break, announce it with <code>Deprecation</code> and <code>Sunset</code> headers well in advance.</>}
reference={{label: 'Versioning', href: '/knowledge-base/apis/rest#versioning'}}
/>

<Quiz
question="Users intermittently see another customer's order data. The endpoint is authenticated and correct, and there is a CDN in front. What is the most likely cause?"
options={[
{
text: 'A user-specific response was sent with a cacheable, public Cache-Control, so the CDN stored one user\'s response and served it to others',
correct: true,
why: 'Shared caches obey Cache-Control. Anything user-specific must be marked private (or no-store), or the CDN treats it as a public document.',
},
{text: 'JWT tokens are colliding between users', why: 'Signed tokens do not collide. A token bug would produce consistent, not intermittent, mix-ups.'},
{text: 'The database is returning rows from the wrong tenant', why: 'Possible in general, but it would not be intermittent and CDN-correlated.'},
{text: 'CORS is misconfigured', why: 'CORS governs which origins may read a response, not which user’s data a cache serves.'},
]}
explanation={<>Set <code>Cache-Control: private, no-store</code> on authenticated responses by default, and opt specific endpoints into caching deliberately. Also consider <code>Vary: Authorization</code>.</>}
reference={{label: 'Caching', href: '/knowledge-base/apis/rest#caching'}}
/>

<Quiz
question="An API authenticates every request, then loads a resource by the id in the URL. A penetration test finds that changing the id returns another customer's invoice. What is the flaw?"
options={[
{
text: 'Broken object-level authorisation — authentication proves identity, but nothing verifies this user may access this particular record',
correct: true,
why: 'Authentication and authorisation are separate. Only a per-object ownership or permission check prevents id substitution, and it is the top entry in the OWASP API Security Top 10.',
},
{text: 'Sequential ids are the vulnerability; UUIDs would fix it', why: 'UUIDs make guessing harder — security through obscurity. The missing check remains, and a leaked id still works.'},
{text: 'The API needs rate limiting to stop enumeration', why: 'Rate limiting slows an attacker down. It does not stop a single unauthorised read.'},
{text: 'HTTPS would prevent it', why: 'Transport encryption protects data in transit; the request here is entirely legitimate at the transport layer.'},
]}
explanation={<>Returning <code>404</code> rather than <code>403</code> additionally avoids confirming the record exists — useful, but secondary to actually performing the check.</>}
reference={{label: 'Security', href: '/knowledge-base/apis/rest#security'}}
/>

---

## References

- [MDN: HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP) — methods,
  status codes, headers, caching.
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — the
  normative definitions of safe, idempotent and every status code.
- [RFC 9457: Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) — the
  standard error response format.
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  — broken object-level authorisation and the rest.
- [Stripe API reference](https://docs.stripe.com/api) — the most widely imitated
  example of the conventions on this page.
- [Google API Design Guide](https://cloud.google.com/apis/design) — a thorough,
  opinionated resource-naming standard.
