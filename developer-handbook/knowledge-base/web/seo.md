---
title: 'SEO'
description: 'Technical search engine optimisation for developers — crawling, rendering, indexing, canonicals, structured data, and optimising for AI answer engines.'
---

# SEO

## Introduction

Search engine optimisation splits into three parts: **technical** (can a crawler
fetch, render and understand the page?), **content** (is it worth ranking?) and
**off-page** (does anyone link to it?).

**This page covers the technical part**, because that is the developer's job and
because it is a prerequisite: excellent content on a page that cannot be crawled
ranks nowhere.

**The pipeline every page must survive:**

```text
Discover → Crawl → Render → Index → Rank → Display
```

A failure at any stage means everything downstream never happens. Most technical
SEO work is making sure nothing breaks in the first four.

**What changed recently.** A growing share of search now happens through AI
answer engines — Google's AI Overviews, ChatGPT search, Perplexity — which
summarise rather than link. The technical foundations are the same (they still
need to fetch and parse your content), but the outcome is increasingly a cited
answer rather than a click. There is a section on this
[below](#ai-answer-engines).

For framework-specific implementation, see
[Next.js SEO](/knowledge-base/next-js/seo).

---

## Crawling

**`robots.txt` controls crawling, not indexing.** This distinction causes real
mistakes.

```text title="robots.txt"
User-agent: *
Disallow: /admin/
Disallow: /checkout/
Allow: /

Sitemap: https://example.com/sitemap.xml
```

A URL blocked here can **still appear in results** if other pages link to it —
listed without a description, because the crawler was never allowed to look. To
keep a page out of the index, let it be crawled and return `noindex`:

```html
<meta name="robots" content="noindex, follow" />
```

**Blocking a page in `robots.txt` _and_ adding `noindex` is actively
counterproductive**: the crawler cannot fetch the page, so it never sees the
directive, and the page can remain indexed indefinitely.

**Crawl budget** matters only at scale — tens of thousands of URLs. If it
applies to you, the wins are: avoid infinite URL spaces (faceted filters
generating unbounded combinations), fix redirect chains, remove soft 404s, and
keep `lastmod` in the sitemap accurate.

### Sitemaps

```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/products/desk-lamp</loc>
    <lastmod>2026-08-03</lastmod>
  </url>
</urlset>
```

- **Generate it from your data.** A stale sitemap wastes crawl budget on 404s.
- **`lastmod` is the field that matters** — and only if it is accurate. Google
  largely ignores `changefreq` and `priority`.
- **Include only canonical, indexable URLs.** Listing a `noindex` page sends
  contradictory signals.
- Split above 50,000 URLs or 50 MB, with a sitemap index.

---

## Rendering

**The most consequential technical decision**, and where JavaScript applications
most often fail.

Google renders JavaScript, but in a **second pass** that is queued separately
and can lag by days. Other crawlers — Bing, social preview bots, and most AI
crawlers — do far less of it, and several do none.

| Approach                  | Indexable immediately | Suits                                     |
| ------------------------- | --------------------- | ----------------------------------------- |
| **Static (SSG)**          | ✅                    | Content that changes rarely               |
| **Server-rendered (SSR)** | ✅                    | Personalised or frequently changing pages |
| **Client-rendered (CSR)** | ❌ Delayed or never   | Behind a login, where SEO is irrelevant   |

**Check it the way a crawler does:**

```bash
curl -s https://example.com/products/lamp | grep -i "<h1>\|<title>"
```

If your content is not in that output, it is not reliably indexable. **View
Source, not DevTools** — the Elements panel shows the post-JavaScript DOM, which
is not what a crawler necessarily receives.

Then use **Search Console's URL Inspection → Test Live URL → View Crawled Page**
to see what Google actually rendered.

---

## Indexing and Canonicals

Duplicate content splits ranking signals across URLs that should be one page.

```html
<link rel="canonical" href="https://example.com/products/desk-lamp" />
```

The rules:

- **Self-referencing canonicals on every indexable page.** Recommended, and it
  removes ambiguity when tracking parameters appear.
- **Point variants at the canonical** — `?utm_source=`, `?ref=`, session
  parameters, print views.
- **Never canonicalise everything to the homepage.** A genuinely damaging
  mistake that asks Google to ignore the rest of your site.
- **Never canonicalise page 2 of a list to page 1.** It hides everything on it.
- **Pick one URL shape** — trailing slash or not, `www` or not, `http` or
  `https` — and 301-redirect the rest.

**A canonical is a hint, not a directive.** Google may choose a different URL if
your signals conflict — for instance if the canonical target is `noindex`, or
internal links point elsewhere. Search Console reports the URL it actually
selected.

### Pagination

Google [stopped using `rel="next"`/`rel="prev"` as an indexing signal in
2019](https://developers.google.com/search/blog/2019/03/rel-next-prev). What
works now:

- Each page has a unique, crawlable URL.
- Each self-canonicalises.
- Pages link to each other with real `<a href>` elements.
- Do not `noindex` deeper pages if their content matters.

### International

```html
<link rel="alternate" hreflang="en-gb" href="https://example.com/en-gb/lamp" />
<link rel="alternate" hreflang="de-de" href="https://example.com/de-de/lampe" />
<link rel="alternate" hreflang="x-default" href="https://example.com/lamp" />
```

`hreflang` must be **reciprocal** — every version links to every other,
including itself — or Google ignores the set. This is the commonest
implementation error.

---

## Structured Data

JSON-LD tells search engines what a page _is_, and drives rich results: star
ratings, prices, breadcrumbs, FAQ accordions.

```html
<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Desk Lamp",
    "image": "https://example.com/lamp.jpg",
    "offers": {
      "@type": "Offer",
      "price": "24.99",
      "priceCurrency": "GBP",
      "availability": "https://schema.org/InStock"
    },
    "aggregateRating": {"@type": "AggregateRating", "ratingValue": "4.6", "reviewCount": 128}
  }
</script>
```

Worth implementing: `Product`, `Article`, `BreadcrumbList`, `Organization`,
`FAQPage`, `LocalBusiness`, `Event`, `Recipe`.

- **Validate it.** Invalid structured data does nothing at all —
  [Rich Results Test](https://search.google.com/test/rich-results).
- **Only mark up what is visible on the page.** Marking up ratings or prices
  users cannot see is a spam policy violation and has attracted manual actions.
- **JSON-LD is the preferred format** — microdata and RDFa work and are harder
  to maintain.
- **Rich results are never guaranteed**, even with valid markup.

Structured data is also increasingly how AI answer engines extract facts, which
raises its value beyond rich snippets.

---

## On-Page Signals

The parts that are still markup rather than content strategy.

```html
<title>Desk Lamp — Adjustable LED | Acme</title>
<meta name="description" content="A 4.6-star adjustable LED desk lamp with…" />
```

- **`<title>`** is the strongest on-page signal. Unique per page, front-load the
  distinguishing words, roughly 50–60 characters before truncation. Google
  rewrites titles it judges unhelpful — usually a sign the original was vague or
  keyword-stuffed.
- **Meta description** is **not a ranking factor**, but it is the snippet users
  decide on. Write it as ad copy, around 150–160 characters.
- **One `<h1>`**, describing the page. Headings in order, chosen by meaning.
- **Descriptive `alt` text** — an accessibility requirement that also feeds
  image search. `alt=""` for decorative images.
- **Internal links with real `<a href>`** and descriptive anchor text. A page
  with no internal links is effectively invisible however good it is.
- **Clean URLs**: `/products/desk-lamp`, not `/p?id=8827`.

---

## Core Web Vitals

A genuine ranking signal, and in practice a **tie-breaker between comparable
pages** rather than a headline factor. The effect on conversion is usually
larger than the effect on ranking.

Targets, at the 75th percentile: **LCP ≤ 2.5 s**, **INP ≤ 200 ms**,
**CLS ≤ 0.1**. Full treatment in
[Performance](/knowledge-base/web/performance).

**Mobile-first indexing** means Google indexes the mobile version. If your
mobile site hides content, that content is not indexed.

---

## AI Answer Engines

A meaningful and growing share of queries now end in a generated answer that
cites sources rather than a list of links. Practical implications:

- **The technical foundations are unchanged** — crawlers still need to fetch and
  parse your content, and most render less JavaScript than Google does. **Server
  rendering matters more, not less.**
- **Clear structure helps extraction.** Direct answers near the top, semantic
  headings, and definition-style sentences are easier to quote.
- **Structured data is being used to extract facts**, not only to draw rich
  snippets.
- **Freshness signals** — accurate `lastmod`, visible publication dates — help
  models judge currency.
- **You may get citations without clicks.** Brand visibility becomes part of the
  return, and click-through rates on informational queries have fallen.

You can control participation through `robots.txt` directives for specific AI
crawlers (`GPTBot`, `ClaudeBot`, `PerplexityBot` and others), which is a
commercial decision rather than a technical one.

---

## Migrations

The highest-risk SEO event, and where traffic is most often lost permanently.

- **301 redirect every old URL** to its closest equivalent. A 302 does not pass
  ranking signals the same way.
- **Map URLs before launch**, not after. Export every indexed URL from Search
  Console and crawl the old site.
- **Avoid redirect chains.** A → B → C loses signal and wastes crawl budget.
- **Never redirect everything to the homepage.** Google treats mass homepage
  redirects as soft 404s and drops the pages.
- **Keep the old sitemap available** briefly so the crawler discovers the
  redirects.
- **Expect a temporary dip.** Recovery typically takes weeks; a permanent loss
  usually means a mapping error.

---

## Do's and Don'ts

### Do

- Server-render anything that must be indexed.
- Self-canonicalise every indexable page.
- Generate sitemaps from data, with accurate `lastmod`.
- Use `noindex` — not `robots.txt` — to keep a page out of the index.
- Add and validate JSON-LD for products, articles and breadcrumbs.
- Write unique, specific titles.
- Link internally with real anchors and descriptive text.
- 301 redirect on migration, mapping URLs individually.
- Verify with `curl` and Search Console rather than assuming.

### Don't

- Don't rely on client-side rendering for indexable content.
- Don't combine `robots.txt` blocking with `noindex`.
- Don't canonicalise everything to the homepage.
- Don't mark up structured data that is not visible.
- Don't use `rel="next"`/`rel="prev"` as an indexing strategy.
- Don't hide content on mobile that should be indexed.
- Don't chain redirects.
- Don't keyword-stuff titles; Google rewrites them.
- Don't ship a staging `noindex` to production.

---

## Debugging

| Symptom                          | Cause and fix                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Page not indexed                 | Check `robots` meta, `robots.txt`, the canonical, and whether internal links reach it. |
| Indexed without a description    | Blocked in `robots.txt` — the crawler could not read it.                               |
| Content missing from the index   | Client-rendered. Check `curl` output, not DevTools.                                    |
| Wrong title in results           | Google rewrote it. Make it specific and non-repetitive.                                |
| Traffic dropped after a redesign | Redirect mapping. Check for chains and homepage redirects.                             |
| Rich results not appearing       | Validate the JSON-LD; eligibility is never guaranteed.                                 |
| Duplicate content warnings       | Missing or inconsistent canonicals; parameter variants.                                |
| `hreflang` ignored               | Not reciprocal. Every version must link to every other, including itself.              |
| Sitemap errors                   | Non-canonical, `noindex` or 404 URLs listed.                                           |

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://example.com/old-page
curl -s https://example.com/page | grep -i 'canonical\|robots\|<title>'
```

---

## FAQ

**How long until changes show?**
Days to weeks. Request indexing in Search Console for important pages, and
expect nothing immediate.

**Does Google run my JavaScript?**
Yes, on a delayed second pass. Other crawlers and most AI crawlers do far less.
Server-render anything that must be indexed.

**Is the meta description a ranking factor?**
No. It influences click-through, which matters commercially.

**How do I keep staging out of the index?**
HTTP basic auth plus `noindex`. Not `robots.txt` alone.

**Are Core Web Vitals worth optimising for SEO?**
As a tie-breaker, and more so for conversion. Fix indexability first.

**Should I block AI crawlers?**
A commercial decision. Blocking removes you from generated answers and their
citations; allowing them means content may be summarised without a click.

**Do I need an SEO plugin?**
Not for a framework with a metadata API — see
[Next.js SEO](/knowledge-base/next-js/seo). For WordPress, Yoast or Rank Math
save real work.

---

## Check your understanding

<Quiz
question="A page must not appear in search results. A developer adds it to robots.txt and also sets a noindex meta tag. What happens?"
options={[
{
text: 'The robots.txt block prevents the crawler fetching the page, so it never sees the noindex — and the page can remain indexed indefinitely',
correct: true,
why: 'robots.txt controls crawling; meta robots controls indexing. Blocking the fetch makes the indexing directive unreachable, which is why the combination is worse than either alone.',
},
{text: 'It is removed immediately, since two signals are stronger than one', why: 'They conflict rather than reinforce — the first prevents the second being read.'},
{text: 'The noindex takes priority because meta tags outrank robots.txt', why: 'Priority is irrelevant when the directive is never fetched.'},
{text: 'Nothing happens either way; both are advisory', why: 'Major crawlers respect both. The problem is the interaction.'},
]}
explanation={<>To remove a page from the index it must remain <em>crawlable</em> and return <code>noindex</code>. Use <code>robots.txt</code> to save crawl budget on pages you do not care about, not to hide pages.</>}
reference={{label: 'Crawling', href: '/knowledge-base/web/seo#crawling'}}
/>

<Quiz
question="A React SPA has excellent content but almost no search visibility. What should be checked first?"
options={[
{
text: 'Whether the HTML response actually contains the content — curl the URL rather than inspecting DevTools',
correct: true,
why: 'A client-rendered page returns a near-empty document. Google renders JavaScript on a delayed second pass and many other crawlers do not at all, so the content may be effectively invisible.',
},
{text: 'Whether structured data is present', why: 'Valuable for rich results, and useless if there is no indexable content to describe.'},
{text: 'Whether Core Web Vitals pass', why: 'A modest tie-breaker signal. It cannot help a page whose content is never indexed.'},
{text: 'Whether the sitemap is submitted', why: 'Helps discovery, and a discovered page with no server-rendered content still has nothing to index.'},
]}
explanation={<>Use View Source rather than the Elements panel — the latter shows the post-JavaScript DOM. Then confirm with Search Console's URL Inspection → View Crawled Page what Google actually rendered.</>}
reference={{label: 'Rendering', href: '/knowledge-base/web/seo#rendering'}}
/>

<Quiz
question="Which canonical practices are correct?"
type="multiple"
options={[
{text: 'A self-referencing canonical on every indexable page', correct: true, why: 'Removes ambiguity when tracking parameters or trailing-slash variants appear.'},
{text: 'Pointing ?utm_source and ?ref variants at the clean URL', correct: true, why: 'Exactly the duplicate-content consolidation canonicals exist for.'},
{text: 'Choosing one URL shape and 301-redirecting the others', correct: true, why: 'Redirects consolidate more strongly than canonicals, and remove the ambiguity entirely.'},
{text: 'Canonicalising every page to the homepage', why: 'Asks Google to ignore the rest of the site. A genuinely damaging and surprisingly common mistake.'},
{text: 'Canonicalising page 2 of a listing to page 1', why: 'Hides everything on page 2 from the index. Each page should self-canonicalise.'},
]}
explanation={<>Canonicals consolidate signals across <em>genuinely duplicate</em> URLs. Applied to distinct pages, they remove those pages from search — and note that a canonical is a hint, so conflicting internal links can override it.</>}
reference={{label: 'Indexing and canonicals', href: '/knowledge-base/web/seo#indexing-and-canonicals'}}
/>

<Quiz
question="A site migration replaces every URL. Traffic drops 80% and does not recover after two months. What is the most likely cause?"
options={[
{
text: 'Old URLs were redirected to the homepage rather than mapped individually — Google treats mass homepage redirects as soft 404s and drops the pages',
correct: true,
why: 'A redirect only passes signals when it points to genuinely equivalent content. Bulk homepage redirects lose the ranking of every individual page.',
},
{text: 'A temporary dip is expected and will recover on its own', why: 'A dip is normal; an 80% loss persisting for two months indicates a mapping error rather than settling.'},
{text: 'The new sitemap was submitted too early', why: 'Early submission helps discovery and does not cause loss.'},
{text: 'Core Web Vitals regressed on the new site', why: 'A modest tie-breaker signal. It does not account for a loss of that magnitude.'},
]}
explanation={<>Map URLs individually before launch by exporting indexed URLs from Search Console, use 301 rather than 302, and avoid chains — A → B → C loses signal at every hop.</>}
reference={{label: 'Migrations', href: '/knowledge-base/web/seo#migrations'}}
/>

<Quiz
question="With more traffic arriving via AI answer engines, what should change technically?"
options={[
{
text: 'Very little — server rendering matters more, since most AI crawlers execute less JavaScript than Google, and structured data is now used to extract facts as well as draw rich snippets',
correct: true,
why: 'The fetch-and-parse foundations are unchanged and arguably more important. What changes is the outcome: a cited answer rather than a click.',
},
{text: 'Structured data becomes irrelevant because AI reads prose directly', why: 'The opposite — it is increasingly used as a reliable source of facts.'},
{text: 'Client-side rendering becomes acceptable because AI crawlers are more capable', why: 'Most are less capable at JavaScript than Googlebot, not more.'},
{text: 'Titles and meta descriptions should be removed', why: 'They still drive traditional results, which remain a large share of search.'},
]}
explanation={<>The commercial change is larger than the technical one: citations without clicks, and falling click-through on informational queries. Whether to allow AI crawlers at all is a business decision expressible in <code>robots.txt</code>.</>}
reference={{label: 'AI answer engines', href: '/knowledge-base/web/seo#ai-answer-engines'}}
/>

---

## References

- [Google Search Central documentation](https://developers.google.com/search/docs)
  — the authoritative source on what Google actually uses.
- [Google: SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
  — the fundamentals, from the source.
- [Google: rel=prev/next is not an indexing signal](https://developers.google.com/search/blog/2019/03/rel-next-prev)
  — why the old pagination advice is obsolete.
- [Schema.org](https://schema.org/) and the
  [Rich Results Test](https://search.google.com/test/rich-results).
- [Google Search Console](https://search.google.com/search-console) — index
  coverage, URL inspection, Core Web Vitals field data.
- [Sitemaps protocol](https://www.sitemaps.org/protocol.html) — the format,
  normatively.
- [Next.js SEO](/knowledge-base/next-js/seo) — framework implementation.
