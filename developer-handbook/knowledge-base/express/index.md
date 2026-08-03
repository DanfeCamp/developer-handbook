---
title: 'Express'
description: 'Minimal, unopinionated HTTP servers for Node.js — routing, middleware, the Express 5 async error changes, structure, security and production practices.'
---

# Express

## Introduction

Express is a thin routing and middleware layer over Node's `http` module. It
deliberately provides very little structure, which makes it flexible and quick
to learn — and means that validation, error handling, project layout and
security are decisions you must make yourself.

**The problem it solves.** Node's built-in HTTP server gives you a raw request
and response. There is no routing, no body parsing, no way to compose reusable
behaviour. Express adds a router and a middleware pipeline, and stops there.

**Why it is still everywhere.** It has been the default Node web framework for
over a decade, so the ecosystem, the Stack Overflow answers and the hiring pool
all assume it. Newer frameworks are faster or more structured, but Express
remains the safe default for a REST API, a webhook receiver or a backend-for-
frontend.

:::note Versions
Written against **Express 5.2.1**. Express 5 became the endorsed production
release in 2025; **Express 4 is in its support wind-down and Express 3 is EOL**.

The single most important change in Express 5: **rejected promises in handlers
now propagate to the error middleware automatically.** Every Express 4 tutorial
telling you to wrap async handlers in a `catch` — or install
`express-async-errors` — is obsolete.
:::

---

## Core Concepts

### The middleware pipeline

Express is, at heart, an array of functions run in order. Each receives the
request, the response and a `next` function.

```js
import express from 'express';

const app = express();

app.use((req, res, next) => {
  req.startedAt = Date.now(); // middleware can enrich the request
  next(); // pass control on
});

app.get('/orders', (req, res) => {
  res.json([]); // sending a response ends the chain
});

app.listen(3000);
```

Three rules explain nearly all Express behaviour:

1. **Order matters.** Middleware runs top to bottom, in registration order. A
   route registered before your auth middleware is unauthenticated.
2. **Every path must end.** Either send a response or call `next()`. Doing
   neither hangs the request until it times out — the classic "the endpoint just
   never responds" bug.
3. **`next(err)` skips to error handling.** Passing anything to `next` jumps
   past every remaining normal middleware to the error handler.

### Routing

```js
import {Router} from 'express';

const orders = Router();

orders.get('/', listOrders);
orders.post('/', createOrder);
orders.get('/:id', getOrder); // req.params.id
orders.patch('/:id', updateOrder);
orders.delete('/:id', deleteOrder);

app.use('/api/orders', orders); // mount the whole router under a prefix
```

Routers are the unit of composition. One per resource, mounted under a prefix,
keeps a growing API navigable.

Express 5 changed path matching: it uses `path-to-regexp` v8, which **removed
the bare `*` wildcard and optional-character syntax**. Named parameters are now
required:

```js
// ❌ Express 4
app.get('/files/*', handler);
app.get('/users/:id?', handler);

// ✅ Express 5
app.get('/files/*splat', handler); // named wildcard
app.get('/users{/:id}', handler); // optional segment
```

This is the change most likely to break silently on upgrade — routes simply
stop matching.

---

## Setup

```bash
npm init -y
npm pkg set type=module
npm install express
npm install -D typescript tsx @types/express @types/node
```

```ts title="src/app.ts"
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import {ordersRouter} from './routes/orders.js';
import {errorHandler} from './middleware/error-handler.js';
import {notFound} from './middleware/not-found.js';

export const app = express();

// Security headers first.
app.use(helmet());
app.use(cors({origin: process.env.WEB_ORIGIN, credentials: true}));

// Body parsing — built in since 4.16; no body-parser package needed.
app.use(express.json({limit: '1mb'}));
app.use(express.urlencoded({extended: true}));

// Trust the proxy so req.ip and secure cookies work behind nginx or a load balancer.
app.set('trust proxy', 1);

app.get('/health', (req, res) => res.json({status: 'ok'}));
app.use('/api/orders', ordersRouter);

// These two must be registered last.
app.use(notFound);
app.use(errorHandler);
```

```ts title="src/server.ts"
import {app} from './app.js';

const server = app.listen(process.env.PORT ?? 3000);

// Graceful shutdown: stop accepting connections, finish in-flight requests.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
```

Splitting `app` from `server` is what makes the app testable — `supertest` can
drive `app` directly without binding a port.

---

## Error Handling

### The Express 5 change

```js
// Express 4 — an unhandled rejection crashed the process or hung the request.
app.get('/orders', async (req, res, next) => {
  try {
    res.json(await getOrders());
  } catch (err) {
    next(err); // required
  }
});

// Express 5 — rejections are forwarded to the error handler automatically.
app.get('/orders', async (req, res) => {
  res.json(await getOrders());
});
```

This alone justifies upgrading. It removes the most repetitive and most
frequently forgotten piece of Express boilerplate.

### A real error handler

An error middleware is identified by having **four parameters**. Omit the
fourth and Express treats it as ordinary middleware and never calls it — a
genuinely baffling bug the first time you meet it.

```ts title="src/middleware/error-handler.ts"
import type {ErrorRequestHandler} from 'express';
import {ZodError} from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Four parameters — this is what marks it as an error handler.
  if (res.headersSent) return next(err);

  if (err instanceof ZodError) {
    return res.status(422).json({error: 'Validation failed', issues: err.issues});
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({error: err.message, code: err.code});
  }

  // Unexpected: log the detail, return nothing useful to the client.
  req.log?.error({err, requestId: req.id}, 'Unhandled error');
  res.status(500).json({error: 'Internal server error', requestId: req.id});
};
```

Never return `err.message` or a stack trace for unexpected errors — they leak
file paths, query fragments and library versions. Log them with a request id and
return that id instead, so support can correlate a user report with a log line.

### Process-level safety nets

```ts
process.on('unhandledRejection', (reason) => {
  logger.fatal({reason}, 'Unhandled rejection');
  process.exit(1); // let the orchestrator restart a clean process
});
```

Crashing on an unknown-state error is correct. A process that continues after an
unhandled rejection may be holding a half-committed transaction.

---

## Validation

Type annotations are erased at runtime. Every request body, query string and
parameter is untrusted input.

```ts
import {z} from 'zod';
import type {RequestHandler} from 'express';

const CreateOrder = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
});

export const validate =
  (schema: z.ZodSchema): RequestHandler =>
  (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({error: 'Validation failed', issues: parsed.error.issues});
    }
    req.body = parsed.data; // narrowed and coerced
    next();
  };

orders.post('/', validate(CreateOrder), createOrder);
```

Validate at the edge, once, and let everything downstream assume the data is
correct.

---

## Structure

A single `index.js` stops working at about 300 lines. The layout that scales:

```text
src/
├── app.ts                  ← wires middleware and routers; no listen()
├── server.ts               ← listen() and graceful shutdown
├── config.ts               ← validated environment variables
├── routes/
│   └── orders.ts           ← Router: paths → controllers
├── controllers/
│   └── orders.ts           ← HTTP in, HTTP out. No business logic
├── services/
│   └── orders.ts           ← business logic. Knows nothing about HTTP
├── repositories/
│   └── orders.ts           ← database access
├── middleware/
│   ├── auth.ts
│   ├── error-handler.ts
│   └── request-id.ts
└── schemas/
    └── orders.ts           ← Zod schemas
```

The rule that makes this worth doing: **services must not import `express`.** If
your business logic takes a `Request` and calls `res.json()`, it can only be
tested through HTTP and can never be reused by a queue worker or a CLI command.

```ts
// controllers/orders.ts — thin
export const createOrder: RequestHandler = async (req, res) => {
  const order = await orderService.create(req.body, req.user.id);
  res.status(201).json(order);
};

// services/orders.ts — no HTTP types anywhere
export async function create(input: CreateOrderInput, userId: string) {
  const product = await productRepo.findById(input.productId);
  if (!product) throw new HttpError(404, 'Product not found');
  return orderRepo.insert({...input, userId});
}
```

Validate configuration once, at startup, and crash loudly if it is wrong:

```ts title="src/config.ts"
import {z} from 'zod';

export const config = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  })
  .parse(process.env);
```

---

## Security

Express ships almost no security defaults. These are not optional:

```ts
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

app.use(helmet()); // CSP, HSTS, X-Frame-Options, nosniff, and more

app.use(
  '/api',
  rateLimit({windowMs: 60_000, limit: 100, standardHeaders: 'draft-7'}),
);

// Stricter on the endpoints that get attacked.
app.use('/api/auth/login', rateLimit({windowMs: 15 * 60_000, limit: 5}));

app.use(express.json({limit: '100kb'})); // cap body size — an unbounded parser is a DoS
app.disable('x-powered-by'); // helmet does this too
```

The checklist:

- **`helmet()` first**, before any route.
- **Rate-limit** globally, and much harder on login, password reset and anything
  sending email or SMS.
- **Cap body size.** The default `express.json()` limit is 100 kb — do not raise
  it casually.
- **`trust proxy`** behind a reverse proxy, or `req.ip` is your load balancer and
  rate limiting becomes useless.
- **Parameterise every query.** See
  [SQL Injection](/knowledge-base/security/sql-injection).
- **Cookies:** `httpOnly`, `secure`, `sameSite: 'lax'`. See
  [Sessions and Cookies](/knowledge-base/security/sessions-and-cookies).
- **CORS with an explicit origin allowlist** — never `origin: true` with
  credentials. See [CORS](/knowledge-base/security/cors).
- **Authorise per resource**, not just per route. A logged-in user is not
  automatically entitled to order 42.

---

## Testing

```ts
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {app} from '../src/app.js';

describe('POST /api/orders', () => {
  it('rejects a quantity of zero', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({productId: validUuid, quantity: 0});

    expect(response.status).toBe(422);
    expect(response.body.issues[0].path).toEqual(['quantity']);
  });

  it('creates an order', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({productId: validUuid, quantity: 2});

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({quantity: 2});
  });
});
```

`supertest` drives the `app` object directly — no port, no race, fast enough to
run on every save. Test against a real database in a container rather than a
mocked repository; see [Testing](/knowledge-base/testing).

---

## Production

```dockerfile
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- **Structured logging** with `pino`, including a request id on every line. See
  [Logging](/knowledge-base/operations/logging).
- **A real health endpoint**: `/health` for liveness, `/ready` that actually
  checks the database for readiness.
- **Graceful shutdown**, as in the setup section — without it, deploys drop
  in-flight requests.
- **Run behind a reverse proxy** for TLS, compression and static files. Nginx
  serves a static file far faster than Node. See
  [Nginx](/knowledge-base/hosting/nginx).
- **Cluster or replicas.** Node uses one core; run one process per core, or
  scale horizontally with an orchestrator.

---

## Express, Fastify or Hono?

|            | Express        | Fastify              | Hono                           |
| ---------- | -------------- | -------------------- | ------------------------------ |
| Maturity   | Highest        | High                 | Newer                          |
| Throughput | Baseline       | ~2×                  | ~2×                            |
| Validation | Bring your own | Built-in JSON Schema | Bring your own                 |
| TypeScript | Via `@types`   | First-class          | First-class                    |
| Runtimes   | Node           | Node                 | Node, Bun, Deno, Workers, edge |

**Express** when you want the largest ecosystem and the least surprise.
**Fastify** for throughput and built-in schema validation and serialisation.
**Hono** when you need to run on edge runtimes as well as Node.

For a typical CRUD API, throughput is almost never the constraint — database
queries dominate. Choose on ecosystem and team familiarity.

---

## Do's and Don'ts

### Do

- Use Express 5 and delete your async try/catch wrappers.
- Register `helmet()`, rate limiting and body-size limits before routes.
- Give the error handler four parameters, registered last.
- Validate every input at the edge with a schema.
- Keep services free of `express` imports.
- Split `app` from `server` so tests can drive the app directly.
- Set `trust proxy` behind a load balancer.
- Handle `SIGTERM` for graceful shutdown.

### Don't

- Don't leave a code path that neither responds nor calls `next()`.
- Don't return raw error messages or stack traces to clients.
- Don't use `body-parser` — it has been built in since 4.16.
- Don't register routes before authentication middleware.
- Don't use bare `*` routes on Express 5; they no longer match.
- Don't serve static assets from Node when a reverse proxy is available.
- Don't trust `req.body` because TypeScript says it has a type.

---

## Debugging

| Symptom                                     | Cause and fix                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Request hangs forever                       | A path that neither sends a response nor calls `next()`.                       |
| "Cannot set headers after they are sent"    | Two responses on one request — usually a missing `return` before `res.json()`. |
| Error handler never runs                    | It has three parameters, not four; or it is registered before the routes.      |
| Route stopped matching after upgrading to 5 | `path-to-regexp` v8 removed bare `*` and `?`. Use `*splat` and `{/:id}`.       |
| `req.body` is undefined                     | `express.json()` is missing, or the client sent no `Content-Type`.             |
| `req.ip` is the load balancer               | Set `app.set('trust proxy', 1)`.                                               |
| 404 on a route that exists                  | A router mounted in the wrong order, or the catch-all registered too early.    |
| Memory grows steadily                       | Listeners or intervals created per request and never cleaned up.               |

```bash
DEBUG=express:* node dist/server.js   # Express's own routing trace
node --inspect dist/server.js         # Chrome DevTools debugger
```

---

## FAQ

**Should I upgrade from Express 4 to 5?**
Yes. Automatic async error propagation is worth it alone, and Express 4 is in
support wind-down. Budget time for the routing syntax change, which is the main
break.

**Do I still need `express-async-errors`?**
No. Express 5 does it natively.

**Express or Nest?**
Nest gives you dependency injection, modules and decorators on top of Express or
Fastify. It suits large teams that want prescribed structure; it is considerable
ceremony for a small API.

**How do I handle file uploads?**
`multer` for modest files. For anything large, issue a pre-signed URL and let
the client upload directly to object storage. See
[File Uploads](/knowledge-base/web/file-uploads).

**Where do database transactions belong?**
In the service layer, wrapping the operations that must succeed or fail
together. Controllers should not know that a transaction exists.

---

## Check your understanding

<Quiz
question="This Express 5 handler throws inside getOrders(). What happens?"
options={[
{
text: 'The rejection propagates to the error-handling middleware automatically',
correct: true,
why: 'Express 5 forwards rejected promises from handlers to the error handler. This is the change that made try/catch wrappers and express-async-errors unnecessary.',
},
{
text: 'The process crashes with an unhandled rejection',
why: 'That was Express 4 behaviour. Express 5 catches it and routes it to the error handler.',
},
{text: 'The request hangs until it times out', why: 'Also Express 4 behaviour when the rejection was swallowed. Express 5 responds via the error handler.'},
{text: 'Express returns a 500 with the stack trace in the body', why: 'What the client receives is entirely determined by your error handler — and it should not include a stack trace.'},
]}
explanation={<>Confirm your error handler has <strong>four</strong> parameters. With three, Express treats it as ordinary middleware and never invokes it — so the improvement is invisible.</>}
reference={{label: 'The Express 5 change', href: '/knowledge-base/express#the-express-5-change'}}>

```js
app.get('/orders', async (req, res) => {
  res.json(await getOrders()); // getOrders() rejects
});
```

</Quiz>

<Quiz
question="After upgrading to Express 5, the route `app.get('/files/*', handler)` no longer matches anything. Why?"
options={[
{
text: 'path-to-regexp v8 removed the bare wildcard; it must be named, as in /files/*splat',
correct: true,
why: 'Express 5 upgraded its path matcher, which requires named wildcards and changed optional-segment syntax. Routes fail silently rather than erroring.',
},
{text: 'Wildcard routes must now be registered with app.all()', why: 'The HTTP method is unrelated to how the path pattern is parsed.'},
{text: 'Express 5 requires a leading slash on wildcards', why: 'The pattern already has one; the problem is the unnamed wildcard.'},
{text: 'Wildcards only work inside a Router, not on the app', why: 'They work on both, given valid syntax.'},
]}
explanation={<>The optional-parameter syntax changed too: <code>/users/:id?</code> becomes <code>/users&#123;/:id&#125;</code>. Both fail by silently not matching, which makes them easy to miss during an upgrade.</>}
reference={{label: 'Routing', href: '/knowledge-base/express#routing'}}
/>

<Quiz
question="Which of these belong before your route definitions in the middleware chain?"
type="multiple"
options={[
{text: 'helmet()', correct: true, why: 'Security headers must be applied to every response, including those from routes registered later.'},
{text: 'express.json()', correct: true, why: 'Handlers read req.body, which does not exist until a body parser has run.'},
{text: 'Rate limiting', correct: true, why: 'It must reject before the expensive handler runs, not after.'},
{text: 'The error-handling middleware', why: 'It must be registered last — Express only reaches it by skipping past everything in between.'},
{text: 'The 404 catch-all handler', why: 'Also last, and before the error handler. Registered early, it would swallow every real route.'},
]}
explanation={<>Express is an ordered pipeline. The first three must run before routes; the last two must run after — and getting the 404 handler's position wrong makes every route return 404.</>}
reference={{label: 'The middleware pipeline', href: '/knowledge-base/express#the-middleware-pipeline'}}
/>

<Quiz
question="A rate limiter blocks by IP, but in production every request appears to come from one address and legitimate users are being throttled. What is wrong?"
options={[
{
text: 'The app is behind a reverse proxy and trust proxy is not set, so req.ip reports the proxy rather than the client',
correct: true,
why: 'Without app.set("trust proxy", …), Express ignores X-Forwarded-For and reports the immediate peer — the load balancer. Every user then shares one bucket.',
},
{text: 'The rate limiter needs a longer window', why: 'The window is irrelevant when all users are counted as a single client.'},
{text: 'express-rate-limit does not support IPv6', why: 'It does. The problem is which address Express reports.'},
{text: 'Rate limiting must be applied per route, not globally', why: 'Scope does not change how the client IP is resolved.'},
]}
explanation={<>The same setting also governs <code>req.protocol</code> and therefore whether <code>secure</code> cookies are set correctly behind a TLS-terminating proxy. Set it to the number of proxies you actually have — <code>true</code> trusts any <code>X-Forwarded-For</code>, which is spoofable.</>}
reference={{label: 'Security', href: '/knowledge-base/express#security'}}
/>

<Quiz
question="A service function is written as `async function createOrder(req, res)` and calls res.status(201).json(order) directly. What is the practical cost?"
options={[
{
text: 'The business logic is coupled to HTTP, so it cannot be reused by a queue worker or CLI, and can only be tested through a full HTTP request',
correct: true,
why: 'Taking Request and Response ties the logic to Express. A service taking plain arguments and returning data (or throwing) can be unit-tested directly and reused anywhere.',
},
{text: 'It will not compile under TypeScript', why: 'It compiles fine — the cost is architectural, not a type error.'},
{text: 'Express 5 forbids sending responses outside a route handler', why: 'It does not; this is a design concern rather than a framework restriction.'},
{text: 'It causes a memory leak by retaining the response object', why: 'No leak — the objects are released when the request completes.'},
]}
explanation={<>The rule to enforce in review: nothing under <code>services/</code> imports <code>express</code>. Controllers translate HTTP to arguments and results back to HTTP; services hold the logic.</>}
reference={{label: 'Structure', href: '/knowledge-base/express#structure'}}
/>

---

## References

- [Express documentation](https://expressjs.com/) — API reference and guides.
- [Migrating to Express 5](https://expressjs.com/en/guide/migrating-5.html) —
  the full list of breaking changes.
- [Express security best practices](https://expressjs.com/en/advanced/best-practice-security.html)
  — the official checklist.
- [Helmet](https://helmetjs.github.io/) — what each header does.
- [Zod](https://zod.dev/) — runtime schema validation.
- [Pino](https://getpino.io/) — structured logging with low overhead.
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  — what to defend against.
