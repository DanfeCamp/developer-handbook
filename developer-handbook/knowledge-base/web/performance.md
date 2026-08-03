---
title: 'Performance'
description: 'Measuring and improving what users actually experience — Core Web Vitals, the loading pipeline, JavaScript cost, images, caching and a diagnostic workflow.'
---

# Performance

## Introduction

Performance work fails when it starts from opinions. It succeeds when it starts
from **measurement of what real users experience**, and proceeds to the largest
number on the list.

**Why it matters commercially**, not just aesthetically: slow pages lose users
before they see anything. Every major published study of the relationship
between load time and conversion finds the same shape — abandonment rises
sharply with delay, and the effect is worst on mobile networks where most of the
world browses.

**The three questions** that structure everything below:

1. **Is it fast for the user?** Not on your laptop on office wifi — at the 75th
   percentile of real devices and networks.
2. **Where is the time going?** Network, JavaScript execution, rendering, or the
   server.
3. **What is the biggest single win?** Performance work has a long tail; the
   first two fixes usually deliver most of the benefit.

---

## Core Web Vitals

Google's user-centred metrics, and a ranking signal. More usefully, they measure
the three things users actually notice.

| Metric                              | Measures                               | Good     | Needs work | Poor     |
| ----------------------------------- | -------------------------------------- | -------- | ---------- | -------- |
| **LCP** — Largest Contentful Paint  | Loading: when the main content appears | ≤ 2.5 s  | ≤ 4 s      | > 4 s    |
| **INP** — Interaction to Next Paint | Responsiveness: lag on interaction     | ≤ 200 ms | ≤ 500 ms   | > 500 ms |
| **CLS** — Cumulative Layout Shift   | Visual stability: unexpected movement  | ≤ 0.1    | ≤ 0.25     | > 0.25   |

**All three are assessed at the 75th percentile of real users.** A good median
with a bad tail fails, which is deliberate: the slowest quarter of your users
are still users.

**INP replaced FID in March 2024.** The distinction matters — First Input Delay
measured only the delay before the _first_ interaction was processed, which
flattered pages that were fast to accept a click and slow to respond to it. INP
measures the full latency of _every_ interaction, from input to the next paint.
Many sites that passed FID comfortably fail INP.

### What each one usually means

**LCP is nearly always one of four things:** a slow server response, a
render-blocking resource, a slow-loading image, or client-side rendering that
delays the content entirely.

**INP is nearly always long JavaScript tasks** blocking the main thread — an
expensive event handler, a large re-render, or a third-party script.

**CLS is nearly always missing dimensions** — images and embeds without `width`
and `height`, ads or banners injected above existing content, or a web font
swapping at a different size.

---

## Measuring

The distinction that determines whether your numbers mean anything:

**Field data (RUM)** — what real users experienced. This is the truth. Sources:
the Chrome UX Report (CrUX), Search Console, or your own RUM via the
`web-vitals` library.

**Lab data** — a synthetic run under controlled conditions. Reproducible,
diagnostic, and not representative. Lighthouse, WebPageTest, DevTools.

**Use field data to decide what to fix; lab data to work out why.** A Lighthouse
score of 100 on a fast laptop tells you nothing about a user on a three-year-old
Android phone on a congested network.

```ts
// Collect real user metrics
import {onLCP, onINP, onCLS, onTTFB} from 'web-vitals';

function report(metric) {
  navigator.sendBeacon('/analytics/vitals', JSON.stringify(metric));
}

onLCP(report);
onINP(report);
onCLS(report);
onTTFB(report);
```

**Always throttle when profiling locally.** DevTools → Performance → CPU 4× or
6× slowdown, network set to Fast 3G. Without it you are measuring your hardware.

Other useful metrics: **TTFB** (server response, the floor under LCP), **TBT**
(total blocking time — the lab proxy for INP), and **FCP** (first contentful
paint).

---

## The Loading Pipeline

Optimisation makes sense once you know the sequence.

```text
DNS → TCP → TLS → request → TTFB → HTML parse
                                      ├─ CSS (render-blocking)
                                      ├─ JS (parse, compile, execute)
                                      └─ images, fonts
                                            → layout → paint → composite
```

**Reduce TTFB first.** Everything else waits behind it. Server-side caching, a
CDN close to the user, and database work are the levers — see
[Caching](/knowledge-base/operations/caching).

**CSS is render-blocking by design.** The browser will not paint until it knows
the styles, so a large stylesheet delays everything. Inline critical CSS and
defer the rest.

**JavaScript is worse than its transfer size suggests.** A 300 KB image decodes
cheaply; 300 KB of JavaScript must be downloaded, parsed, compiled and executed,
and on a mid-range phone that is measured in seconds.

**Preload what matters, preconnect to what you need early:**

```html
<link rel="preconnect" href="https://cdn.example.com" crossorigin />
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" as="image" href="/hero.avif" fetchpriority="high" />
```

Use these sparingly. Preloading everything prioritises nothing.

---

## JavaScript

Usually the largest lever in a modern application, and the one teams are most
reluctant to pull.

**Ship less of it.** Every other technique is secondary.

```ts
// Route-level code splitting: the biggest single win
const Settings = lazy(() => import('./features/settings/Settings'));
```

- **Analyse the bundle** — `rollup-plugin-visualizer`, `@next/bundle-analyzer`.
  The result is usually one or two dependencies nobody remembers adding.
- **Check the platform first.** `Intl`, `structuredClone`, `fetch`,
  `crypto.randomUUID` and `Temporal` have replaced a great many packages.
- **Import narrowly.** `import {debounce} from 'lodash-es'`, not the whole
  library — and confirm tree shaking actually worked.
- **Server-render** where you can, so content does not wait for JavaScript. See
  [Rendering & SSR](/knowledge-base/next-js/server-side-rendering).

**Break up long tasks.** A task over 50 ms blocks the main thread and directly
harms INP:

```ts
async function processAll(items) {
  for (const item of items) {
    process(item);
    // Yield to the browser so input can be handled between chunks
    if ('scheduler' in window) await scheduler.yield();
    else await new Promise((r) => setTimeout(r, 0));
  }
}
```

**Move heavy work off the main thread** entirely with a Web Worker where the
computation is genuinely expensive.

**Third-party scripts are frequently the dominant cost**, and they are the ones
nobody profiles. An analytics tag, a chat widget, a tag manager and three
trackers can outweigh your whole application. Audit them, load them with
`defer` or on interaction, and be willing to say no.

---

## Images and Media

Usually the largest bytes on a page, and the easiest wins.

```html
<img
  src="/hero.avif"
  width="1200"
  height="600"
  alt="Team collaborating"
  fetchpriority="high"
/>

<img src="/product.avif" width="400" height="400" alt="Desk lamp" loading="lazy" decoding="async" />
```

- **`width` and `height` on every image.** This is what prevents layout shift —
  the browser reserves the space before the file arrives.
- **Modern formats.** AVIF is typically 50 % smaller than JPEG, WebP around
  30 %. Serve with `<picture>` fallbacks, or let a framework's image component
  handle it.
- **`loading="lazy"` below the fold**, and **never on the LCP image** — lazily
  loading your hero delays the very metric you are trying to improve.
- **`fetchpriority="high"`** on the LCP image so it is not queued behind less
  important requests.
- **Serve appropriate sizes.** A 4000 px image displayed at 400 px wastes
  bandwidth, memory and decode time. Use `srcset`.

**Fonts** cause both delay and shift:

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap; /* show fallback text immediately */
  size-adjust: 105%; /* match fallback metrics to reduce shift on swap */
}
```

Self-host fonts (a third-party font host is an extra connection and no longer
shares a cache across sites), subset them to the characters you use, and preload
the one used above the fold.

---

## Caching and Delivery

The cheapest performance available, and the most under-used.

```http
# Hashed build assets — immutable, cache forever
Cache-Control: public, max-age=31536000, immutable

# HTML — always revalidate
Cache-Control: no-cache

# API responses that tolerate staleness
Cache-Control: public, max-age=60, stale-while-revalidate=600
```

**`immutable` for content-hashed assets** is free and substantial: the browser
does not even revalidate.

**`stale-while-revalidate`** serves the cached copy instantly while refreshing
behind it — the user never waits for a revalidation.

**Use a CDN.** Serving from an edge location near the user removes most of the
network latency, and it is the single biggest TTFB improvement available for a
geographically distributed audience. See [CDN](/knowledge-base/hosting/cdn).

**Compression:** Brotli for text, and it is meaningfully better than gzip.
Modern servers negotiate it automatically.

**HTTP/2 and HTTP/3** multiplex requests over one connection, which removes the
old six-connection limit and makes request count far less important than it used
to be. Domain sharding and sprite sheets are now counterproductive.

---

## Rendering and the Frontend

**Virtualise long lists.** Ten thousand rows means ten thousand DOM nodes to lay
out, paint and keep in memory. Render the visible window.

**Animate only `transform` and `opacity`.** These can be handled by the
compositor without layout or paint. Animating `width`, `top` or `margin` forces
layout on every frame.

**Avoid layout thrashing** — interleaving reads and writes so the browser
recomputes layout repeatedly. Batch reads, then batch writes. See
[the DOM page](/knowledge-base/dom#reflow-repaint-and-layout-thrashing).

**`content-visibility: auto`** skips rendering work for offscreen sections:

```css
.article-section {
  content-visibility: auto;
  contain-intrinsic-size: auto 500px; /* estimate, to keep the scrollbar stable */
}
```

**In React**, the dominant costs are bundle size, node count and expensive
render work — not re-render count. With React Compiler enabled, manual
memoisation is largely unnecessary. See
[React best practices](/knowledge-base/react-js/best-practices#performance).

---

## Backend Performance

A fast frontend on a slow API is still slow.

**The order to look in:**

1. **N+1 queries.** Almost always the answer when a page is slow and every
   individual query is fast. See
   [Data Modelling](/knowledge-base/databases/data-modelling#the-n1-problem).
2. **Missing indexes.** `EXPLAIN ANALYZE` the slow query.
3. **Sequential awaits** that could run in parallel with `Promise.all`.
4. **Work that should be queued** — email, PDFs, third-party calls, image
   processing.
5. **Caching** at the right layer — application, Redis, or HTTP.

**Measure at the percentile, not the mean.** An average of 200 ms hides a p99 of
8 seconds, and the p99 is somebody's every request.

**Set timeouts on every outbound call.** A slow dependency without a timeout
becomes your slow response, and then your exhausted connection pool.

---

## A Diagnostic Workflow

1. **Check field data.** Which metric fails, on which pages, for which devices?
   Do not optimise what is already good.
2. **Reproduce in the lab**, throttled to a mid-range device.
3. **Find the cause** with the Performance panel:
   - Long tasks (marked red) → INP.
   - The LCP element and what delayed it → LCP.
   - Layout Shift regions → CLS.
4. **Fix the largest single contributor.** Not the easiest one.
5. **Re-measure**, in the lab and then in the field.
6. **Add a regression gate** — Lighthouse CI or a bundle-size budget in the
   pipeline, so the improvement survives.

```yaml title="Bundle budget in CI"
- name: Check bundle size
  run: npx bundlesize --max-size 180kB dist/assets/index-*.js
```

Without a gate, every performance improvement decays. Budgets are what make the
work stick.

---

## Do's and Don'ts

### Do

- Measure field data first, and optimise at the 75th percentile.
- Throttle CPU and network when profiling.
- Set `width` and `height` on every image and embed.
- Use `fetchpriority="high"` on the LCP image and never lazy-load it.
- Code-split at route boundaries.
- Audit third-party scripts as rigorously as your own code.
- Cache hashed assets with `immutable`; use `stale-while-revalidate` for APIs.
- Virtualise long lists.
- Add a performance budget to CI.

### Don't

- Don't optimise from a Lighthouse score on your laptop.
- Don't lazy-load above-the-fold images.
- Don't animate layout-triggering properties.
- Don't preload everything — it prioritises nothing.
- Don't ship a library for something the platform now does.
- Don't shard domains or build sprite sheets; HTTP/2 made both obsolete.
- Don't chase micro-optimisations while a 900 KB bundle ships.
- Don't measure the mean and call it performance.

---

## Common Mistakes

**Optimising the wrong thing.** Days spent on render counts while the real cost
is a 2 MB JavaScript bundle.

**Testing only on fast hardware.** Your laptop is not the 75th percentile.

**Lazy-loading the hero image.** Directly harms LCP, and it is a common
side effect of applying `loading="lazy"` globally.

**Ignoring third parties.** The tag manager is frequently the largest single
cost on the page.

**No `width`/`height` on images.** The commonest cause of CLS, and a one-line
fix.

**Client-side rendering content that needs to appear fast.** The user waits for
download, parse, execute and fetch before seeing anything.

**Caching HTML aggressively.** Users see stale content, and deploys appear not
to take effect.

**No regression protection.** Performance is fixed once and quietly lost again.

---

## Debugging

| Symptom                          | Likely cause                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Poor LCP                         | Slow TTFB, render-blocking CSS/JS, unoptimised hero image, or client-side rendering. |
| Poor INP                         | Long tasks — heavy handlers, large re-renders, third-party scripts.                  |
| Poor CLS                         | Images without dimensions, injected banners, font swap without `size-adjust`.        |
| Fast locally, slow in the field  | Device and network reality. Throttle and check field data.                           |
| TTFB high                        | Server or database work, no caching, no CDN.                                         |
| Fast first load, slow navigation | Client-side routing doing too much work, or no data prefetch.                        |
| Memory grows over time           | Leaked listeners, observers or intervals.                                            |
| Slow only for some users         | Geography (no CDN), device class, or a specific browser.                             |

Tools: **Lighthouse** for a starting audit, the **Performance panel** for the
detail, **WebPageTest** for filmstrips and real devices, **CrUX / Search
Console** for the field, and the **Coverage panel** for unused CSS and JS.

---

## FAQ

**How fast is fast enough?**
Pass Core Web Vitals at the 75th percentile: LCP ≤ 2.5 s, INP ≤ 200 ms,
CLS ≤ 0.1. Beyond that, measure conversion rather than chasing a score.

**Does performance really affect SEO?**
Core Web Vitals are a genuine but modest ranking signal — a tie-breaker between
comparable pages. The effect on conversion is usually larger than the effect on
ranking.

**Should I use a framework at all?**
Frameworks add JavaScript, and the fastest sites for content are server-rendered
with little of it. Use one for interactivity, not for a brochure site.

**What is a reasonable JavaScript budget?**
Under 200 KB compressed for the initial route is a good target; under 100 KB is
excellent. Measure what it costs to execute, not only to download.

**Is a CDN worth it for a small site?**
Yes — most are free or nearly free at small scale, and TTFB improvement for
distant users is substantial.

**INP is bad but Lighthouse says 100. Why?**
Lighthouse measures TBT in a synthetic load, not real interactions. INP is a
field metric. Trust the field data.

---

## Check your understanding

<Quiz
question="A site passed the old FID metric comfortably but now fails INP. What changed?"
options={[
{
text: 'FID measured only the delay before the first interaction was processed; INP measures the full latency of every interaction through to the next paint',
correct: true,
why: 'A page can accept a click instantly and then take 600 ms to update. FID scored that well; INP does not, which is why many sites regressed when it replaced FID in March 2024.',
},
{text: 'The thresholds were tightened for the same measurement', why: 'It is a different measurement, not a stricter threshold on the same one.'},
{text: 'INP is measured in the lab rather than the field', why: 'Both are field metrics. Lighthouse approximates INP with TBT.'},
{text: 'INP includes network time, which FID excluded', why: 'INP measures interaction responsiveness — main-thread work and rendering, not network.'},
]}
explanation={<>INP is nearly always long JavaScript tasks blocking the main thread. Break work into chunks with <code>scheduler.yield()</code>, move heavy computation to a worker, and audit third-party scripts.</>}
reference={{label: 'Core Web Vitals', href: '/knowledge-base/web/performance#core-web-vitals'}}
/>

<Quiz
question="A team applies the lazy loading attribute to every image site-wide. LCP gets worse. Why?"
options={[
{
text: 'The hero image is now lazily loaded, so it is discovered and fetched later — directly delaying the largest contentful paint',
correct: true,
why: 'Lazy loading defers the request until the image approaches the viewport. Applied to the LCP element, it postpones exactly the paint the metric measures.',
},
{text: 'Lazy loading is not supported in all browsers, causing a fallback delay', why: 'Support is universal, and unsupported browsers would simply load normally.'},
{text: 'Lazy loading forces a layout recalculation per image', why: 'It does not; layout shift comes from missing dimensions, which is a separate issue.'},
{text: 'It increases the total number of requests', why: 'The request count is unchanged — only the timing differs.'},
]}
explanation={<>Lazy-load below the fold only, and mark the LCP image <code>fetchpriority="high"</code> so it is not queued behind less important resources.</>}
reference={{label: 'Images and media', href: '/knowledge-base/web/performance#images-and-media'}}
/>

<Quiz
question="Lighthouse scores 98 on a developer's laptop, but field data shows LCP failing for a quarter of users. Which should drive the work?"
options={[
{
text: 'Field data — Core Web Vitals are assessed at the 75th percentile of real users, and lab conditions on fast hardware are unrepresentative',
correct: true,
why: 'Lab data is reproducible and diagnostic; it is not evidence of what users experience. A good median with a bad tail still fails, by design.',
},
{text: 'Lighthouse, because it is a controlled measurement', why: 'Control is what makes it useful for diagnosis and useless as evidence of real experience.'},
{text: 'Neither — take the average of both', why: 'Averaging a synthetic run with real measurements produces a number that means nothing.'},
{text: 'Whichever is measured more recently', why: 'Recency does not make lab conditions representative.'},
]}
explanation={<>Use field data to decide <em>what</em> to fix and lab data to work out <em>why</em>. When profiling locally, throttle CPU 4–6× and the network, or you are measuring your own hardware.</>}
reference={{label: 'Measuring', href: '/knowledge-base/web/performance#measuring'}}
/>

<Quiz
question="Which changes reduce Cumulative Layout Shift?"
type="multiple"
options={[
{text: 'Setting width and height attributes on every image', correct: true, why: 'Lets the browser reserve the correct space before the file arrives — the single most common CLS fix.'},
{text: 'Using font-display: swap together with size-adjust to match fallback metrics', correct: true, why: 'swap avoids invisible text, and size-adjust reduces the shift when the real font replaces the fallback.'},
{text: 'Reserving space for ads and banners rather than injecting them above existing content', correct: true, why: 'Content inserted above what the user is reading pushes everything down — a large and very visible shift.'},
{text: 'Using contain-intrinsic-size with content-visibility: auto', correct: true, why: 'Provides a size estimate for skipped content so the scrollbar and layout stay stable.'},
{text: 'Animating elements with transform instead of top and left', why: 'Excellent for frame rate and compositing, but transform-based animation is deliberately excluded from CLS.'},
]}
explanation={<>CLS is nearly always about space not being reserved. The last option is a genuine performance improvement that happens not to affect this particular metric.</>}
reference={{label: 'Core Web Vitals', href: '/knowledge-base/web/performance#what-each-one-usually-means'}}
/>

<Quiz
question="A dashboard is slow. Every database query in the logs completes in under 5 ms, but the endpoint takes 1.2 seconds. What should you check first?"
options={[
{
text: 'The query count per request — many fast queries in sequence is the signature of an N+1',
correct: true,
why: 'Total time scaling with row count while each query stays fast is the classic N+1 pattern. 200 queries at 5 ms is a second of pure waiting.',
},
{text: 'Add an index to the slowest table', why: 'Indexes make individual queries faster, and the premise says they are already fast.'},
{text: 'Increase the server’s CPU allocation', why: 'The time is spent waiting on round trips, not computing.'},
{text: 'Enable Brotli compression on the response', why: 'Compression affects transfer size, not the 1.2 seconds spent server-side.'},
]}
explanation={<>Log the query count per request; anything that scales with result-set size is an N+1. Eager loading collapses it to two queries, and it is consistently the highest-value backend performance fix.</>}
reference={{label: 'Backend performance', href: '/knowledge-base/web/performance#backend-performance'}}
/>

---

## References

- [web.dev: Core Web Vitals](https://web.dev/articles/vitals) — definitions,
  thresholds and the reasoning behind them.
- [web.dev: Optimize INP](https://web.dev/articles/optimize-inp) — long tasks,
  yielding, and the practical fixes.
- [web-vitals library](https://github.com/GoogleChrome/web-vitals) — collect
  field data from real users.
- [WebPageTest](https://www.webpagetest.org/) — filmstrips, real devices, real
  networks.
- [Chrome UX Report](https://developer.chrome.com/docs/crux) — field data for
  any public origin.
- [MDN: Performance](https://developer.mozilla.org/en-US/docs/Web/Performance) —
  the loading pipeline and browser APIs.
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) — regression
  gates in the pipeline.
