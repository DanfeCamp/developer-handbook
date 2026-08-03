---
id: best-practices
title: Best Practices
description: Production-ready practices for Next.js App Router projects, current as of Next.js 16.
---

# Best Practices

These practices target the **App Router** on **Next.js 16**, the current stable
release. Where behaviour changed in recent versions, the change is called out so
you can tell whether an older tutorial you find elsewhere still applies.

:::info Version baseline
Next.js 16 requires **Node.js 20.9+** and **TypeScript 5.1+**, and uses
**Turbopack** for `next dev` and `next build` by default.
:::

## Routing and project structure

- **Use the App Router for new projects.** Routes live in `app/`, where a folder
  becomes a URL segment and `page.tsx` makes it publicly routable. The older
  `pages/` directory (the Pages Router) is still supported, but new framework
  features land in the App Router first.
- **Keep components close to where they are used.** Only `page`, `layout`,
  `route`, `loading`, `error` and a handful of other reserved filenames become
  routes, so co-locating a `components/` folder inside a route segment is safe.
- **Use route groups to organise without affecting URLs.** A folder wrapped in
  parentheses — `(marketing)` — groups routes for layout purposes but
  contributes nothing to the path.

## Server and Client Components

Components are **Server Components by default**. Reach for `'use client'` only
when a component needs browser-only capability: state, effects, event handlers,
or direct DOM/browser API access.

- **Push `'use client'` as far down the tree as possible.** Marking a top-level
  layout as a Client Component opts its entire subtree into client rendering,
  inflating the bundle and discarding the benefits of server rendering. See
  [Common Mistakes](./common-mistakes.md) for a worked example.
- **Server Components can be `async`.** Fetch directly in the component rather
  than threading data through props or a client-side effect.
- **Never import server-only secrets into a Client Component.** Anything
  imported by a Client Component ships to the browser.

## Data fetching

:::warning Pages Router APIs do not exist in the App Router
`getStaticProps`, `getServerSideProps` and `getStaticPaths` are **Pages Router**
APIs. In the App Router you fetch directly inside a Server Component, and
control caching with `fetch` options, `cacheLife`/`cacheTag`, or
`generateStaticParams` for static route generation.
:::

```tsx title="app/products/[id]/page.tsx"
// `params` is a Promise in Next.js 16 — see the async request APIs note below.
export default async function ProductPage({
  params,
}: {
  params: Promise<{id: string}>;
}) {
  const {id} = await params;

  const res = await fetch(`https://api.example.com/products/${id}`, {
    // Opt this request into caching, revalidating at most once an hour.
    next: {revalidate: 3600, tags: [`product-${id}`]},
  });

  if (!res.ok) {
    throw new Error(`Failed to load product ${id}`);
  }

  const product = await res.json();
  return <h1>{product.title}</h1>;
}
```

- **Be explicit about caching.** Use `next: {revalidate}` for time-based
  revalidation and `tags` so you can invalidate precisely later.
- **Pre-render known dynamic routes** with `generateStaticParams`.
- **Invalidate deliberately.** `revalidateTag(tag, profile)` marks data stale
  (readers may briefly see stale content); `updateTag(tag)` in a Server Action
  gives read-your-writes semantics so a user immediately sees their own change.

## Async request APIs (breaking change)

`cookies()`, `headers()`, `draftMode()`, `params` and `searchParams` are
**asynchronous only** as of Next.js 16 — synchronous access was removed.

```tsx
import {cookies, headers} from 'next/headers';

export default async function Page() {
  const cookieStore = await cookies();
  const headerList = await headers();

  const theme = cookieStore.get('theme')?.value;
  const agent = headerList.get('user-agent');
  // ...
}
```

This one bites quietly: a project can **build cleanly** and only fail on the
first real request to an affected route. Run
`npx @next/codemod@canary upgrade latest` when upgrading, and
`npx next typegen` to generate the `PageProps` / `LayoutProps` / `RouteContext`
type helpers.

## Images

Use `next/image` — it handles responsive `srcset`, lazy loading and modern
formats. Several defaults tightened in Next.js 16:

| Setting            | Old default   | Next.js 16 default |
| ------------------ | ------------- | ------------------ |
| `minimumCacheTTL`  | 60 seconds    | 4 hours            |
| `qualities`        | all allowed   | `[75]`             |
| `maximumRedirects` | unlimited     | 3                  |
| `imageSizes`       | included `16` | `16` removed       |

Prefer `images.remotePatterns` over the deprecated `images.domains`, and always
set `width`/`height` (or `fill` with a sized parent) to avoid layout shift.

## Performance

- **Let Turbopack do its job.** It is the default in Next.js 16; a custom
  `webpack` config now causes `next build` to fail unless you pass `--webpack`.
- **Consider the React Compiler.** Stable in Next.js 16 via `reactCompiler: true`,
  it memoizes automatically. Expect slower builds, since it relies on Babel.
- **Use `next/dynamic`** for genuinely heavy, below-the-fold client components.
- **Measure with real tools.** Next.js 16 removed the `size` / `First Load JS`
  columns from build output because they misrepresented Server Component
  architectures. Use Lighthouse or field data instead.

## Configuration and environment

- **Use environment variables, not runtime config.** `serverRuntimeConfig` and
  `publicRuntimeConfig` were **removed** in Next.js 16.
- **Prefix browser-visible values with `NEXT_PUBLIC_`.** Everything else stays
  server-side.
- **Reading env vars at runtime rather than build time?** Call `connection()`
  before touching `process.env`.

## Do's and Don'ts

| ✅ Do                                                | ❌ Don't                                             |
| ---------------------------------------------------- | ---------------------------------------------------- |
| Await `params`, `searchParams`, `cookies`, `headers` | Access them synchronously — removed in v16           |
| Fetch inside Server Components                       | Reach for `getServerSideProps` in the App Router     |
| Put `'use client'` at the leaves                     | Mark a root layout as a Client Component             |
| Use `images.remotePatterns`                          | Use the deprecated `images.domains`                  |
| Name the file `proxy.ts`                             | Keep `middleware.ts` — deprecated and renamed in v16 |
| Run ESLint/Biome directly                            | Rely on `next lint` — removed in v16                 |

## Testing

- **Unit and component tests:** Vitest or Jest with React Testing Library.
- **End-to-end:** Playwright or Cypress. E2E is especially valuable here because
  it exercises the real server/client boundary, which unit tests mock away.
- **Async Server Components** are not fully supported by React Testing Library;
  cover those with E2E tests instead.

<Quiz
question="You are migrating a Next.js 15 App Router page to Next.js 16. The build succeeds with no errors. What should you still verify?"
options={[
{
text: 'That every access to params, searchParams, cookies() and headers() is awaited',
correct: true,
why: 'Synchronous access was removed in v16, but the failure surfaces on the first request to the route rather than at build time.',
},
{
text: 'Nothing — a clean build means the migration is complete',
why: 'The upgrade guide explicitly warns that these routes build cleanly and fail at request time.',
},
{
text: 'That you replaced getServerSideProps with getStaticProps',
why: 'Neither exists in the App Router; both are Pages Router APIs.',
},
{
text: 'That you enabled the --turbopack flag',
why: 'Turbopack is the default in Next.js 16, so the flag is no longer needed.',
},
]}
explanation={<>Async request APIs are the most common silent breakage when upgrading. Run <code>npx @next/codemod@canary upgrade latest</code>, then exercise each route.</>}
reference={{label: 'Async request APIs', href: '/knowledge-base/next-js/best-practices'}}
/>

## References

- [Next.js Documentation](https://nextjs.org/docs)
- [Upgrading to Version 16](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Caching and Revalidating](https://nextjs.org/docs/app/guides/caching)
- [`next/image` API reference](https://nextjs.org/docs/app/api-reference/components/image)
