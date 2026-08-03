---
title: 'Cloudflare'
description: 'DNS, CDN, WAF and edge compute in front of your origin — proxy modes, SSL modes, caching rules, and the settings that break applications.'
---

# Cloudflare

## Introduction

Cloudflare sits between your visitors and your origin server, providing DNS,
caching, TLS, DDoS protection and a web application firewall. It is the default
choice for most sites because the free tier covers what most sites need.

**The one idea that explains everything else: the orange cloud.** Every DNS
record in Cloudflare is either **proxied** (orange cloud) or **DNS-only** (grey
cloud).

- **DNS-only** — Cloudflare answers the DNS query with your server's real IP and
  steps out of the way. It is a DNS provider and nothing more.
- **Proxied** — Cloudflare answers with _its own_ IP addresses. Traffic reaches
  Cloudflare's edge, which then contacts your origin. Caching, WAF, DDoS
  protection, TLS termination and Workers only exist on proxied records.

Almost every "Cloudflare broke my site" report is a proxied record doing
something the team did not expect. Almost every "why isn't caching working"
report is a record that is DNS-only.

**Prerequisites.** This page assumes [DNS](/knowledge-base/hosting/dns),
[SSL/TLS](/knowledge-base/hosting/ssl-tls) and
[CDN](/knowledge-base/hosting/cdn) concepts. Cloudflare is a particular
implementation of all three.

---

## Core Concepts

**Zone** — one domain and all its settings. Most configuration is per zone.

**Proxy status** — orange versus grey, per record, as above.

**Edge** — Cloudflare's global network of data centres. A user's request lands
at the nearest one.

**Origin** — your actual server. Cloudflare fetches from it on a cache miss.

**Rules** — the modern configuration engine (Cache Rules, Transform Rules,
Redirect Rules, WAF Rules). It replaced Page Rules, which are legacy and limited
to three on the free plan.

**Only proxied traffic goes through the edge.** Non-HTTP protocols — SSH, SMTP,
database connections — cannot be proxied on standard plans. Those records must
be DNS-only, which exposes the IP they point at.

---

## Setup

1. **Add the site**, and Cloudflare scans your existing DNS records.
2. **Check the imported records carefully.** The scan is best-effort and misses
   records regularly, especially mail (MX, SPF, DKIM, DMARC). A missing MX
   record means mail stops the moment you switch nameservers.
3. **Set proxy status per record** — proxy web traffic, leave mail and SSH
   DNS-only.
4. **Change nameservers at your registrar** to the two Cloudflare provides.
5. **Wait for activation**, typically minutes to a few hours.
6. **Set SSL/TLS mode to Full (strict)** — see the next section; this is the
   step people get wrong.
7. **Enable Always Use HTTPS** and **HSTS** once you are confident TLS works.

**Verify before you switch:**

```bash
dig +short example.com                # before: your origin IP
dig +short example.com @1.1.1.1       # after:  a Cloudflare IP (104.x, 172.67.x)
```

---

## SSL/TLS Modes

The setting most often configured wrongly, with real security consequences.

| Mode                              | Browser → Cloudflare | Cloudflare → Origin                  | Verdict                    |
| --------------------------------- | -------------------- | ------------------------------------ | -------------------------- |
| **Off**                           | HTTP                 | HTTP                                 | Never                      |
| **Flexible**                      | HTTPS                | **HTTP**                             | **Dangerous — see below**  |
| **Full**                          | HTTPS                | HTTPS, certificate **not** validated | Vulnerable to interception |
| **Full (strict)**                 | HTTPS                | HTTPS, certificate validated         | **Correct. Use this.**     |
| **Strict (SSL-Only Origin Pull)** | HTTPS                | HTTPS, client certificate too        | Best, needs origin setup   |

**Flexible mode is the trap.** The browser shows a padlock, so the site looks
secure, but the Cloudflare-to-origin leg is plain HTTP — readable and modifiable
by anything on that path. It also causes redirect loops when the origin
redirects HTTP to HTTPS: Cloudflare requests HTTP, the origin redirects to
HTTPS, Cloudflare requests HTTP again, forever.

**Use Full (strict).** If your origin has no valid certificate, Cloudflare
issues a free **Origin CA certificate** valid for up to 15 years — install it on
your origin and Full (strict) works immediately. It is trusted only by
Cloudflare, which is exactly what you need here.

**Authenticated Origin Pulls** goes further: the origin refuses any connection
that does not present Cloudflare's client certificate, so attackers cannot
bypass the edge by hitting your IP directly.

---

## Protecting the Origin

Proxying hides your IP — but only if it is not exposed elsewhere. Common leaks:

- A DNS-only record such as `direct.example.com` or `mail.example.com` pointing
  at the same server.
- Historical DNS records, indexed by passive DNS services.
- Outbound connections from your server, revealing its IP.
- TLS certificate transparency logs, if you issued a certificate for a subdomain
  that resolves directly.

**Assume the IP is discoverable, and firewall accordingly:**

```bash
# Allow only Cloudflare's ranges to reach ports 80/443
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from "$ip" to any port 443 proto tcp
done
ufw deny 443/tcp
```

Combine this with Authenticated Origin Pulls and the origin becomes unreachable
except through Cloudflare.

---

## Caching

Cloudflare caches **static file extensions by default** — images, CSS, JS,
fonts. It does **not** cache HTML by default, and it never caches a response
carrying `Set-Cookie` or `Cache-Control: private`.

**Respect origin headers.** Set `Cache-Control` correctly at the origin and
Cloudflare follows it. See [CDN](/knowledge-base/hosting/cdn) for the full
header model.

**Cache Rules** override that when you need to cache HTML:

```
When: hostname eq "example.com" and not starts_with(http.request.uri.path, "/admin")
Then: Eligible for cache, Edge TTL 5 minutes, Browser TTL respect origin
```

**Cache-key control** (paid plans) lets you ignore tracking query parameters, or
include a device type — the two adjustments that most affect hit rate.

**Tiered Cache** adds an upper tier between edge locations and your origin, so a
miss in one city can be served from another tier rather than from you. It is
free and reduces origin load substantially. Turn it on.

**Purging:**

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://example.com/index.html"]}'
```

Purge by URL, prefix, hostname or **cache tag** (Enterprise). Purging everything
is available and rarely a good idea — hit rate drops to zero and your origin
absorbs the refill.

**Check the result of any change:**

```bash
curl -sI https://example.com/ | grep -i 'cf-cache-status\|age\|cf-ray'
```

| `CF-Cache-Status` | Meaning                                        |
| ----------------- | ---------------------------------------------- |
| `HIT`             | Served from cache                              |
| `MISS`            | Not cached; fetched from origin and now stored |
| `EXPIRED`         | Was cached, TTL passed, revalidated            |
| `BYPASS`          | A rule or header prevented caching             |
| `DYNAMIC`         | Not eligible by default (typically HTML)       |
| `REVALIDATED`     | Revalidated with the origin, still fresh       |

`DYNAMIC` on a page you expected to be cached means you need a Cache Rule.
`BYPASS` means something — usually a cookie — is blocking it.

---

## WAF, Rate Limiting and Bots

**Managed Rules** — Cloudflare's maintained ruleset covering the common
injection and traversal classes. Free plans get a core set; paid plans get the
OWASP ruleset and application-specific packages.

**Custom Rules** — your own expressions:

```
# Block admin access outside the office
(http.request.uri.path contains "/wp-admin" and ip.src ne 203.0.113.10)

# Challenge non-GET requests from outside your country
(http.request.method ne "GET" and ip.geoip.country ne "GB")
```

Actions: **Block**, **Managed Challenge**, **JS Challenge**, **Skip**, **Log**.
Prefer **Managed Challenge** over Block for anything ambiguous — a false
positive becomes a brief interstitial rather than a locked-out customer.

**Rate limiting** protects login and API endpoints. Rate limit **before**
authentication, so credential stuffing is stopped at the edge rather than by
your application. See
[Authentication: rate limiting](/knowledge-base/security/authentication#rate-limiting).

**Bot Fight Mode** challenges suspected bots. It is blunt: it can challenge
legitimate API clients, monitoring tools and payment webhooks. **Do not enable
it on API hostnames** without testing, and add Skip rules for your own
integrations.

**Always start rules in Log mode**, examine what they would have caught in
Security Events for a few days, then switch to enforcement. This costs a few
days and saves an outage.

---

## Workers

Cloudflare's edge compute runtime — V8 isolates rather than containers, so cold
starts are effectively zero.

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', {status: 200});
    }

    const response = await fetch(request);
    const headers = new Headers(response.headers);
    headers.set('X-Frame-Options', 'DENY');
    return new Response(response.body, {...response, headers});
  },
};
```

**The storage options matter more than the compute:**

| Product             | What it is                                       | Use for                                 |
| ------------------- | ------------------------------------------------ | --------------------------------------- |
| **KV**              | Eventually consistent key-value                  | Config, feature flags, cached lookups   |
| **Durable Objects** | Strongly consistent, single-instance             | Coordination, counters, WebSocket rooms |
| **R2**              | S3-compatible object storage, **no egress fees** | Assets, uploads, backups                |
| **D1**              | SQLite at the edge                               | Small relational workloads              |
| **Queues**          | Message queue                                    | Deferring work off the request path     |

**R2's zero egress pricing** is the standout — for asset- or media-heavy sites it
is often the single largest cost saving available.

**Workers are for request manipulation**, not for your whole application. The
CPU limits are short and there is no fast path to a database in another
continent. See
[Edge compute](/knowledge-base/hosting/cdn#edge-compute).

---

## Getting the Real Client IP

Behind a proxy, your origin sees Cloudflare's IP on every request. Rate limiting
by IP, geolocation and abuse logging all break until you fix it.

Cloudflare sends the real address in **`CF-Connecting-IP`** (and standard
`X-Forwarded-For`).

```nginx
# /etc/nginx/conf.d/cloudflare.conf
# Populate from https://www.cloudflare.com/ips-v4 and ips-v6
set_real_ip_from 173.245.48.0/20;
# … all Cloudflare ranges …
real_ip_header CF-Connecting-IP;
```

**Only trust the header from Cloudflare's ranges.** A header trusted
unconditionally is a spoofable identity — an attacker sends
`CF-Connecting-IP: 1.2.3.4` directly to your origin and defeats every IP-based
control you have. See
[Reverse proxy: forwarded headers](/knowledge-base/hosting/reverse-proxy).

Cloudflare also sends `CF-IPCountry` for geolocation and `CF-Ray` — the request
identifier. **Log `CF-Ray`**: it is what Cloudflare support asks for, and it
links your logs to theirs.

---

## Settings That Break Applications

| Setting                                          | What breaks                                       |
| ------------------------------------------------ | ------------------------------------------------- |
| **Flexible SSL**                                 | Redirect loops; plaintext origin leg              |
| **Rocket Loader**                                | Reorders script execution — breaks many JS apps   |
| **Auto Minify**                                  | Retired in 2024; build tooling does this properly |
| **Email Obfuscation**                            | Injects markup into pages; can break templates    |
| **Bot Fight Mode**                               | Challenges API clients and webhooks               |
| **Always Use HTTPS** + origin redirect           | Loops if SSL mode is Flexible                     |
| **Browser Cache TTL: Respect origin** off        | Overrides your headers globally                   |
| **Caching Level: Ignore query string**           | Serves the wrong variant of a page                |
| **Proxying a WebSocket-heavy app on a low plan** | Idle-timeout disconnects                          |

**When something breaks after enabling Cloudflare, first test with the record
DNS-only.** If the problem disappears, it is a proxy setting; if it persists, it
is your application. That one step eliminates most of the guesswork.

**Development Mode** bypasses the cache for three hours — use it while
debugging, and remember it expires on its own.

---

## Do's and Don'ts

### Do

- Use **Full (strict)** SSL mode, with a Cloudflare Origin CA certificate if
  needed.
- Firewall your origin to Cloudflare's IP ranges, and enable Authenticated
  Origin Pulls.
- Verify every DNS record after the initial import, mail records especially.
- Keep mail and SSH records DNS-only.
- Configure `real_ip` so your application sees the true client address.
- Start WAF and rate-limit rules in Log mode.
- Enable Tiered Cache — it is free and reduces origin load.
- Use Cache Rules to cache HTML deliberately.
- Log `CF-Ray` with every request.
- Prefer Managed Challenge over Block for ambiguous traffic.

### Don't

- Don't use Flexible SSL, ever.
- Don't assume proxying hides your origin IP — firewall it as well.
- Don't enable Bot Fight Mode on API hostnames without testing.
- Don't trust `CF-Connecting-IP` from anywhere but Cloudflare's ranges.
- Don't enable Rocket Loader on a JavaScript application.
- Don't purge everything as part of routine deploys.
- Don't rely on Page Rules for new configuration — use the Rules engines.
- Don't leave Development Mode on and conclude that caching is broken.

---

## Common Mistakes

**Flexible SSL for the padlock.** Encrypted to Cloudflare, plaintext to the
origin, and redirect loops. Full (strict) with an Origin CA certificate.

**Losing mail on the nameserver switch.** The DNS scan missed the MX or SPF
records. Export the old zone and compare, before switching.

**Origin IP left reachable.** Attackers query passive DNS, find the old A
record, and bypass the WAF entirely. Firewall to Cloudflare ranges.

**Every request logged as a Cloudflare IP.** `real_ip` is not configured, so
rate limiting and abuse detection are meaningless.

**Trusting forwarded headers unconditionally.** Spoofable, and it defeats
IP-based controls.

**Expecting HTML to be cached.** It is `DYNAMIC` by default; you need a Cache
Rule.

**Enabling every optimisation toggle.** Rocket Loader and Email Obfuscation
rewrite your pages. Enable one at a time and test.

**Blocking your own webhooks.** Payment providers and CI systems get caught by
bot rules. Add Skip rules for known integrations.

---

## Debugging

```bash
# Is this record proxied?
dig +short example.com                       # Cloudflare IP means proxied

# What did the edge do with this request?
curl -sI https://example.com/ | grep -i 'cf-'

# Bypass Cloudflare entirely to test the origin
curl -sI https://example.com/ --resolve example.com:443:203.0.113.10
```

| Symptom                     | Cause                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| `ERR_TOO_MANY_REDIRECTS`    | Flexible SSL with an origin HTTP→HTTPS redirect                       |
| Error 521                   | Origin refused the connection — down, or firewalling Cloudflare       |
| Error 522                   | Connection timed out — origin overloaded or blocking the ranges       |
| Error 525                   | TLS handshake failed — origin certificate invalid under Full (strict) |
| Error 526                   | Invalid origin certificate under Full (strict)                        |
| Changes not visible         | Cached; purge, or check `CF-Cache-Status`                             |
| Legitimate users challenged | Bot Fight Mode or an over-broad WAF rule                              |
| All traffic from one IP     | `real_ip` not configured                                              |

**The `--resolve` trick is the most useful debugging tool here** — it sends the
request straight to your origin with the correct Host header and SNI, isolating
whether a problem is yours or the edge's.

---

## FAQ

**Is the free plan enough?**
For most sites, yes — global CDN, unlimited DDoS protection, TLS, DNS and basic
WAF. Paid plans add image optimisation, better analytics, cache-key control and
the full WAF ruleset.

**Does Cloudflare see my traffic?**
On proxied records it terminates TLS, so yes. That is inherent to a reverse
proxy, and the same is true of any CDN.

**Can I proxy non-HTTP traffic?**
Not on standard plans. Spectrum handles arbitrary TCP/UDP on Enterprise; for SSH
and databases, use DNS-only records with a firewall, or Cloudflare Tunnel.

**What is Cloudflare Tunnel?**
An outbound-only connection from your server to Cloudflare, so the origin needs
no inbound ports open at all. Excellent for internal services and home servers.

**Should I use Cloudflare as my registrar?**
It sells domains at cost with no markup and includes WHOIS privacy. It is a
reasonable choice; the main downside is fewer TLDs.

**Does it help if my users are all in one country?**
Less for latency, still meaningfully for DDoS protection, TLS termination and
origin offload.

---

## Check your understanding

<Quiz
question="A site is on Cloudflare with SSL mode set to Flexible. Users get ERR_TOO_MANY_REDIRECTS. What is happening?"
options={[
{
text: 'Cloudflare requests the origin over HTTP, the origin redirects HTTP to HTTPS, and Cloudflare requests over HTTP again — an infinite loop',
correct: true,
why: 'Flexible means the Cloudflare-to-origin leg is plain HTTP. Any origin-side HTTPS redirect can never be satisfied, so the loop never terminates.',
},
{text: 'The DNS record is proxied when it should be DNS-only', why: 'Proxying is required for TLS termination and is not what causes the loop.'},
{text: 'HSTS is misconfigured', why: 'HSTS forces HTTPS in the browser; the loop is between Cloudflare and the origin.'},
{text: 'The origin certificate has expired', why: 'That produces error 525/526 under Full (strict), not a redirect loop.'},
]}
explanation={<>Fix it by moving to <strong>Full (strict)</strong>. If the origin has no valid certificate, install a free Cloudflare Origin CA certificate — it is trusted by Cloudflare, which is all this leg requires.</>}
reference={{label: 'SSL/TLS modes', href: '/knowledge-base/cloudflare#ssltls-modes'}}
/>

<Quiz
question="An application behind Cloudflare rate-limits by IP address. After going live, every request appears to come from a handful of addresses and the rate limiter locks everyone out. What is missing?"
options={[
{
text: 'The origin is not configured to read CF-Connecting-IP, so it sees Cloudflare edge addresses as the client',
correct: true,
why: 'Behind any reverse proxy the socket peer is the proxy. The real client address arrives in a header, and the origin must be told to trust and use it.',
},
{text: 'The DNS record should be DNS-only', why: 'That would disable caching, WAF and DDoS protection to fix a header configuration problem.'},
{text: 'Rate limiting must be done in Cloudflare instead', why: 'Edge rate limiting is a good idea, and it does not explain why the origin sees the wrong addresses.'},
{text: 'IPv6 is enabled and the addresses are being truncated', why: 'Addresses are being replaced by the proxy, not truncated.'},
]}
explanation={<>Configure <code>set_real_ip_from</code> with Cloudflare's published ranges and <code>real_ip_header CF-Connecting-IP</code>. Critically, trust the header <em>only</em> from those ranges — trusted unconditionally it is spoofable, and every IP-based control becomes worthless.</>}
reference={{label: 'Getting the real client IP', href: '/knowledge-base/cloudflare#getting-the-real-client-ip'}}
/>

<Quiz
question="A team proxies their site through Cloudflare and enables the WAF. An attacker still reaches the application directly. How?"
options={[
{
text: 'The origin IP was discoverable — via a DNS-only subdomain, historical DNS records or certificate logs — and the origin accepts connections from anywhere',
correct: true,
why: 'Proxying changes what DNS answers with; it does not stop anyone who already knows the IP from connecting to it directly.',
},
{text: 'The WAF only inspects POST requests', why: 'It inspects all proxied requests; the issue is traffic that never reaches it.'},
{text: 'Cloudflare rules take 24 hours to apply', why: 'Rules apply within seconds.'},
{text: 'The attacker used IPv6, which is not proxied', why: 'Cloudflare proxies IPv6 as well.'},
]}
explanation={<>Firewall the origin to Cloudflare's published IP ranges and enable Authenticated Origin Pulls, so the origin refuses any connection not carrying Cloudflare's client certificate. Assume the IP is already known.</>}
reference={{label: 'Protecting the origin', href: '/knowledge-base/cloudflare#protecting-the-origin'}}
/>

<Quiz
question="Which of these are correct Cloudflare practices?"
type="multiple"
options={[
{text: 'Keep MX and SSH records DNS-only', correct: true, why: 'Cloudflare proxies HTTP/HTTPS only on standard plans; proxying mail or SSH records breaks them.'},
{text: 'Start new WAF and rate-limit rules in Log mode', correct: true, why: 'A few days of Security Events shows what a rule would have caught, before it can lock out real customers.'},
{text: 'Enable Tiered Cache', correct: true, why: 'Free, and a miss at one edge location can be filled from an upper tier rather than from your origin.'},
{text: 'Use Flexible SSL when the origin has no certificate', why: 'Install a free Origin CA certificate and use Full (strict). Flexible leaves the origin leg in plaintext.'},
{text: 'Enable Bot Fight Mode on API hostnames for extra protection', why: 'It challenges legitimate API clients, monitoring and payment webhooks. Test first, and add Skip rules for known integrations.'},
]}
explanation={<>The recurring theme: verify what a setting actually does to real traffic before enforcing it, and never accept plaintext on the edge-to-origin leg.</>}
reference={{label: 'Settings that break applications', href: '/knowledge-base/cloudflare#settings-that-break-applications'}}
/>

<Quiz
question="A page returns CF-Cache-Status: DYNAMIC even though it is public and identical for every visitor. What does that indicate?"
options={[
{
text: 'HTML is not cached by default — it needs a Cache Rule marking it eligible, with an edge TTL',
correct: true,
why: 'Cloudflare caches known static extensions by default. HTML is reported as DYNAMIC until a rule opts it in.',
},
{text: 'The response carries Set-Cookie', why: 'That produces BYPASS rather than DYNAMIC.'},
{text: 'Development Mode is enabled', why: 'Development Mode also reports BYPASS.'},
{text: 'The record is DNS-only', why: 'Then there would be no CF-Cache-Status header at all — the request never reaches Cloudflare.'},
]}
explanation={<>Distinguish the statuses: <code>DYNAMIC</code> means not eligible by default, <code>BYPASS</code> means something actively prevented caching (usually a cookie or Development Mode), and <code>MISS</code> means eligible but not yet stored.</>}
reference={{label: 'Caching', href: '/knowledge-base/cloudflare#caching'}}
/>

---

## References

- [Cloudflare Developer Docs](https://developers.cloudflare.com/) — the
  authoritative reference for every product.
- [SSL/TLS encryption modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/)
  — what each mode actually does.
- [Cloudflare IP ranges](https://www.cloudflare.com/ips/) — the list to firewall
  against; automate the update.
- [Cache documentation](https://developers.cloudflare.com/cache/) — cache rules,
  keys and purge behaviour.
- [Workers documentation](https://developers.cloudflare.com/workers/) — runtime,
  limits and storage products.
- [Restoring original visitor IPs](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/)
  — per-server configuration.
