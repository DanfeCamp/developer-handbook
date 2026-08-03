---
title: Next.js
description: The React framework — App Router, Server Components, rendering strategies, Route Handlers and production practices, current as of Next.js 16.
---

# Next.js

## Introduction

Next.js is a React **framework**: it supplies the decisions React deliberately
leaves out — routing, server rendering, data fetching, bundling, image and font
optimisation, and a deployment target.

**The problem it solves.** A React application that must be indexed by search
engines, load quickly on a slow connection, and talk to a database needs server
rendering, a router, a build pipeline and an API layer. Assembling those
yourself is weeks of work and a permanent maintenance commitment. Next.js
provides one integrated answer.

**Where it fits.** Anything public-facing: marketing sites, e-commerce,
documentation, dashboards with a public surface. For an application entirely
behind a login where SEO is irrelevant, plain React with Vite is simpler and
perfectly adequate.

:::warning Versions and security
Written against **Next.js 16.2.11**, the Active LTS at the time of writing.
15.5.21 is Maintenance LTS; 16.3 is still canary. Next.js 16 requires React 19.

Vercel now runs a **monthly security release programme**. The July 2026 release
alone patched nine CVEs, four of them High. Next.js is a server framework —
treat its patch releases the way you treat any server dependency, and subscribe
to the release feed.
:::

---

## What Changed in Next.js 16

If your knowledge predates October 2025, these are the changes that invalidate
older tutorials:

| Change                               | Detail                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| **Turbopack is the default bundler** | Stable. 2–5× faster builds, 5–10× faster Fast Refresh than webpack.   |
| **`middleware.ts` → `proxy.ts`**     | Renamed to make the network boundary explicit.                        |
| **Cache Components**                 | `use cache`, `cacheLife`, `cacheTag` with Partial Pre-Rendering.      |
| **Async request APIs**               | `params`, `searchParams`, `cookies()`, `headers()` are all `await`ed. |
| **`next lint` removed**              | Configure ESLint directly.                                            |
| **Runtime config removed**           | `publicRuntimeConfig` / `serverRuntimeConfig` are gone.               |
| **React 19 required**                | Actions, `use()`, `ref` as a prop.                                    |

The async request APIs are the change most likely to break older code:

```tsx
// ❌ Next.js 14 and earlier
export default function Page({params}: {params: {slug: string}}) {
  return <h1>{params.slug}</h1>;
}

// ✅ Next.js 15+
export default async function Page({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  return <h1>{slug}</h1>;
}
```

---

## Core Concepts

### App Router

Routing is defined by the filesystem under `app/`. A folder is a URL segment; a
`page.tsx` inside it makes that segment routable.

```text
app/
├── layout.tsx              → wraps everything (required root layout)
├── page.tsx                → /
├── blog/
│   ├── page.tsx            → /blog
│   └── [slug]/page.tsx     → /blog/:slug
└── api/orders/route.ts     → /api/orders
```

Special files, each with a defined role:

| File            | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `page.tsx`      | Makes the segment publicly routable                         |
| `layout.tsx`    | Shared shell; **preserves state across navigation**         |
| `template.tsx`  | Like a layout, but remounts on every navigation             |
| `loading.tsx`   | Suspense fallback while the segment loads                   |
| `error.tsx`     | Error boundary for the segment (must be a Client Component) |
| `not-found.tsx` | Rendered by `notFound()`                                    |
| `route.ts`      | An HTTP endpoint instead of a page                          |

The Pages Router (`pages/`) still works and still receives fixes, but new
features land in the App Router only. See
[Folder Structure](/knowledge-base/next-js/folder-structure).

### Server and Client Components

**Every component is a Server Component by default.** It runs on the server
only, can be `async`, can read a database directly, and ships **no JavaScript**
to the browser.

```tsx
// A Server Component — the default. No 'use client'.
export default async function OrderList() {
  const orders = await db.order.findMany(); // direct database access
  return <ul>{orders.map((o) => <li key={o.id}>{o.reference}</li>)}</ul>;
}
```

`'use client'` marks the boundary where interactivity begins:

```tsx
'use client';
import {useState} from 'react';

export function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
```

Rules worth internalising:

- **`'use client'` marks a boundary, not a file.** Everything imported by that
  component also becomes client code.
- **Push the boundary as deep as possible.** One `'use client'` at the top of
  your layout sends the entire tree to the browser.
- **Server Components can render Client Components**, but not the reverse — a
  Client Component can only receive one as `children` or a prop.
- **Props crossing the boundary must be serialisable.** Functions, class
  instances and `Date` methods do not survive; plain data does.

```tsx
// ✅ Keep the interactive part small and pass server-rendered content in.
<ClientAccordion>
  <ServerRenderedContent />
</ClientAccordion>
```

### Rendering strategies

Next.js picks per route, based on what the route uses:

| Strategy      | When                                                    | Trade-off                           |
| ------------- | ------------------------------------------------------- | ----------------------------------- |
| **Static**    | No dynamic data at request time                         | Fastest; content fixed at build     |
| **ISR**       | Static, revalidated on a schedule or by tag             | Fast, eventually fresh              |
| **Dynamic**   | Uses `cookies()`, `headers()` or dynamic `searchParams` | Always fresh, slower                |
| **Streaming** | Suspense boundaries around slow parts                   | Shell instantly, data as it arrives |
| **Client**    | `'use client'` with browser-only APIs                   | Needed for interactivity            |

Full treatment in
[Rendering & SSR](/knowledge-base/next-js/server-side-rendering).

### Cache Components

The headline feature of Next.js 16. Rather than caching being implicit and
occasionally surprising, `use cache` makes it explicit:

```tsx
import {unstable_cacheLife as cacheLife, unstable_cacheTag as cacheTag} from 'next/cache';

async function getProduct(id: string) {
  'use cache';
  cacheLife('hours');
  cacheTag(`product-${id}`);

  return db.product.findUnique({where: {id}});
}
```

Combined with **Partial Pre-Rendering**, a single route can serve a cached
static shell immediately and stream the personalised parts in — previously an
all-or-nothing choice per route.

Invalidate by tag when the data changes:

```tsx
import {revalidateTag} from 'next/cache';
await revalidateTag(`product-${id}`);
```

### Server Actions

Functions that run on the server and are callable from the client, without you
writing an endpoint:

```tsx
'use server';

export async function createOrder(formData: FormData) {
  const session = await auth(); // ALWAYS re-check auth here
  if (!session) throw new Error('Unauthorized');

  const parsed = OrderSchema.parse(Object.fromEntries(formData));
  await db.order.create({data: {...parsed, userId: session.user.id}});

  revalidateTag('orders');
}
```

```tsx
<form action={createOrder}>
  <input name="quantity" type="number" />
  <button>Order</button>
</form>
```

:::danger A Server Action is a public HTTP endpoint
Marking a function `'use server'` creates a callable endpoint. Anyone can invoke
it with any arguments — the form is not a gate. **Authenticate and validate
inside every action**, exactly as you would in a route handler.
:::

---

## Setup

```bash
npx create-next-app@latest my-app
cd my-app
npm run dev        # Turbopack by default
```

```ts title="next.config.ts"
import type {NextConfig} from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{protocol: 'https', hostname: 'cdn.example.com'}],
  },
  experimental: {
    reactCompiler: true, // React Compiler 1.0 — automatic memoisation
  },
};

export default config;
```

Environment variables:

```ini title=".env.local"
DATABASE_URL=postgres://…          # server-only
NEXT_PUBLIC_ANALYTICS_ID=abc123    # inlined into the client bundle
```

**Anything prefixed `NEXT_PUBLIC_` is public.** It is inlined at build time and
visible in the bundle. Everything else is server-only — but only if you never
import that module into a Client Component. `import 'server-only'` at the top of
a module makes accidental client imports a build error, which is worth doing for
anything touching secrets.

---

## What is in this section

```mdx-code-block
import DocCardList from '@theme/DocCardList';
import {useCurrentSidebarCategory} from '@docusaurus/theme-common';

<DocCardList items={useCurrentSidebarCategory().items} />
```

- **[Folder Structure](/knowledge-base/next-js/folder-structure)** — App Router
  conventions, route groups, colocation.
- **[Rendering & SSR](/knowledge-base/next-js/server-side-rendering)** — static,
  dynamic, streaming, and how to choose.
- **[API Routes](/knowledge-base/next-js/api-routes)** — Route Handlers, and
  when to use a Server Action instead.
- **[SEO](/knowledge-base/next-js/seo)** — the Metadata API, sitemaps,
  structured data.
- **[Best Practices](/knowledge-base/next-js/best-practices)** — production
  practices for v16.
- **[Common Misconceptions](/knowledge-base/next-js/common-misconceptions)** and
  **[Common Mistakes](/knowledge-base/next-js/common-mistakes)**.

---

## FAQ

**App Router or Pages Router?**
App Router for anything new. Pages Router is maintained but frozen in features.
They can coexist during a migration.

**Do I have to deploy to Vercel?**
No. `output: 'standalone'` produces a self-contained Node server that runs
anywhere — a VPS, a container, Cloud Run. Some features (ISR at the edge, image
optimisation) need more configuration off-Vercel, and OpenNext exists for AWS.

**Is Next.js overkill for a small site?**
For a purely static site, Astro is lighter. Next.js earns its complexity when
you need interactivity, a backend, or both.

**Why is my page unexpectedly dynamic?**
Reading `cookies()`, `headers()` or `searchParams` opts a route into dynamic
rendering. `next build` prints which strategy each route received — check it.

**Server Actions or Route Handlers?**
Actions for mutations from your own UI. Route Handlers for anything with an
external consumer: webhooks, public APIs, mobile clients.

---

## References

- [Next.js documentation](https://nextjs.org/docs) — the authoritative reference.
- [Next.js 16 release notes](https://nextjs.org/blog/next-16) — Cache
  Components, Turbopack, `proxy.ts`.
- [Server Components](https://react.dev/reference/rsc/server-components) — the
  React-side model.
- [Next.js security releases](https://nextjs.org/blog) — the monthly programme;
  worth subscribing to.
- [Learn Next.js](https://nextjs.org/learn) — the official tutorial.
