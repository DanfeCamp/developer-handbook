---
id: folder-structure
title: Folder Structure
description: App Router file conventions, route groups, private folders and parallel routes — plus a project layout that scales past a few dozen files.
---

# Folder Structure

## Introduction

Next.js has two kinds of structure, and confusing them causes most of the
questions on this topic:

1. **Routing conventions**, which Next.js defines and you must follow. A
   `page.tsx` in `app/blog/` produces `/blog`, and nothing else does.
2. **Project organisation**, which is entirely yours. Where components, hooks
   and utilities live is a matter of taste and scale.

This page covers the conventions first, because they are not negotiable, then
offers a layout for the rest.

---

## Routing Conventions

### Special files

Inside `app/`, these filenames have defined meanings. Everything else is just a
file.

| File               | Role                                                    |
| ------------------ | ------------------------------------------------------- |
| `page.tsx`         | Makes the segment publicly routable                     |
| `layout.tsx`       | Shared shell; **state is preserved across navigation**  |
| `template.tsx`     | Like a layout, but remounts on every navigation         |
| `loading.tsx`      | Suspense fallback for the segment and its children      |
| `error.tsx`        | Error boundary for the segment (must be `'use client'`) |
| `global-error.tsx` | Catches errors in the root layout itself                |
| `not-found.tsx`    | Rendered by `notFound()`                                |
| `route.ts`         | An HTTP endpoint instead of a page                      |
| `default.tsx`      | Fallback for an unmatched parallel route slot           |

The distinction between `layout.tsx` and `template.tsx` matters more than it
looks: a layout does **not** remount when you navigate between its children, so
scroll position, form state and animations persist. A template remounts every
time, which is what you want for an entry animation or a per-page analytics
event.

```text
app/
├── layout.tsx              → wraps everything (required)
├── page.tsx                → /
├── loading.tsx             → fallback for /
├── not-found.tsx
├── blog/
│   ├── layout.tsx          → wraps /blog and everything under it
│   ├── page.tsx            → /blog
│   ├── loading.tsx
│   └── [slug]/
│       └── page.tsx        → /blog/:slug
└── api/
    └── orders/
        └── route.ts        → /api/orders
```

Layouts nest, so `/blog/hello` renders the root layout, then the blog layout,
then the page.

### Dynamic segments

| Pattern       | Matches                 | `params`                        |
| ------------- | ----------------------- | ------------------------------- |
| `[slug]`      | `/blog/hello`           | `{slug: 'hello'}`               |
| `[...slug]`   | `/docs/a/b/c`           | `{slug: ['a','b','c']}`         |
| `[[...slug]]` | `/docs` and `/docs/a/b` | `{slug: undefined}` or an array |

```tsx title="app/blog/[slug]/page.tsx"
export default async function Post({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params; // ← a Promise in Next.js 15+
  return <article>{slug}</article>;
}
```

### Route groups

A folder in parentheses organises files **without adding a URL segment**:

```text
app/
├── (marketing)/
│   ├── layout.tsx          → applies to about and pricing only
│   ├── about/page.tsx      → /about       (no "marketing" in the URL)
│   └── pricing/page.tsx    → /pricing
└── (app)/
    ├── layout.tsx          → a different shell: sidebar, auth guard
    └── dashboard/page.tsx  → /dashboard
```

This is the idiomatic way to give different sections different layouts. A
marketing site with a public header and an application with a sidebar are two
groups, each with its own root-level layout, and neither leaks into the other's
URLs.

### Private folders

A folder prefixed with an underscore is excluded from routing entirely:

```text
app/
├── _components/    → never routable, no matter what is inside
├── _lib/
└── dashboard/page.tsx
```

Useful when you want to colocate implementation files inside `app/` without any
risk of them becoming routes.

### Colocation

Next.js only treats `page.tsx` and `route.ts` as routable, so **any other file
inside a route folder is safe**:

```text
app/dashboard/
├── page.tsx            → /dashboard
├── layout.tsx
├── DashboardChart.tsx  ← not routable
├── useMetrics.ts       ← not routable
└── page.test.tsx       ← not routable
```

Colocating a component with the only route that uses it is usually better than
a distant `components/` directory. Promote it out when a second route needs it.

### Parallel and intercepting routes

Two advanced conventions worth recognising when you meet them.

**Parallel routes** (`@folder`) render several independent subtrees into one
layout, each with its own loading and error states:

```text
app/dashboard/
├── layout.tsx        → receives `analytics` and `team` as props
├── @analytics/page.tsx
├── @team/page.tsx
└── page.tsx
```

```tsx
export default function Layout({children, analytics, team}) {
  return (
    <>
      {children}
      <div className="grid">
        {analytics}
        {team}
      </div>
    </>
  );
}
```

**Intercepting routes** (`(.)`, `(..)`, `(...)`) render a different component
for a route depending on how it was reached — the classic case being a photo
that opens as a modal when clicked from a feed, but as a full page when the URL
is loaded directly.

```text
app/feed/
├── page.tsx
├── @modal/(.)photo/[id]/page.tsx   → modal, when navigated from the feed
└── photo/[id]/page.tsx             → full page, on direct load
```

Both are genuinely useful and both add real complexity. Reach for them when you
have the specific problem they solve, not by default.

### Route segment config

Exported constants that change how a segment behaves:

```tsx
export const dynamic = 'force-static'; // or 'force-dynamic', 'auto'
export const revalidate = 3600; // ISR window in seconds
export const runtime = 'nodejs'; // or 'edge'
export const dynamicParams = true; // allow params not returned by generateStaticParams
```

---

## Project Organisation

The routing conventions above are fixed. Everything below is a recommendation.

### A layout that scales

```text
my-app/
├── app/                          ← routing only
│   ├── layout.tsx
│   ├── page.tsx
│   ├── (marketing)/
│   │   ├── about/page.tsx
│   │   └── pricing/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx
│   │   └── dashboard/
│   │       ├── page.tsx
│   │       ├── loading.tsx
│   │       └── DashboardChart.tsx    ← colocated, single-use
│   └── api/
│       └── webhooks/stripe/route.ts
│
├── features/                     ← the application itself
│   ├── checkout/
│   │   ├── components/
│   │   ├── actions.ts            ← 'use server' mutations
│   │   ├── queries.ts            ← data access
│   │   ├── schema.ts             ← Zod schemas
│   │   └── index.ts              ← public surface of the feature
│   └── orders/
│
├── components/
│   └── ui/                       ← generic: Button, Input, Dialog
│
├── lib/
│   ├── db.ts
│   ├── auth.ts
│   └── utils.ts
│
├── hooks/                        ← shared client hooks
├── types/                        ← shared domain types
├── public/                       ← served as-is at the root
├── proxy.ts                      ← was middleware.ts before v16
├── next.config.ts
└── tsconfig.json
```

The organising principle: **`app/` is for routing, `features/` is for the
application.** A route file should mostly compose things from elsewhere. When
`app/` starts filling with business logic, the structure has drifted.

### Why not `containers/`?

The `containers/` convention comes from the Redux era, where the split was
between components that connected to a store and components that did not. With
Server Components the meaningful boundary is different — server versus client —
and it does not map onto a directory. Group by feature instead.

### Naming

Pick one convention and enforce it with a lint rule:

- `PascalCase.tsx` for components — the common choice.
- `kebab-case.ts` for everything else.
- Route folders are always lowercase and hyphenated, because they are URLs.

Case matters more than it looks: macOS and Windows are case-insensitive by
default, Linux is not, so `Components/Button` importing fine locally and 500ing
in production is a routine PHP-and-JavaScript failure alike.

### Path aliases

```json title="tsconfig.json"
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

```ts
import {Button} from '@/components/ui/Button';
```

Absolute imports remove `../../../` chains and make files movable without
rewriting every import.

### Enforcing boundaries

Once you have a `features/` directory, keep features from importing each
other's internals. An `index.ts` per feature declares its public surface, and
ESLint can enforce it:

```js title="eslint.config.js (excerpt)"
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['@/features/*/*'],
    message: 'Import from the feature root (@/features/x), not its internals.',
  }],
}],
```

Without something enforcing it, the boundary erodes within a few sprints.

---

## Do's and Don'ts

### Do

- Keep `app/` for routing; put application logic in `features/`.
- Use route groups to give sections different layouts.
- Colocate single-use components with their route.
- Use `_private` folders for non-routable files inside `app/`.
- Use path aliases.
- Choose one naming convention and lint it.
- Add `loading.tsx` and `error.tsx` at meaningful boundaries.

### Don't

- Don't create a `components/` folder holding 200 unrelated files.
- Don't use `containers/` — it is a Redux-era split that no longer maps to
  anything.
- Don't put a `page.tsx` and a `route.ts` in the same folder.
- Don't reach for parallel or intercepting routes without the specific problem.
- Don't rely on filesystem case-insensitivity.
- Don't nest folders more deeply than the URL requires.

---

## FAQ

**Where do Server Actions live?**
In a `actions.ts` inside the feature that owns them, marked `'use server'`.
Colocating them with the route that calls them is also fine for single-use
actions.

**Can I keep using `pages/`?**
Yes, and both routers can coexist during a migration. New routes should be in
`app/`.

**Should tests sit in `__tests__` or next to the file?**
Next to the file. Distance from the subject is what makes tests rot.

**`src/` or not?**
Next.js supports `src/app/`. It keeps the repository root tidier; it makes no
functional difference. Pick one and be consistent.

**Does folder depth affect performance?**
No. It affects how quickly a person finds things, which matters more.

---

## Check your understanding

<Quiz
question="You need /about and /pricing to share a marketing layout, while /dashboard uses a completely different shell. Neither URL should contain the grouping name. What is the right convention?"
options={[
{
text: 'Route groups: app/(marketing)/about/page.tsx and app/(app)/dashboard/page.tsx, each group with its own layout.tsx',
correct: true,
why: 'Parentheses group files for layout purposes without contributing a URL segment, which is exactly this requirement.',
},
{
text: 'Private folders: app/_marketing/about/page.tsx',
why: 'An underscore excludes the folder from routing entirely, so /about would not exist at all.',
},
{
text: 'Put both layouts in the root layout and branch on the pathname',
why: 'Workable but poor: one layout that conditionally renders two shells, re-running on every navigation and hard to keep clean.',
},
{
text: 'Parallel routes with @marketing and @app slots',
why: 'Parallel routes render several subtrees simultaneously in one layout. These are alternative sections, not simultaneous ones.',
},
]}
explanation={<>Route groups are the most useful App Router convention for real projects, and the least obvious from the filenames alone.</>}
reference={{label: 'Route groups', href: '/knowledge-base/next-js/folder-structure#route-groups'}}
/>

<Quiz
question="A form's input value resets every time the user navigates between two sibling routes under the same section. The shared shell is defined in template.tsx. Why?"
options={[
{
text: 'A template remounts on every navigation; a layout does not',
correct: true,
why: 'That is the defining difference. Layouts persist across navigation between their children, preserving state; templates create a new instance every time.',
},
{text: 'Sibling routes always remount their shared shell', why: 'Only with a template. A layout is preserved.'},
{text: 'Form state must be lifted into a Server Component', why: 'Server Components cannot hold interactive state at all.'},
{text: 'The routes need a shared loading.tsx', why: 'loading.tsx controls the Suspense fallback, not whether the shell remounts.'},
]}
explanation={<>Use <code>template.tsx</code> deliberately — for an entry animation or a per-navigation effect. Use <code>layout.tsx</code> everywhere else.</>}
reference={{label: 'Special files', href: '/knowledge-base/next-js/folder-structure#special-files'}}
/>

<Quiz
question="Which of these files inside app/dashboard/ create a routable URL?"
type="multiple"
options={[
{text: 'page.tsx', correct: true, why: 'The only file that makes a segment publicly routable as a page.'},
{text: 'route.ts', correct: true, why: 'Creates an HTTP endpoint at that path — and conflicts with page.tsx in the same folder.'},
{text: 'DashboardChart.tsx', why: 'Colocated component. Only page.tsx and route.ts are routable, so any other file is safe to keep here.'},
{text: 'layout.tsx', why: 'Wraps the segment’s pages; it does not itself produce a URL.'},
{text: 'loading.tsx', why: 'A Suspense fallback for the segment, not a route.'},
]}
explanation={<>Because only two filenames are routable, colocation is safe — you can keep components, hooks and tests beside the route that uses them.</>}
reference={{label: 'Colocation', href: '/knowledge-base/next-js/folder-structure#colocation'}}
/>

<Quiz
question="A team is deciding between organising by type (components/, hooks/, utils/) and by feature (features/checkout/, features/orders/). Which argument for feature folders is strongest at scale?"
options={[
{
text: 'A change to one feature touches one directory, and deleting a feature is deleting a folder',
correct: true,
why: 'Cohesion. Type-based folders scatter every feature across four directories, so nobody can see a feature’s full extent or safely remove it.',
},
{
text: 'Feature folders produce smaller JavaScript bundles',
why: 'Bundling follows the import graph, not the directory layout.',
},
{
text: 'Next.js requires feature folders for the App Router',
why: 'Next.js only constrains app/. Everything else is your choice.',
},
{
text: 'Type-based folders break path aliases',
why: 'Aliases work identically with either layout.',
},
]}
explanation={<>The counterpart rule: promote something into <code>components/ui/</code> when a <em>second</em> feature needs it, not in anticipation.</>}
reference={{label: 'A layout that scales', href: '/knowledge-base/next-js/folder-structure#a-layout-that-scales'}}
/>

<Quiz
question="You want to keep helper components inside app/ but are worried they might accidentally become routes. What guarantees they cannot?"
options={[
{
text: 'Nothing extra is needed — only page.tsx and route.ts are routable — but an underscore-prefixed folder makes the intent explicit and excludes the whole subtree',
correct: true,
why: 'Colocation is already safe. A _private folder additionally signals intent and removes any doubt for files added later.',
},
{
text: 'Adding them to .gitignore',
why: 'Git has no bearing on routing, and the files need to be committed.',
},
{
text: 'Wrapping the folder name in parentheses',
why: 'A route group organises without adding a URL segment — its contents are still routable.',
},
{
text: 'Exporting them as named rather than default exports',
why: 'Export style does not affect routing; the filename does.',
},
]}
explanation={<>Parentheses and underscores are easily confused: <code>(group)</code> organises but stays routable, <code>_private</code> removes the subtree from routing entirely.</>}
reference={{label: 'Private folders', href: '/knowledge-base/next-js/folder-structure#private-folders'}}
/>

---

## References

- [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure)
  — the official conventions reference.
- [Route groups](https://nextjs.org/docs/app/building-your-application/routing/route-groups)
  — layouts per section.
- [Parallel routes](https://nextjs.org/docs/app/building-your-application/routing/parallel-routes)
  and [intercepting routes](https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes).
- [Route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
  — `dynamic`, `revalidate`, `runtime`.
- [Component Design](/knowledge-base/react-js/component-design#file-and-folder-organisation)
  — the same feature-folder argument, framework-independent.
