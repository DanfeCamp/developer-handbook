---
id: seo
title: Search Engine Optimization
description: The Next.js Metadata API, dynamic OG images, sitemaps, robots, canonical URLs and structured data — plus the technical factors that actually move rankings.
---

# Search Engine Optimization

## Introduction

SEO for a developer is mostly a technical problem: can a crawler fetch the page,
render it, understand what it is about, and reach every other page? Content and
links decide rankings, but a technically broken site cannot compete at all.

Next.js helps with the parts that are structural. Server rendering means the
HTML contains the content rather than an empty `<div id="root">`; the Metadata
API generates correct `<head>` tags; and the framework handles the performance
factors that feed Core Web Vitals.

:::note Rendering matters most
Google _can_ execute JavaScript, but rendering is queued separately and can lag
by days. Other crawlers — Bing, social preview bots, LLM crawlers — do far less
of it. **Server-render anything that must be indexed.** A client-only page is
the single biggest technical SEO mistake in a React application. See
[Rendering & SSR](/knowledge-base/next-js/server-side-rendering).
:::

---

## The Metadata API

Two ways to declare metadata, and both produce real `<head>` elements in the
server-rendered HTML.

### Static metadata

```tsx title="app/layout.tsx"
import type {Metadata} from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://example.com'),
  title: {
    default: 'Acme Storefront',
    template: '%s | Acme Storefront', // child pages fill in %s
  },
  description: 'Quality hardware, delivered next day.',
  openGraph: {
    type: 'website',
    siteName: 'Acme Storefront',
    locale: 'en_GB',
  },
  twitter: {card: 'summary_large_image'},
  robots: {index: true, follow: true},
};
```

**Set `metadataBase`.** Without it, relative Open Graph and canonical URLs
resolve against `localhost` in development and are silently wrong in production
— a common and hard-to-notice failure.

The `title.template` pattern means a page exporting `title: 'Desk Lamp'`
produces `Desk Lamp | Acme Storefront` automatically.

### Dynamic metadata

```tsx title="app/products/[slug]/page.tsx"
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';

type Props = {params: Promise<{slug: string}>};

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {slug} = await params; // ← a Promise in Next.js 15+
  const product = await getProduct(slug);

  if (!product) return {title: 'Not found'};

  return {
    title: product.name,
    description: product.summary.slice(0, 155),
    alternates: {canonical: `/products/${slug}`},
    openGraph: {
      title: product.name,
      description: product.summary,
      images: [{url: product.image, width: 1200, height: 630, alt: product.name}],
      type: 'article',
    },
  };
}

export default async function Page({params}: Props) {
  const {slug} = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  return <ProductView product={product} />;
}
```

`generateMetadata` and the page can both call `getProduct` — Next.js dedupes
identical fetches within a request, so it runs once.

Metadata is **not** supported in Client Components. A page needing both metadata
and interactivity should be a Server Component that renders a client child.

### File-based metadata

Some files are picked up automatically by filename:

| File in `app/`                              | Produces         |
| ------------------------------------------- | ---------------- |
| `favicon.ico`, `icon.png`, `apple-icon.png` | Icon links       |
| `opengraph-image.png` / `.tsx`              | `og:image`       |
| `twitter-image.png` / `.tsx`                | `twitter:image`  |
| `robots.ts`                                 | `/robots.txt`    |
| `sitemap.ts`                                | `/sitemap.xml`   |
| `manifest.ts`                               | Web app manifest |

### Dynamic Open Graph images

Generate a share image per page at request time:

```tsx title="app/products/[slug]/opengraph-image.tsx"
import {ImageResponse} from 'next/og';

export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

export default async function Image({params}: {params: {slug: string}}) {
  const product = await getProduct(params.slug);

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          padding: 64,
          background: '#0b1120',
          color: 'white',
          fontSize: 64,
        }}
      >
        <div>{product.name}</div>
        <div style={{fontSize: 32, opacity: 0.7}}>{product.price}</div>
      </div>
    ),
    size,
  );
}
```

Only a subset of CSS is supported — flexbox yes, grid no — and every element
with more than one child needs an explicit `display: flex`. That last rule
causes most `ImageResponse` failures.

---

## Sitemaps and robots

```ts title="app/sitemap.ts"
import type {MetadataRoute} from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await db.product.findMany({select: {slug: true, updatedAt: true}});

  return [
    {url: 'https://example.com', lastModified: new Date(), priority: 1},
    {url: 'https://example.com/products', lastModified: new Date(), priority: 0.8},
    ...products.map((p) => ({
      url: `https://example.com/products/${p.slug}`,
      lastModified: p.updatedAt,
      priority: 0.6,
    })),
  ];
}
```

Generate it from your data rather than hand-maintaining a list — a stale sitemap
is worse than none, because it wastes crawl budget on 404s.

`changeFrequency` and `priority` are advisory and largely ignored by Google.
`lastModified` is the field that matters, and only if it is accurate.

Over 50,000 URLs or 50 MB requires splitting; Next.js supports
`generateSitemaps()` for that.

```ts title="app/robots.ts"
import type {MetadataRoute} from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {userAgent: '*', allow: '/', disallow: ['/api/', '/admin/', '/checkout/']},
    ],
    sitemap: 'https://example.com/sitemap.xml',
  };
}
```

**`robots.txt` prevents crawling, not indexing.** A blocked URL with inbound
links can still appear in results, without a description. To keep something out
of the index, let it be crawled and return `noindex`:

```tsx
export const metadata: Metadata = {robots: {index: false, follow: true}};
```

---

## Canonical URLs

Duplicate content splits ranking signals. The same product reachable at
`/products/lamp`, `/products/lamp?ref=email` and `/products/lamp/` is one page
to a human and three to a crawler.

```tsx
export const metadata: Metadata = {
  alternates: {canonical: '/products/lamp'},
};
```

Rules that avoid most trouble:

- **One canonical per page**, absolute or resolved via `metadataBase`.
- **Self-referencing canonicals are correct** and recommended.
- **Do not canonicalise every page to the homepage.** It is a common and
  damaging mistake — it asks Google to ignore the rest of your site.
- **Pick one URL shape** — trailing slash or not, `www` or not — and redirect
  the other with a 301.

For multiple languages, declare the alternates so each version is served to the
right audience:

```tsx
alternates: {
  canonical: '/products/lamp',
  languages: {'en-GB': '/en/products/lamp', 'de-DE': '/de/produkte/lampe'},
}
```

---

## Structured Data

JSON-LD tells search engines what a page _is_, and is what produces rich results
— star ratings, prices, breadcrumbs, FAQ accordions.

```tsx
export default async function ProductPage({params}) {
  const {slug} = await params;
  const product = await getProduct(slug);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.summary,
    image: product.image,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'GBP',
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}}
      />
      <ProductView product={product} />
    </>
  );
}
```

`JSON.stringify` of your own structured object is safe here. If any field can
contain user-supplied text, escape `<` to prevent breaking out of the script
tag.

The types worth implementing: `Product`, `Article`, `BreadcrumbList`,
`Organization`, `FAQPage`, `LocalBusiness`. Validate with Google's
[Rich Results Test](https://search.google.com/test/rich-results) — structured
data that does not validate does nothing at all.

**Only mark up what is visible on the page.** Marking up ratings or prices that
users cannot see is a spam policy violation.

---

## Performance and Core Web Vitals

Core Web Vitals are a ranking factor. In practice, they are a tie-breaker
between comparable pages rather than a headline signal — but they also affect
conversion, which matters more.

| Metric                              | Target   | What Next.js gives you                            |
| ----------------------------------- | -------- | ------------------------------------------------- |
| **LCP** — largest contentful paint  | < 2.5 s  | Server rendering, `next/image`, font optimisation |
| **INP** — interaction to next paint | < 200 ms | Server Components ship less JavaScript            |
| **CLS** — cumulative layout shift   | < 0.1    | `next/image` reserves space from width/height     |

Practical steps:

```tsx
import Image from 'next/image';

// Above the fold: priority disables lazy loading and preloads it.
<Image src="/hero.jpg" width={1200} height={600} alt="" priority />

// Below the fold: lazy by default.
<Image src="/product.jpg" width={400} height={400} alt="Desk lamp" />
```

```tsx title="app/layout.tsx"
import {Inter} from 'next/font/google';

// Self-hosted, preloaded, with no layout shift on swap.
const inter = Inter({subsets: ['latin'], display: 'swap'});
```

Always give `next/image` explicit `width` and `height` (or `fill` with a sized
container) — that is what prevents layout shift. Use `alt=""` for decorative
images and a real description otherwise; alt text is both an accessibility and
an SEO signal.

See [Performance](/knowledge-base/web/performance) for the wider picture.

---

## Other Technical Factors

**Semantic HTML.** One `<h1>` per page, headings in order, `<nav>`, `<main>`,
`<article>`. Crawlers use structure to work out what a page is about.

**Internal links** with real `<a>` elements (which `next/link` renders). A page
with no inbound internal links is effectively invisible, however good it is.

**Pagination.** Google
[stopped using `rel="next"`/`rel="prev"` as an indexing signal in 2019](https://developers.google.com/search/blog/2019/03/rel-next-prev). What
works now: each page has a unique URL (`/blog?page=2`), a self-referencing
canonical, and crawlable links between pages. Do not canonicalise page 2 to page
1 — it hides everything on it.

**Redirects.** Use 301 for permanent moves so ranking signals transfer. Chains
of redirects waste crawl budget.

**404 vs soft 404.** A missing page must return HTTP 404. `notFound()` does
this. Returning 200 with "not found" text is a soft 404 and pollutes the index.

**Trailing slashes.** Pick one and be consistent; `trailingSlash` in
`next.config.ts` enforces it.

---

## Do's and Don'ts

### Do

- Server-render anything that must be indexed.
- Set `metadataBase` so relative URLs resolve correctly.
- Use `title.template` for consistent titles.
- Generate the sitemap from your data.
- Add a self-referencing canonical to every page.
- Add JSON-LD for products, articles and breadcrumbs — and validate it.
- Give every `next/image` explicit dimensions and meaningful `alt` text.
- Use `priority` on the LCP image.
- Return real 404s with `notFound()`.

### Don't

- Don't render indexable content client-side only.
- Don't canonicalise every page to the homepage.
- Don't rely on `robots.txt` to keep a page out of the index — use `noindex`.
- Don't mark up structured data that is not visible on the page.
- Don't use `rel="next"`/`rel="prev"` as an indexing strategy.
- Don't put metadata exports in a Client Component; they are ignored.
- Don't leave `changeFrequency` and `priority` doing the work — `lastModified`
  is what is read.
- Don't ship a `noindex` from staging to production. It happens.

---

## Debugging

| Symptom                            | Cause and fix                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| OG image not appearing when shared | Relative URL with no `metadataBase`, or the image is behind auth. Test with the platform's debugger.     |
| Metadata export has no effect      | The file is a Client Component. Move metadata to a Server Component parent.                              |
| Page not indexed                   | Check `robots.txt`, the `robots` metadata, the canonical, and whether it is reachable by internal links. |
| Wrong title in results             | Google rewrites titles it judges unhelpful. Make it descriptive and unique.                              |
| Rich results not showing           | Validate the JSON-LD; eligibility is not guaranteed even when valid.                                     |
| `ImageResponse` throws             | An element with several children lacks `display: flex`, or an unsupported CSS property is used.          |
| Sitemap returns 404                | `sitemap.ts` must be directly in `app/`, not nested in a route group's folder.                           |

```bash
curl -s https://example.com/products/lamp | grep -i '<title>\|canonical\|og:'
```

Viewing source — not DevTools — is the check that matters: it shows what the
crawler received before any JavaScript ran. Then use Google Search Console's URL
Inspection for what Google actually saw.

---

## FAQ

**Does Google run my JavaScript?**
Yes, but on a delayed second pass. Other crawlers and social preview bots
largely do not. Server-render anything that must be indexed.

**Do Core Web Vitals really affect rankings?**
They are a real but modest signal, mostly a tie-breaker. They affect conversion
more than ranking.

**`app/sitemap.ts` or a static `sitemap.xml`?**
Generate it when URLs come from data. A static file is fine for a handful of
fixed pages.

**How do I stop staging being indexed?**
`noindex` via the `robots` metadata plus HTTP basic auth. Do not rely on
`robots.txt` alone.

**Do I need `next-seo`?**
No. It existed for the Pages Router; the App Router's Metadata API covers the
same ground natively.

**How long until changes show up?**
Days to weeks. Request indexing in Search Console for important pages, and
expect nothing immediately.

---

## Check your understanding

<Quiz
question="Open Graph images work locally but social platforms show no preview in production. metadataBase is not set. Why?"
options={[
{
text: 'Without metadataBase, relative image URLs resolve against localhost, so the production HTML contains an unreachable URL',
correct: true,
why: 'metadataBase is what relative Open Graph and canonical URLs resolve against. Unset, it falls back to the development origin — which works locally and is silently wrong in production.',
},
{text: 'Social platforms do not support Next.js dynamic OG images', why: 'They fetch a URL and read the bytes; how it was generated is irrelevant.'},
{text: 'The image must be under 1 MB', why: 'A real constraint on some platforms, but it would not produce a total absence of preview across all of them.'},
{text: 'openGraph metadata only works in the root layout', why: 'It works at any level, and page-level values override the layout.'},
]}
explanation={<>Always set <code>metadataBase</code> in the root layout. Then verify with each platform's own debugger, since they cache aggressively.</>}
reference={{label: 'Static metadata', href: '/knowledge-base/next-js/seo#static-metadata'}}
/>

<Quiz
question="A page must not appear in Google's index. Which approach actually achieves that?"
options={[
{
text: 'Allow crawling and return a noindex robots directive',
correct: true,
why: 'Google must be able to fetch the page to see the directive. Blocking it in robots.txt means the noindex is never read.',
},
{
text: 'Disallow the path in robots.txt',
why: 'That prevents crawling, not indexing. A blocked URL with inbound links can still be listed, without a description.',
},
{
text: 'Both — block it in robots.txt and add noindex',
why: 'Actively counterproductive: the robots.txt block stops Google reading the noindex, so the page can remain indexed indefinitely.',
},
{
text: 'Return a 404 for crawler user agents',
why: 'Cloaking — serving different content to crawlers than to users — is a spam policy violation.',
},
]}
explanation={<>The rule: <code>robots.txt</code> controls <em>crawling</em>, meta robots controls <em>indexing</em>. To remove something from the index it must remain crawlable.</>}
reference={{label: 'Sitemaps and robots', href: '/knowledge-base/next-js/seo#sitemaps-and-robots'}}
/>

<Quiz
question="Which of these are correct uses of canonical URLs?"
type="multiple"
options={[
{text: 'A self-referencing canonical on every indexable page', correct: true, why: 'Recommended practice. It removes ambiguity when tracking parameters or trailing-slash variants appear.'},
{text: 'Pointing ?ref=email and ?utm_source=x variants at the clean URL', correct: true, why: 'Exactly the duplicate-content problem canonicals exist to solve.'},
{text: 'Canonicalising every page to the homepage', why: 'Tells Google to ignore the rest of the site. A genuinely damaging and surprisingly common mistake.'},
{text: 'Pointing page 2 of a paginated list at page 1', why: 'Hides everything on page 2 from the index. Each page should self-canonicalise.'},
{text: 'Declaring language alternates alongside the canonical', correct: true, why: 'Tells search engines which localised version to serve to which audience.'},
]}
explanation={<>Canonicals consolidate signals across genuinely duplicate URLs. Using them to collapse <em>distinct</em> pages removes those pages from search.</>}
reference={{label: 'Canonical URLs', href: '/knowledge-base/next-js/seo#canonical-urls'}}
/>

<Quiz
question="A product page exports `metadata` but no tags appear in the HTML. The file begins with 'use client'. What is the fix?"
options={[
{
text: 'Metadata exports are ignored in Client Components — make the page a Server Component and move the interactive part into a child',
correct: true,
why: 'The Metadata API runs on the server during rendering. A Client Component has no server phase in which to contribute head tags.',
},
{text: 'Use next/head instead', why: 'next/head is a Pages Router API and does not work in the App Router.'},
{text: 'Export generateMetadata instead of metadata', why: 'Both are equally unsupported in a Client Component.'},
{text: 'Add metadataBase to next.config.ts', why: 'metadataBase affects URL resolution, not whether metadata is emitted at all.'},
]}
explanation={<>The general pattern: keep the page a Server Component and push <code>'use client'</code> down to the smallest interactive leaf. That preserves metadata, streaming and a smaller bundle.</>}
reference={{label: 'Dynamic metadata', href: '/knowledge-base/next-js/seo#dynamic-metadata'}}
/>

<Quiz
question="A React SPA is being migrated to Next.js specifically to fix poor search visibility. Which change matters most?"
options={[
{
text: 'Server-rendering the content so the HTML response already contains it',
correct: true,
why: 'A client-only page returns a near-empty document. Google renders JavaScript on a delayed second pass and other crawlers largely do not, so the content may be invisible for days or entirely.',
},
{text: 'Adding structured data to every page', why: 'Valuable for rich results, but it cannot help if there is no indexable content to describe.'},
{text: 'Improving Core Web Vitals', why: 'A real but modest ranking signal, and mostly a tie-breaker between comparable pages.'},
{text: 'Generating a sitemap', why: 'Helps discovery, but a discovered page with no server-rendered content still has nothing to index.'},
]}
explanation={<>Check it the way a crawler does: <code>curl</code> the URL and look at the raw HTML. If the content is not there, nothing else on this page will help.</>}
reference={{label: 'Introduction', href: '/knowledge-base/next-js/seo#introduction'}}
/>

---

## References

- [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
  — every supported field.
- [Metadata file conventions](https://nextjs.org/docs/app/api-reference/file-conventions/metadata)
  — `sitemap.ts`, `robots.ts`, `opengraph-image`.
- [Google Search Central: SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
  — the authoritative source on what Google actually uses.
- [Google: rel=prev/next is not an indexing signal](https://developers.google.com/search/blog/2019/03/rel-next-prev)
  — why the old pagination advice is obsolete.
- [Schema.org](https://schema.org/) and the
  [Rich Results Test](https://search.google.com/test/rich-results).
- [web.dev: Core Web Vitals](https://web.dev/articles/vitals) — definitions and
  thresholds.
