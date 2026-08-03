---
title: 'CDN'
description: 'Serving assets from locations close to your users — cache keys, invalidation, headers, edge compute, and the mistakes that leak private data.'
---

# CDN

## Introduction

A content delivery network is a set of servers distributed geographically that
cache your content and serve it from a location near each user.

**The problem it solves is the speed of light.** A request from Sydney to a
server in London travels roughly 17,000 km each way. Even at ideal speeds that
is around 250 ms of round-trip latency, and TCP and TLS handshakes multiply it.
No amount of server optimisation removes distance — only moving the content
closer does.

**What you get beyond latency:**

- **Origin offload.** Cached requests never reach your servers, so a traffic
  spike costs the CDN rather than your capacity.
- **Availability.** Many CDNs can serve stale content when your origin is down,
  turning an outage into slightly old content.
- **DDoS absorption.** A large edge network soaks up volumetric attacks that
  would flatten a single origin.
- **TLS termination at the edge**, with a faster handshake close to the user.

**The mental model:** a CDN is a
[reverse proxy](/knowledge-base/hosting/reverse-proxy) with hundreds of
locations and a cache. Every concept from that page — forwarded headers,
buffering, timeouts — applies here, at greater distance and with more caching.

---

## What to Put Behind It

**Static assets** — JavaScript, CSS, images, fonts, video. The original use
case, and still the highest value.

**Cacheable HTML** — marketing pages, blog posts, documentation. Often
overlooked, and where the biggest TTFB improvements usually are.

**API responses** that are public and read-heavy, with a short TTL.

**Everything, as a proxy** — many teams route all traffic through a CDN and mark
dynamic responses uncacheable, keeping the DDoS protection, TLS termination and
edge network for uncached requests too.

**What not to cache:** anything user-specific, unless the cache key includes the
user. This is the single most damaging CDN mistake, and it has its own section
[below](#the-mistake-that-leaks-data).

---

## Cache Control

The CDN and the browser both obey `Cache-Control`, and you usually want
different values for each.

```http
# Hashed build assets: content-addressed, so they can never go stale
Cache-Control: public, max-age=31536000, immutable

# HTML: browser revalidates, CDN caches briefly
Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=600

# Anything user-specific
Cache-Control: private, no-store
```

| Directive                | Effect                                                      |
| ------------------------ | ----------------------------------------------------------- |
| `max-age`                | Browser cache duration                                      |
| `s-maxage`               | **Shared cache** duration — overrides `max-age` for the CDN |
| `public`                 | Any cache may store it                                      |
| `private`                | **Browser only** — shared caches must not store it          |
| `no-store`               | Never store anywhere                                        |
| `immutable`              | Never revalidate; the content cannot change                 |
| `stale-while-revalidate` | Serve stale instantly, refresh in the background            |
| `stale-if-error`         | Serve stale rather than an error when the origin fails      |

**`s-maxage` is the one that gives you control.** It lets the CDN hold content
for five minutes while browsers revalidate every time — so a purge takes effect
immediately for everyone, rather than waiting for browser caches to expire.

**`immutable` on content-hashed filenames** is free performance: the browser
does not even send a revalidation request. Only use it where the filename
changes when the content does.

**`stale-if-error` is under-used.** It converts an origin outage into stale
content rather than a 502, which is nearly always the better failure mode.

---

## Cache Keys

What the CDN uses to decide whether two requests are "the same". Almost every
subtle CDN bug is a cache key problem.

By default the key is roughly **method + host + path + query string**. Notably
it does **not** include headers unless you say so.

**`Vary` adds headers to the key:**

```http
Vary: Accept-Encoding        # separate entries for gzip and brotli — correct
Vary: Accept-Language        # separate entry per language
Vary: Cookie                 # ⚠️ effectively disables caching
```

**`Vary: Cookie` destroys your hit rate.** Every distinct cookie value — every
analytics identifier, every session — becomes a separate cache entry. It is
technically correct and practically useless; the right answer is to mark
user-specific responses `private` instead.

**Query strings are usually part of the key**, which means `?utm_source=x`
creates a separate cache entry for identical content. Configure the CDN to
ignore tracking parameters, or hit rates degrade badly on marketing traffic.

**Normalise deliberately.** Decide what genuinely varies the response — device
class, country, language — and include only that. Every dimension you add
multiplies the number of cache entries and divides your hit rate.

---

## Invalidation

Two approaches, and the second is much better.

**Purge** — tell the CDN to discard cached content:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"files":["https://example.com/index.html"]}'
```

Purging works, takes seconds to propagate globally, and is often rate-limited.
It is also imprecise: purging everything after a deploy discards your entire
cache and sends a thundering herd at the origin.

**Cache tags** are the better mechanism where available. Tag responses on the
way out, then purge by tag:

```http
Cache-Tag: product-1024, category-lamps, homepage
```

One product update purges every page that included that product, without your
needing to know which pages those were.

**Immutable URLs avoid invalidation entirely.** If assets are content-hashed —
`app.a1b2c3.js` — a new deploy produces new filenames, and the old ones simply
expire unused. **This is the correct pattern for static assets**, and it is why
`immutable` is safe there.

**The general rule:** invalidate HTML by tag or short `s-maxage`, and never
invalidate assets at all — change their names.

---

## The Mistake That Leaks Data

Worth its own section, because it is the CDN failure with real consequences.

```http
# ❌ A logged-in user's dashboard, cached publicly
Cache-Control: public, max-age=300
```

The CDN stores one user's personalised response and serves it to everyone else
requesting that URL. This has happened to large, well-resourced companies more
than once.

**The rules:**

- **`private, no-store` on any authenticated response**, by default. Opt
  specific endpoints into caching deliberately.
- **`Vary: Authorization`** where a URL can be either public or personalised.
- **Never let the origin's default caching apply to authenticated routes.**
  Check what your framework sends when you have set nothing.
- **Test it.** Log in, load a page, log out, request the same URL in a private
  window, and confirm you do not see the previous user's data.

The equivalent mistake is **caching a response carrying `Set-Cookie`** — every
subsequent visitor receives the same session cookie. Most CDNs refuse to cache
those, and you should not rely on that.

---

## Choosing a CDN

|                      | Strengths                                              | Notes                                                                |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| **Cloudflare**       | Huge network, generous free tier, no egress fees on R2 | Also DNS, WAF, Workers. See [Cloudflare](/knowledge-base/cloudflare) |
| **Fastly**           | Instant purge, VCL configurability                     | Powerful, steeper learning curve                                     |
| **CloudFront**       | Deep AWS integration                                   | Egress costs add up; configuration is fiddly                         |
| **Bunny**            | Very cheap, simple                                     | Smaller network, excellent value                                     |
| **Vercel / Netlify** | Integrated with the framework                          | Convenient, less control, usage-priced                               |

**Egress pricing is the cost that surprises people.** AWS and GCP charge
meaningfully per gigabyte out; Cloudflare and Bunny charge far less or nothing.
For a video- or image-heavy site this dominates the bill.

**Most sites should start with Cloudflare's free tier**, which includes global
CDN, DNS, TLS and basic DDoS protection. Move only when a specific requirement
pushes you.

---

## Edge Compute

Modern CDNs run code at the edge — Cloudflare Workers, Fastly Compute,
Lambda@Edge, Vercel Edge Functions.

**What it is good for:**

- **A/B testing and personalisation** without breaking the cache.
- **Authentication checks** before a request travels to the origin.
- **Redirects and rewrites** with no origin round trip.
- **Geolocation and header manipulation.**
- **Assembling cached fragments** into a personalised page.

**The constraints are real:** short CPU limits, limited or no filesystem, a
restricted runtime (usually not full Node), cold starts, and **no fast database
access from most edge locations**. A query from an edge node in Sydney to a
database in Frankfurt costs the same round trip it always did, plus an extra
hop.

The rule of thumb: **edge compute is for request manipulation, not for your
application.** Logic that needs no distant data belongs there; anything that
queries a database usually does not.

---

## Debugging

Every CDN exposes a header telling you whether a request hit the cache. Learn
yours:

```bash
curl -sI https://example.com/app.js | grep -i 'cache\|age\|cf-'
```

```http
CF-Cache-Status: HIT          # Cloudflare
X-Cache: Hit from cloudfront  # CloudFront
Age: 143                      # seconds since it was cached
```

| Symptom                          | Cause and fix                                                            |
| -------------------------------- | ------------------------------------------------------------------------ |
| Everything is a MISS             | `Cache-Control` says `private`/`no-store`, or a `Set-Cookie` is present. |
| Users see stale content          | Cached HTML with a long TTL and no purge on deploy.                      |
| **One user sees another's data** | An authenticated response cached publicly. Fix immediately.              |
| Low hit rate                     | Cache key includes query strings, or a broad `Vary`.                     |
| Origin load unchanged            | Traffic not actually routed through the CDN, or nothing cacheable.       |
| Deploy does not take effect      | Assets not content-hashed, or the purge did not run.                     |
| Works in one region only         | Each edge location fills its cache independently.                        |
| Intermittent CORS errors         | Missing `Vary: Origin`, so one origin's response is served to another.   |
| Large egress bill                | Uncached content, or a provider with high egress pricing.                |

**Check the `Age` header** to see how long a response has been cached — the
quickest way to tell whether your TTL behaves as configured.

---

## Do's and Don'ts

### Do

- Content-hash static assets and serve them `immutable` with a one-year
  `max-age`.
- Use `s-maxage` to control the CDN separately from browsers.
- Add `stale-while-revalidate` and `stale-if-error` to cacheable content.
- Mark authenticated responses `private, no-store` by default.
- Purge by cache tag rather than by URL where supported.
- Configure the CDN to ignore tracking query parameters.
- Send `Vary: Origin` when CORS headers vary.
- Check the cache-status header after every change.
- Test explicitly that a logged-in response is not publicly cached.

### Don't

- Don't cache authenticated responses without keying on the user.
- Don't use `Vary: Cookie` — mark it `private` instead.
- Don't purge everything on deploy; hash filenames instead.
- Don't add cache-key dimensions without a reason.
- Don't put `immutable` on a URL whose content can change.
- Don't query a distant database from an edge function.
- Don't assume the CDN is caching — check the headers.
- Don't ignore egress pricing when choosing a provider.

---

## Common Mistakes

**Caching a personalised page publicly.** The serious one. Default to `private`
on anything authenticated.

**Purging the entire cache on every deploy.** Hit rate drops to zero and the
origin takes a thundering herd. Hash asset filenames and purge only HTML.

**`Vary: Cookie`.** Correct and useless — every analytics cookie fragments the
cache.

**Not hashing asset filenames.** Then you must purge, and browsers still hold
old copies.

**Setting `max-age` without `s-maxage`.** Browsers and CDN cache for the same
duration, so a purge does not help users who already have a copy.

**Assuming a purge is instant.** It takes seconds to propagate, and some
locations lag.

**Forgetting `Vary: Origin` on CORS responses.** One origin's response gets
served to another, producing intermittent CORS failures. See
[CORS](/knowledge-base/security/cors).

**Treating the CDN as the only cache.** Browser, CDN and origin caches all
interact; a stale response can come from any of them.

---

## FAQ

**Do I need a CDN for a small site?**
Yes — most are free or nearly free at small scale, and the latency improvement
for distant users is large.

**Will a CDN fix a slow application?**
Only for cacheable content. A slow authenticated dashboard is unaffected, and
that is usually a database problem. See
[Performance](/knowledge-base/web/performance).

**Can I cache HTML?**
Yes, and it is often the biggest win. Short `s-maxage` with
`stale-while-revalidate`, purged on publish.

**What about personalised pages?**
Cache the shell and fetch personalised fragments client-side, or use edge
compute to assemble a cached shell with personalised parts.

**How do I invalidate across environments?**
Content-hashed assets need no invalidation. For HTML, purge by tag as part of
the deploy pipeline.

**Does a CDN protect against DDoS?**
Against volumetric attacks, substantially. Application-layer attacks still need
rate limiting and a WAF.

---

## Check your understanding

<Quiz
question="After enabling a CDN, users report occasionally seeing another customer's dashboard. What happened?"
options={[
{
text: 'An authenticated, personalised response was sent with a public Cache-Control, so the CDN stored one user\'s page and served it to everyone requesting that URL',
correct: true,
why: 'Shared caches obey Cache-Control. Anything user-specific must be marked private or no-store, or the CDN treats it as a public document.',
},
{text: 'The CDN mixed up TLS sessions between users', why: 'TLS sessions are per connection and unrelated to cached response bodies.'},
{text: 'Session cookies collided between users', why: 'That would be a session-generation bug, and would not correlate with introducing a CDN.'},
{text: 'The origin returned the wrong data under load', why: 'The correlation with enabling the CDN, and the per-URL pattern, points squarely at caching.'},
]}
explanation={<>Default authenticated routes to <code>private, no-store</code> and opt specific endpoints into caching deliberately. Test it directly: log in, load a page, then request the same URL in a private window.</>}
reference={{label: 'The mistake that leaks data', href: '/knowledge-base/hosting/cdn#the-mistake-that-leaks-data'}}
/>

<Quiz
question="A team wants the CDN to cache HTML for five minutes while browsers always revalidate, so purges take effect immediately. Which header achieves that?"
options={[
{
text: 'Cache-Control: public, max-age=0, s-maxage=300',
correct: true,
why: 's-maxage applies only to shared caches, overriding max-age for the CDN. Browsers see max-age=0 and revalidate every time, so a purge is immediately visible to everyone.',
},
{text: 'Cache-Control: public, max-age=300', why: 'Browsers would also cache for five minutes, so a purge would not reach users already holding a copy.'},
{text: 'Cache-Control: private, max-age=300', why: 'private prevents the CDN caching at all — the opposite of the requirement.'},
{text: 'Cache-Control: no-store, s-maxage=300', why: 'no-store forbids storage everywhere, including the CDN, so s-maxage has nothing to apply to.'},
]}
explanation={<>Adding <code>stale-while-revalidate</code> improves it further: the CDN serves the cached copy instantly while refreshing behind it, so users never wait for a revalidation.</>}
reference={{label: 'Cache control', href: '/knowledge-base/hosting/cdn#cache-control'}}
/>

<Quiz
question="A site's CDN hit rate is under 10% despite most content being static and public. What should you check first?"
options={[
{
text: 'The cache key — query strings such as ?utm_source create separate entries for identical content, and a broad Vary header fragments it further',
correct: true,
why: 'Cache keys include the query string by default, so marketing traffic with tracking parameters produces a unique entry per visitor. Vary: Cookie has the same effect for any analytics cookie.',
},
{text: 'The TTL is too short', why: 'Worth checking, though it would not produce a hit rate that low on genuinely static content.'},
{text: 'The CDN network is too small', why: 'Network size affects latency, not whether identical requests share a cache entry.'},
{text: 'Compression is disabled', why: 'Compression affects transfer size, not cache hits.'},
]}
explanation={<>Configure the CDN to ignore tracking parameters, and replace <code>Vary: Cookie</code> with <code>private</code> on the responses that genuinely need it. Every cache-key dimension multiplies entries and divides hit rate.</>}
reference={{label: 'Cache keys', href: '/knowledge-base/hosting/cdn#cache-keys'}}
/>

<Quiz
question="Which invalidation strategies are sound?"
type="multiple"
options={[
{text: 'Content-hashing static assets so new deploys produce new filenames', correct: true, why: 'Removes invalidation entirely — old URLs simply expire unused, which is why immutable is safe on them.'},
{text: 'Purging by cache tag when the underlying data changes', correct: true, why: 'One product update purges every page that included it, without needing to know which pages those were.'},
{text: 'Short s-maxage on HTML combined with stale-while-revalidate', correct: true, why: 'Bounds staleness without a purge, and users never wait for the refresh.'},
{text: 'Purging the entire cache on every deploy', why: 'Hit rate drops to zero and the origin absorbs a thundering herd — the opposite of what the CDN is for.'},
{text: 'Relying on browsers to revalidate assets marked immutable', why: 'immutable explicitly tells browsers not to revalidate. That is its purpose, and why it belongs only on content-hashed URLs.'},
]}
explanation={<>The general rule: never invalidate assets — change their names. Invalidate HTML by tag or short shared TTL.</>}
reference={{label: 'Invalidation', href: '/knowledge-base/hosting/cdn#invalidation'}}
/>

<Quiz
question="A team moves an API endpoint to an edge function to reduce latency. It queries their PostgreSQL database in Frankfurt. Users in Sydney see no improvement — it is slower. Why?"
options={[
{
text: 'The function now runs near the user but the data is still in Frankfurt, so the round trip is unchanged and an extra hop has been added',
correct: true,
why: 'Edge compute only helps when the work needs no distant data. A query from Sydney to Frankfurt costs the same latency wherever the code runs.',
},
{text: 'Edge functions are inherently slower than origin servers', why: 'They are fast for what they do; the problem is where the data lives.'},
{text: 'The database connection pool is too small', why: 'Connection management at the edge is a real concern, and it is not why the latency is unchanged.'},
{text: 'Edge functions cannot use TLS to the database', why: 'They can; connectivity is not the issue.'},
]}
explanation={<>Edge compute is for request manipulation — redirects, headers, auth checks, geolocation, A/B assignment — not for logic that needs a distant database. Either keep it at the origin, or replicate the data closer.</>}
reference={{label: 'Edge compute', href: '/knowledge-base/hosting/cdn#edge-compute'}}
/>

---

## References

- [MDN: Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
  — every directive, precisely.
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html) — the
  normative caching semantics.
- [Cloudflare: Cache documentation](https://developers.cloudflare.com/cache/) —
  cache keys, tags and purge behaviour.
- [Fastly: Cache freshness](https://developer.fastly.com/learning/concepts/cache-freshness/)
  — instant purge and surrogate keys.
- [web.dev: Love your cache](https://web.dev/articles/love-your-cache) — a
  practical guide to cache headers.
- [Caching](/knowledge-base/operations/caching) — caching beyond the CDN layer.
