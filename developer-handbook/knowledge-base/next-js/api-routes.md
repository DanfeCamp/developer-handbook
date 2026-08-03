---
id: api-routes
title: API Routes
description: Route Handlers in the App Router — building HTTP endpoints, when to use a Server Action instead, and the security rules that apply to both.
---

# API Routes and Route Handlers

## Introduction

Next.js lets you serve HTTP endpoints from the same project as your UI. In the
App Router these are **Route Handlers**, defined in a `route.ts` file, and they
replace the Pages Router's `pages/api/*` "API Routes".

The terminology still overlaps in most documentation, including the sidebar
entry above. To be precise:

|           | Pages Router                                  | App Router                                  |
| --------- | --------------------------------------------- | ------------------------------------------- |
| Name      | API Routes                                    | **Route Handlers**                          |
| Location  | `pages/api/orders.ts`                         | `app/api/orders/route.ts`                   |
| Signature | `(req: NextApiRequest, res: NextApiResponse)` | `(request: Request)` returning a `Response` |
| Model     | Node-specific objects                         | Web standard `Request`/`Response`           |

The App Router version builds on the **web platform**, so the same knowledge
transfers to Cloudflare Workers, Deno and Bun.

:::tip Most mutations do not need an endpoint
If the only consumer is your own UI, a
[Server Action](/knowledge-base/next-js#server-actions) is less code and better
integrated. Reach for a Route Handler when something _outside_ your application
needs to call it — a webhook, a mobile client, a third-party integration. There
is a decision table [below](#route-handler-or-server-action).
:::

---

## Basic Usage

One file, one route. Export a function per HTTP method:

```ts title="app/api/orders/route.ts"
export async function GET(request: Request) {
  const orders = await db.order.findMany();
  return Response.json(orders);
}

export async function POST(request: Request) {
  const body = await request.json();
  const order = await db.order.create({data: body});
  return Response.json(order, {status: 201});
}
```

Supported exports: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
Anything not exported returns `405 Method Not Allowed` automatically.

A `route.ts` and a `page.tsx` **cannot live in the same folder** — they both
claim the same URL.

### Reading the request

```ts
export async function GET(request: Request) {
  // Query string
  const {searchParams} = new URL(request.url);
  const page = Number(searchParams.get('page') ?? '1');

  // Headers
  const auth = request.headers.get('authorization');

  return Response.json({page, auth: Boolean(auth)});
}

export async function POST(request: Request) {
  const json = await request.json(); // JSON body
  const form = await request.formData(); // …or form data
  const text = await request.text(); // …or raw text
  return new Response(null, {status: 204});
}
```

A request body can only be consumed **once**. Calling `request.json()` after
`request.text()` throws.

### Dynamic segments

```ts title="app/api/orders/[id]/route.ts"
export async function GET(
  request: Request,
  {params}: {params: Promise<{id: string}>},
) {
  const {id} = await params; // ← await: params is a Promise in Next.js 15+

  const order = await db.order.findUnique({where: {id}});
  if (!order) {
    return Response.json({error: 'Not found'}, {status: 404});
  }
  return Response.json(order);
}
```

The `await params` is the single most common upgrade break from Next.js 14.

Catch-all segments work as they do for pages: `[...slug]` matches one or more
segments, `[[...slug]]` matches zero or more.

### Responses

```ts
Response.json({ok: true});                                   // JSON
Response.json({error: 'Invalid'}, {status: 422});            // with a status
new Response('plain text', {headers: {'content-type': 'text/plain'}});
new Response(null, {status: 204});                           // no content
Response.redirect(new URL('/login', request.url), 302);
```

`NextResponse` from `next/server` extends `Response` with cookie helpers:

```ts
import {NextResponse} from 'next/server';

export async function POST() {
  const response = NextResponse.json({ok: true});
  response.cookies.set('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
```

Those cookie flags are not optional in production — see
[Sessions and Cookies](/knowledge-base/security/sessions-and-cookies).

---

## Advanced Usage

### Validate input, always

The endpoint is public. Type annotations are erased at runtime and prove
nothing about what actually arrived.

```ts
import {z} from 'zod';

const CreateOrder = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
});

export async function POST(request: Request) {
  const parsed = CreateOrder.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {error: 'Validation failed', issues: parsed.error.issues},
      {status: 422},
    );
  }

  const order = await db.order.create({data: parsed.data});
  return Response.json(order, {status: 201});
}
```

### Authentication

```ts
export async function DELETE(
  request: Request,
  {params}: {params: Promise<{id: string}>},
) {
  const session = await auth();
  if (!session) {
    return Response.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await params;
  const order = await db.order.findUnique({where: {id}});

  // Authorisation is separate from authentication: is this *their* order?
  if (!order || order.userId !== session.user.id) {
    return Response.json({error: 'Not found'}, {status: 404});
  }

  await db.order.delete({where: {id}});
  return new Response(null, {status: 204});
}
```

Returning `404` rather than `403` for a resource the user may not access avoids
leaking whether it exists. See
[Authorization](/knowledge-base/security/authorization).

### Webhooks

Two rules: **verify the signature**, and **read the raw body** to do so.

```ts title="app/api/webhooks/stripe/route.ts"
import {headers} from 'next/headers';

export async function POST(request: Request) {
  const body = await request.text(); // raw text — NOT request.json()
  const signature = (await headers()).get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return Response.json({error: 'Invalid signature'}, {status: 400});
  }

  // Webhooks retry. Make handling idempotent.
  const seen = await db.webhookEvent.findUnique({where: {id: event.id}});
  if (seen) return new Response(null, {status: 200});

  await db.webhookEvent.create({data: {id: event.id}});
  await handleEvent(event);

  return new Response(null, {status: 200});
}
```

Parsing the JSON first destroys the exact bytes the signature was computed over,
so verification fails in a way that looks like a configuration problem. And
because providers retry on any non-2xx, an event can arrive twice — dedupe by
event id. See [Webhooks](/knowledge-base/apis/webhooks).

### Caching

Route Handlers are **not cached by default**. Opt in explicitly:

```ts
export const revalidate = 3600; // ISR: regenerate at most hourly
export const dynamic = 'force-static'; // always static
export const dynamic = 'force-dynamic'; // never cached
export const runtime = 'nodejs'; // or 'edge'
```

Or set headers per response:

```ts
return Response.json(data, {
  headers: {'Cache-Control': 's-maxage=60, stale-while-revalidate=300'},
});
```

`stale-while-revalidate` is the useful pattern for public data: serve the cached
copy instantly while refreshing in the background.

### Streaming

```ts
export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of generateReport()) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache'},
  });
}
```

Useful for LLM token streaming, progress updates and large exports. See
[Server-Sent Events](/knowledge-base/apis/server-sent-events).

### CORS

Only needed when a _different origin_ calls your API. Your own frontend is
same-origin and needs none of this.

```ts
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://partner.example.com',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
```

Never reflect an arbitrary `Origin` header back, and never combine
`Access-Control-Allow-Origin: *` with credentials. See
[CORS](/knowledge-base/security/cors).

### proxy.ts

Cross-cutting request handling — auth redirects, locale detection, header
rewriting — lives in `proxy.ts` at the project root. **This was called
`middleware.ts` before Next.js 16.**

```ts title="proxy.ts"
import {NextResponse, type NextRequest} from 'next/server';

export function proxy(request: NextRequest) {
  const session = request.cookies.get('session');

  if (!session && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/private/:path*'],
};
```

It runs before every matched request, so keep it fast and do no database work
there. Treat it as routing, not as your authorisation boundary — every handler
must still check permissions itself.

---

## Route Handler or Server Action?

| Use a **Server Action** when               | Use a **Route Handler** when               |
| ------------------------------------------ | ------------------------------------------ |
| A form in your own app submits data        | A webhook provider calls you               |
| You mutate and then revalidate a cache     | A mobile app or third party consumes it    |
| Progressive enhancement matters            | You need a specific status code or headers |
| The logic is only ever called from your UI | You are serving files, streams or SSE      |
|                                            | You need CORS, or a stable public contract |

Both are public HTTP endpoints. Both need authentication and validation. The
difference is who calls them and how much plumbing you write.

---

## Do's and Don'ts

### Do

- `await params` — it is a Promise in Next.js 15+.
- Validate every request body with a schema.
- Authenticate _and_ authorise inside every handler.
- Verify webhook signatures against the **raw** body.
- Make webhook handling idempotent.
- Return correct status codes: 201 created, 204 no content, 422 validation.
- Set `httpOnly`, `secure` and `sameSite` on session cookies.
- Log errors server-side with a correlation id; return a generic message.

### Don't

- Don't put a `route.ts` and a `page.tsx` in the same folder.
- Don't read the body twice.
- Don't trust `proxy.ts` as your only authorisation check.
- Don't reflect arbitrary origins in CORS headers.
- Don't return raw error messages or stack traces to clients.
- Don't build a Route Handler for something only your own form calls.
- Don't do heavy work in `proxy.ts`.

---

## Debugging

| Symptom                           | Cause and fix                                                    |
| --------------------------------- | ---------------------------------------------------------------- |
| `params.id` is undefined          | It is a Promise now. `const {id} = await params`.                |
| 405 Method Not Allowed            | That method is not exported from `route.ts`.                     |
| Conflicting route error           | A `page.tsx` and `route.ts` in the same directory.               |
| Webhook signature always invalid  | The body was parsed as JSON first. Use `request.text()`.         |
| Body is empty on the second read  | A request body can only be consumed once.                        |
| Handler returns stale data        | A cache directive or `Cache-Control` header is in effect.        |
| CORS error from your own frontend | Same-origin requests need no CORS — the real error is elsewhere. |
| Works in dev, 500 in production   | An environment variable that only exists locally.                |

---

## FAQ

**Are API Routes and Route Handlers the same thing?**
Same idea, different implementation. "API Routes" is the Pages Router name;
"Route Handlers" is the App Router's, and uses web-standard `Request` and
`Response`.

**Can I still use `pages/api`?**
Yes, and it can coexist with `app/`. New endpoints should use `route.ts`.

**Node or Edge runtime?**
Node by default — full API access, database drivers work. Edge for low-latency
global responses with no Node-specific dependencies.

**How do I handle file uploads?**
`await request.formData()` for modest files. For anything large, issue a
pre-signed URL and have the browser upload directly to object storage. See
[File Uploads](/knowledge-base/web/file-uploads).

**Why is my handler called twice in development?**
React Strict Mode double-invokes in development. It does not happen in
production.

---

## Check your understanding

<Quiz
question="After upgrading to Next.js 16, a dynamic Route Handler logs `undefined` for params.id. What changed?"
options={[
{
text: 'params is now a Promise and must be awaited',
correct: true,
why: 'Next.js 15 made request APIs — params, searchParams, cookies() and headers() — asynchronous. Destructuring without await yields undefined.',
},
{text: 'Dynamic segments now use a different bracket syntax', why: 'The [id] folder convention is unchanged.'},
{text: 'Route Handlers no longer receive a second argument', why: 'They do; its shape changed to wrap params in a Promise.'},
{text: 'The handler must be exported as default', why: 'Route Handlers are named exports per HTTP method, and always have been.'},
]}
explanation={<>The same change applies to <code>searchParams</code> in pages and to <code>cookies()</code> and <code>headers()</code> everywhere. It is the most common Next.js 14 → 15 upgrade break.</>}
reference={{label: 'Dynamic segments', href: '/knowledge-base/next-js/api-routes#dynamic-segments'}}
/>

<Quiz
question="A Stripe webhook handler rejects every event with 'invalid signature', though the secret is correct. What is wrong?"
options={[
{
text: 'The body was read with request.json(); signature verification needs the raw, unparsed bytes',
correct: true,
why: 'The signature is computed over the exact bytes sent. Parsing and re-serialising changes whitespace and key order, so verification fails. Use request.text().',
},
{text: 'The webhook secret must be prefixed NEXT_PUBLIC_', why: 'That would expose the secret in the client bundle — the opposite of what is needed.'},
{text: 'Route Handlers cannot receive POST requests from external services', why: 'They can; that is a primary use case.'},
{text: 'Stripe requires the Edge runtime', why: 'No such requirement, and the Node runtime is the usual choice for SDK compatibility.'},
]}
explanation={<>Also make handling idempotent: providers retry on any non-2xx response, so the same event id can arrive several times.</>}
reference={{label: 'Webhooks', href: '/knowledge-base/next-js/api-routes#webhooks'}}
/>

<Quiz
question="Which of these need a Route Handler rather than a Server Action?"
type="multiple"
options={[
{text: 'Receiving a payment webhook from Stripe', correct: true, why: 'An external caller needs a stable URL, a specific response contract and signature verification.'},
{text: 'A React Native app fetching the user’s orders', correct: true, why: 'An external consumer that is not your Next.js UI.'},
{text: 'Submitting a contact form on your own site', why: 'Only your UI calls it. A Server Action is less code and progressively enhances.'},
{text: 'Serving a generated CSV export with a Content-Disposition header', correct: true, why: 'You need control over status, headers and the response body — Actions return data to React, not raw HTTP responses.'},
{text: 'Updating a user’s display name from a settings form', why: 'A mutation from your own UI followed by a revalidation — exactly what Server Actions are for.'},
]}
explanation={<>The dividing line is the consumer. Your own UI → Server Action. Anything else → Route Handler. Both are public endpoints requiring authentication and validation.</>}
reference={{label: 'Route Handler or Server Action?', href: '/knowledge-base/next-js/api-routes#route-handler-or-server-action'}}
/>

<Quiz
question="A `proxy.ts` redirects unauthenticated users away from /dashboard. Is that sufficient authorisation for the dashboard's Route Handlers?"
options={[
{
text: 'No — every handler must check authentication and authorisation itself, because the endpoint is directly reachable',
correct: true,
why: 'proxy.ts is routing. A handler URL can be called directly, and matcher patterns are easy to get subtly wrong. Defence must live where the data is accessed.',
},
{
text: 'Yes, provided the matcher covers /api/* as well',
why: 'Better, but still a single perimeter check. A matcher mistake or a new route outside the pattern silently removes all protection.',
},
{
text: 'Yes — proxy.ts runs before every request, so nothing can bypass it',
why: 'It runs before every _matched_ request. It also cannot express per-resource authorisation such as "is this the user’s own order?".',
},
{
text: 'Only if proxy.ts runs on the Node runtime',
why: 'The runtime is irrelevant to whether a single perimeter check is sufficient.',
},
]}
explanation={<>Authentication answers "who is this?", authorisation answers "may they touch <em>this record</em>?" — and only the handler has enough context for the second question.</>}
reference={{label: 'Authentication', href: '/knowledge-base/next-js/api-routes#authentication'}}
/>

<Quiz
question="This handler compiles and looks fine. What is the bug?"
options={[
{
text: 'The request body is consumed twice — the second read throws because the stream is already used',
correct: true,
why: 'A Request body is a one-shot stream. After request.json() resolves, request.text() has nothing left to read.',
},
{text: 'Response.json() cannot take a status option', why: 'It can — the second argument is a ResponseInit.'},
{text: 'The handler must be declared async to read a body', why: 'It is declared async here, and correctly so.'},
{text: 'text() must be called before headers are read', why: 'Headers can be read at any point; they are not part of the body stream.'},
]}
explanation={<>If you need both representations, read the raw text once and parse it yourself: <code>const raw = await request.text(); const data = JSON.parse(raw);</code></>}
reference={{label: 'Reading the request', href: '/knowledge-base/next-js/api-routes#reading-the-request'}}>

```ts
export async function POST(request: Request) {
  const data = await request.json();
  const raw = await request.text(); // for signature verification
  return Response.json({ok: true}, {status: 201});
}
```

</Quiz>

---

## References

- [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
  — the official reference.
- [Server Actions and mutations](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
  — the alternative, and its security model.
- [proxy.ts](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) —
  matchers and limitations.
- [MDN: Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) and
  [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) — the
  web standards these build on.
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  — what to defend against.
