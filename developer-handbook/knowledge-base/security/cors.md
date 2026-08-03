---
title: 'CORS'
description: 'Why the browser blocks your request, and how to fix it properly — the same-origin policy, preflight, credentials, and the misconfigurations that leak data.'
---

# CORS

## Introduction

Cross-Origin Resource Sharing is the mechanism by which a server tells the
browser that another origin is allowed to read its responses.

**It exists because of the same-origin policy**, which is the foundation of web
security: script on `evil.example` must not be able to read data from
`bank.example`, even though the browser holds the user's session for both. CORS
is a controlled, opt-in relaxation of that rule.

**The single most important clarification**, and the source of most confusion:

:::warning CORS is a browser restriction on _reading_, not a server protection
CORS does **not** stop a request reaching your server. The request is sent, your
handler runs, and the database is written. The browser then refuses to hand the
_response_ to the calling script.

It is therefore **not an access control**. `curl`, Postman, a mobile app and any
server-side client ignore CORS entirely. Authentication and
[authorisation](/knowledge-base/security/authorization) are what protect your
API; CORS decides which web origins may read the answer.
:::

An **origin** is scheme + host + port. All three must match, so
`https://example.com` and `https://api.example.com` are different origins, as
are `http://` and `https://` versions of the same host.

---

## Simple and Preflighted Requests

The browser splits cross-origin requests into two categories, and knowing which
you have explains most CORS behaviour.

**A "simple" request** is sent immediately, and CORS is evaluated only on the
response. It qualifies if it is `GET`, `HEAD` or `POST`, uses only
CORS-safelisted headers, and has a `Content-Type` of
`application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`.

**Everything else is preflighted.** The browser first sends an `OPTIONS` request
asking permission:

```http
OPTIONS /api/orders HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, authorization
```

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

Only if the preflight succeeds does the browser send the real request.

**Note the security consequence of the simple-request rule:** a cross-origin
`POST` with `Content-Type: application/x-www-form-urlencoded` is sent _without_
a preflight. That is exactly what an HTML form does, and it is why CORS provides
no defence against [CSRF](/knowledge-base/security/csrf).

Sending `Content-Type: application/json` forces a preflight, which is why an API
that requires JSON gets a small amount of incidental protection.

---

## The Headers

| Header                             | Purpose                                        |
| ---------------------------------- | ---------------------------------------------- |
| `Access-Control-Allow-Origin`      | Which origin may read the response             |
| `Access-Control-Allow-Methods`     | Methods permitted (preflight response)         |
| `Access-Control-Allow-Headers`     | Request headers permitted (preflight response) |
| `Access-Control-Allow-Credentials` | Whether cookies and auth headers may be sent   |
| `Access-Control-Expose-Headers`    | Which **response** headers script may read     |
| `Access-Control-Max-Age`           | How long the preflight result may be cached    |

**`Access-Control-Expose-Headers` is the one people miss.** By default, script
can read only a handful of response headers. If your client needs
`X-Total-Count`, `X-Request-Id` or a rate-limit header, you must list it — this
is why "the header is in DevTools but `response.headers.get()` returns null".

---

## Configuration

```ts
import cors from 'cors';

app.use(
  cors({
    origin: ['https://app.example.com', 'https://admin.example.com'], // explicit list
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count', 'X-Request-Id'],
    maxAge: 86400,
  }),
);
```

Without a library:

```ts
const ALLOWED = new Set(['https://app.example.com', 'https://admin.example.com']);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Echo only origins from the allowlist — never reflect arbitrarily.
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin'); // so caches do not mix up responses
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  next();
});
```

**`Vary: Origin` is required whenever the allowed origin depends on the request.**
Without it, a shared cache or CDN can store the response for one origin and
serve it to another, producing intermittent failures that are extremely
confusing to debug.

---

## The Dangerous Misconfigurations

### Reflecting any origin with credentials

The one that turns a CORS setting into a data breach:

```ts
// ❌ Reflects whatever origin asked, and permits cookies.
res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

Any site the user visits can now make authenticated requests to your API **and
read the responses**, using the victim's session cookie. That is arbitrary data
exfiltration from every logged-in user.

The browser explicitly forbids `Access-Control-Allow-Origin: *` together with
credentials — which is why people reflect the origin instead, reproducing the
hole the rule was meant to close.

**Always use an explicit allowlist.**

### Sloppy origin matching

```ts
// ❌ Matches evil-example.com, and example.com.attacker.com
if (origin.endsWith('example.com')) allow();

// ❌ Matches https://example.com.evil.com
if (origin.includes('example.com')) allow();

// ✅ Exact comparison against a known set
if (ALLOWED.has(origin)) allow();
```

Substring and suffix matching have both been exploited in the wild. Compare
whole origins.

For dynamic subdomains, parse rather than pattern-match:

```ts
const url = new URL(origin);
const ok = url.protocol === 'https:' && url.hostname.endsWith('.tenants.example.com');
```

### Allowing `null`

```ts
// ❌ `null` is the Origin sent by sandboxed iframes and file:// pages
if (origin === 'null') allow();
```

An attacker can produce a `null` origin from a sandboxed iframe on their own
page. Never allowlist it.

### Wildcards with credentials

`Access-Control-Allow-Origin: *` is appropriate for a genuinely public API with
no authentication — a public data feed, fonts, images. It is incompatible with
credentials, and the browser will refuse the combination.

---

## Debugging

CORS errors are frustrating largely because the browser's message is
deliberately vague, and because the failure often has nothing to do with CORS.

| Symptom                                   | Cause and fix                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| "No 'Access-Control-Allow-Origin' header" | The server did not send it — often because the request errored before your CORS middleware ran. |
| Works in Postman, fails in the browser    | Expected: only browsers enforce CORS. It tells you nothing about the server.                    |
| Preflight fails with 404 or 405           | The route does not handle `OPTIONS`. Register the handler.                                      |
| Preflight fails with 401                  | Auth middleware is running before CORS. **`OPTIONS` carries no credentials** — exempt it.       |
| Works for `GET`, fails for `POST`         | The method or `Content-Type` is not in the preflight allowlist.                                 |
| Credentials not sent                      | `credentials: 'include'` missing on the client, **and** `Allow-Credentials` on the server.      |
| Response header unreadable in script      | Add it to `Access-Control-Expose-Headers`.                                                      |
| Intermittent failures behind a CDN        | Missing `Vary: Origin`.                                                                         |
| Fails only in production                  | The production origin is not in the allowlist, or HTTP vs HTTPS.                                |

**The 401-on-preflight case is worth emphasising.** A preflight `OPTIONS`
deliberately carries no cookies or `Authorization` header. Authentication
middleware registered before CORS rejects it, the browser reports a CORS error,
and the actual problem is middleware ordering. Register CORS first, and let
`OPTIONS` through unauthenticated.

```bash
# Simulate a preflight from the command line
curl -i -X OPTIONS https://api.example.com/orders \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

**A "CORS error" often means the server returned a 500.** The error response had
no CORS headers, so the browser reports the missing header rather than the
underlying failure. Check the server logs before changing CORS configuration.

---

## When You Do Not Need CORS

A great deal of CORS configuration exists to solve problems that have a better
answer.

**Same-origin requests need none.** If your frontend and API are both on
`example.com`, there is nothing to configure. A CORS error on your own API
usually means a subdomain or port mismatch you did not intend.

**A dev-server proxy** removes CORS from local development entirely:

```ts title="vite.config.ts"
export default defineConfig({
  server: {proxy: {'/api': {target: 'http://localhost:3000', changeOrigin: true}}},
});
```

**A reverse proxy in production** does the same: serve the API under
`example.com/api` rather than `api.example.com`, and everything is same-origin.
See [Reverse Proxy](/knowledge-base/hosting/reverse-proxy).

**Server-to-server calls ignore CORS.** If a request is failing between two
backends, CORS is not involved.

---

## Related Headers

CORS controls reading. Two neighbours control embedding and isolation:

**`Cross-Origin-Resource-Policy`** — declares who may embed a resource:

```http
Cross-Origin-Resource-Policy: same-origin
```

**`Cross-Origin-Opener-Policy`** and **`Cross-Origin-Embedder-Policy`** enable
cross-origin isolation, which is required for `SharedArrayBuffer` and
high-resolution timers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

And `frame-ancestors` in a
[Content Security Policy](/knowledge-base/security/xss#content-security-policy)
controls who may frame your page — the modern replacement for
`X-Frame-Options`.

---

## Do's and Don'ts

### Do

- Use an explicit allowlist of origins.
- Send `Vary: Origin` whenever the allowed origin varies.
- Register CORS middleware before authentication.
- Let `OPTIONS` through unauthenticated.
- List headers clients need to read in `Access-Control-Expose-Headers`.
- Set `Access-Control-Max-Age` to cut preflight traffic.
- Use a dev-server proxy locally instead of loosening production settings.
- Check the server logs before assuming a CORS error is about CORS.

### Don't

- Don't reflect `req.headers.origin` unconditionally.
- Don't combine credentials with a reflected or wildcard origin.
- Don't match origins with `includes()`, `endsWith()` or a loose regex.
- Don't allowlist `null`.
- Don't treat CORS as authentication or authorisation.
- Don't expect CORS to prevent CSRF.
- Don't disable CORS checks in the browser to "fix" development.
- Don't add wildcard CORS to an authenticated API.

---

## FAQ

**Why does it work in Postman but not the browser?**
Only browsers enforce CORS. Postman, `curl` and server-side clients ignore it
entirely — which is also why it is not a security control.

**Does CORS protect my API?**
No. It stops _other websites' JavaScript_ reading your responses in a user's
browser. Anything else reaches your API unimpeded.

**Does CORS prevent CSRF?**
No. CSRF does not need to read the response, and a cross-origin form `POST` is a
simple request that is never preflighted. See
[CSRF](/knowledge-base/security/csrf).

**Can I use `*` with credentials?**
No — the browser rejects the combination. Use an explicit allowlist.

**How do I support many customer domains?**
Store the allowed origins and check the incoming one against that store, with an
exact comparison. Never reflect arbitrarily.

**Why can I see the header in DevTools but not in code?**
Response headers are not readable by script unless listed in
`Access-Control-Expose-Headers`.

**Is `Access-Control-Max-Age` worth setting?**
Yes — without it, every non-simple request pays a preflight round trip. Browsers
cap the value (Chromium at two hours), but any caching helps.

---

## Check your understanding

<Quiz
question="A developer says 'we don't need authentication on this internal API because CORS only allows our frontend'. What is wrong?"
options={[
{
text: 'CORS is enforced by browsers only — curl, Postman, a script or any server-side client reaches the API and reads the response regardless',
correct: true,
why: 'CORS restricts what other websites\' JavaScript may read in a user\'s browser. It is not an access control, and anything outside a browser ignores it entirely.',
},
{text: 'Nothing — a strict CORS allowlist is a valid access control', why: 'It constrains one specific client type. Every other client is unaffected.'},
{text: 'It is fine provided credentials are set to true', why: 'Credentials handling changes nothing about non-browser clients.'},
{text: 'It only fails if the API is on a public IP', why: 'Reachability is the issue, and any client that can reach it ignores CORS.'},
]}
explanation={<>Note too that CORS does not even block the <em>request</em> from a browser — the handler runs and the write happens. It only withholds the response from the calling script.</>}
reference={{label: 'Introduction', href: '/knowledge-base/security/cors#introduction'}}
/>

<Quiz
question="An API reflects the incoming Origin header into Access-Control-Allow-Origin and sets Allow-Credentials: true. What is the impact?"
options={[
{
text: 'Any website a logged-in user visits can make authenticated requests to the API and read the responses — arbitrary data exfiltration from every user',
correct: true,
why: 'The reflection makes every origin allowed, and credentials mean the victim’s session cookie is attached. This reproduces exactly the hole that the ban on wildcard-plus-credentials exists to prevent.',
},
{text: 'Nothing — reflecting the origin is the standard way to support multiple clients', why: 'The standard way is an explicit allowlist. Unconditional reflection allows everyone.'},
{text: 'Only a problem if the API lacks authentication', why: 'Authentication is what makes it damaging: the browser attaches the victim’s cookies automatically.'},
{text: 'It breaks the preflight, so requests will fail', why: 'It works perfectly — which is why the misconfiguration survives.'},
]}
explanation={<>The browser forbids <code>Allow-Origin: *</code> with credentials for this reason. Reflecting the origin is how developers accidentally route around that protection.</>}
reference={{label: 'Reflecting any origin with credentials', href: '/knowledge-base/security/cors#reflecting-any-origin-with-credentials'}}
/>

<Quiz
question="A POST to an API fails with a CORS error. The preflight OPTIONS request returns 401. What is the likely cause?"
options={[
{
text: 'Authentication middleware runs before the CORS handler, and a preflight deliberately carries no credentials — so it is rejected before CORS headers are added',
correct: true,
why: 'The browser sends OPTIONS without cookies or Authorization by design. Register CORS first and exempt OPTIONS from authentication.',
},
{text: 'The client is not sending its token on the preflight', why: 'It is not supposed to. Preflights are intentionally credential-free.'},
{text: 'The token has expired', why: 'That would produce a 401 on the real request, not on a preflight that never carries a token.'},
{text: 'The Origin header is missing from the preflight', why: 'Browsers always include Origin on a preflight.'},
]}
explanation={<>Middleware ordering causes a large share of CORS errors. The general lesson: a "CORS error" often means the server failed before it could add the headers — check the status code and the server logs first.</>}
reference={{label: 'Debugging', href: '/knowledge-base/security/cors#debugging'}}
/>

<Quiz
question="Which origin-matching implementations are unsafe?"
type="multiple"
options={[
{text: "origin.endsWith('example.com')", correct: true, why: 'Matches evil-example.com, which an attacker can register.'},
{text: "origin.includes('example.com')", correct: true, why: 'Matches https://example.com.attacker.com.'},
{text: "origin === 'null' allowed for local file testing", correct: true, why: 'A sandboxed iframe on an attacker\'s page produces a null origin, so allowlisting it allows them.'},
{text: 'A Set of exact origin strings checked with has()', why: 'Exact whole-origin comparison — the correct approach.'},
{text: 'Parsing with new URL() and checking protocol plus an exact hostname suffix after a dot', why: 'Correct for dynamic subdomains, because parsing prevents the substring tricks that catch out naive matching.'},
]}
explanation={<>All three unsafe variants have been exploited in real deployments. Compare whole origins, and where subdomains must be dynamic, parse the URL rather than pattern-matching the string.</>}
reference={{label: 'Sloppy origin matching', href: '/knowledge-base/security/cors#sloppy-origin-matching'}}
/>

<Quiz
question="A client reads a pagination total from an X-Total-Count response header. It is visible in DevTools but response.headers.get('X-Total-Count') returns null. Why?"
options={[
{
text: 'Script can only read a small safelist of cross-origin response headers — anything else must be named in Access-Control-Expose-Headers',
correct: true,
why: 'The browser receives the header (hence DevTools showing it) but withholds it from script unless the server explicitly exposes it.',
},
{text: 'The header name is case-sensitive in the fetch API', why: 'Header lookups are case-insensitive.'},
{text: 'Custom headers must be prefixed with X-Custom-', why: 'No such requirement exists.'},
{text: 'The response needs Access-Control-Allow-Headers to include it', why: 'Allow-Headers governs which _request_ headers may be sent. Expose-Headers governs which _response_ headers may be read.'},
]}
explanation={<>The Allow-Headers / Expose-Headers distinction — request versus response — is one of the most common CORS mix-ups, and the DevTools-shows-it-but-code-cannot-read-it symptom is the giveaway.</>}
reference={{label: 'The headers', href: '/knowledge-base/security/cors#the-headers'}}
/>

---

## References

- [MDN: Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
  — the definitive explanation, including simple vs preflighted requests.
- [Fetch Standard: CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol)
  — the normative specification.
- [PortSwigger: CORS vulnerabilities](https://portswigger.net/web-security/cors)
  — labs demonstrating the misconfigurations above.
- [OWASP: HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#cross-origin-resource-sharing)
  — CORS-specific guidance.
- [web.dev: Cross-origin isolation](https://web.dev/articles/coop-coep) — COOP,
  COEP and CORP.
