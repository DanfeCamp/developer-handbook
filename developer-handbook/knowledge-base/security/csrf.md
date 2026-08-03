---
title: 'CSRF'
description: 'Preventing the browser from being used against your users — how the attack works, SameSite, synchroniser tokens, double submit, and when CSRF does not apply.'
---

# CSRF

## Introduction

Cross-site request forgery abuses a simple browser behaviour: **cookies are sent
automatically with every request to their origin, regardless of which site
triggered it.**

An attacker cannot read your site's responses — the same-origin policy prevents
that. But they can _cause_ a request, and the browser helpfully attaches the
victim's session cookie.

```html
<!-- On evil.example. The victim merely has to load this page. -->
<form action="https://bank.example/transfer" method="POST" id="f">
  <input name="to" value="attacker" />
  <input name="amount" value="10000" />
</form>
<script>
  document.getElementById('f').submit();
</script>
```

If the victim is logged into `bank.example`, their session cookie is attached and
the transfer executes. **The attacker never sees the response, and does not need
to** — the side effect is the attack.

**The essential asymmetry:** CSRF exploits requests where _making_ them is
valuable. That is why it targets state changes and why `GET` requests must never
change state.

**The modern position.** `SameSite=Lax` became the browser default, which
removed the majority of classic CSRF. It is a substantial improvement and **not
a complete fix** — the gaps are covered below, and tokens remain the correct
control for state-changing requests.

---

## When CSRF Applies

Worth establishing precisely, because a great deal of unnecessary CSRF machinery
gets added to APIs that cannot be attacked this way.

**CSRF applies when the browser attaches credentials automatically:**

- Cookie-based sessions ✅
- HTTP Basic authentication ✅
- Client TLS certificates ✅

**CSRF does not apply when credentials are attached explicitly by script:**

- `Authorization: Bearer <token>` ❌
- A custom header such as `X-API-Key` ❌

The reason: an attacker's page cannot set an `Authorization` header on a
cross-origin request. A `fetch` that tries triggers a CORS preflight, and your
server will not approve it. A form submission cannot set custom headers at all.

**So:** a token-authenticated API needs no CSRF protection. A cookie-session web
application does. A "hybrid" that accepts cookies _or_ a bearer token needs
protection, because the cookie path is attackable.

---

## Defences

### SameSite cookies

The first line, and now on by default.

```http
Set-Cookie: __Host-session=…; HttpOnly; Secure; SameSite=Lax; Path=/
```

| Value    | Cross-site behaviour                                      |
| -------- | --------------------------------------------------------- |
| `Strict` | Never sent — including a link clicked from another site   |
| `Lax`    | Sent only on top-level `GET` navigations. **The default** |
| `None`   | Always sent. Requires `Secure`                            |

`Lax` blocks cross-site `POST`, which is the classic attack above. It still
allows a user arriving from an email link to be logged in, which is why it is
preferred over `Strict` for the main session.

**Why it is not sufficient on its own:**

- **`GET` requests still carry the cookie** on top-level navigation. Any
  state-changing `GET` remains exploitable — another reason `GET` must be safe.
- **A same-site attacker defeats it.** A vulnerable or third-party subdomain is
  _same-site_, so `SameSite` does not apply between them.
- **Some clients and older browsers ignore it**, and non-browser clients do as
  they please.
- **`SameSite=None`** is required for genuinely cross-site flows, and turns the
  protection off entirely.

Treat it as valuable defence in depth.

### Synchroniser token pattern

The standard, strongest defence. The server issues a random token, embeds it in
the form, and verifies it on submission.

```html
<form method="POST" action="/transfer">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}" />
  …
</form>
```

```ts
// Verify on every state-changing request
if (!timingSafeEqual(Buffer.from(req.body._csrf ?? ''), Buffer.from(req.session.csrfToken))) {
  return res.status(403).json({error: 'Invalid CSRF token'});
}
```

It works because the attacker's page **cannot read the token**. Fetching your
form cross-origin and extracting the hidden field is blocked by the same-origin
policy — which is precisely the property CSRF otherwise exploits.

Requirements:

- **Cryptographically random**, at least 128 bits.
- **Bound to the session**, not a global value.
- **Compared in constant time**, as above.
- **Rotated on login**, alongside the session id.
- **Never in a URL**, where it leaks via history, logs and referrers.

### Double submit cookie

For stateless servers with nowhere to store the expected token: send the same
value as both a cookie and a form field, and compare them.

```ts
res.cookie('csrf', token, {sameSite: 'lax', secure: true}); // readable by JS deliberately
// The client copies it into a header or field; the server compares the two.
```

Simple, and **weaker**. A same-site attacker — a compromised subdomain — can set
a cookie for the parent domain and then submit a matching value. Use the
**signed** variant, where the cookie value is an HMAC bound to the session, and
prefer the synchroniser pattern where you can store state.

### Custom header for AJAX

For a JavaScript client, requiring a custom header is a clean defence:

```ts
fetch('/api/transfer', {
  method: 'POST',
  headers: {'X-CSRF-Token': token, 'Content-Type': 'application/json'},
  credentials: 'same-origin',
});
```

A cross-origin request carrying a custom header triggers a CORS preflight, and
your server will not approve an unknown origin. An HTML form cannot set custom
headers at all.

**Note the `Content-Type` matters.** Forms can only send
`application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`.
Requiring `application/json` — and rejecting the others — is itself a partial
defence, though it should not be your only one.

### Origin and Referer checking

Cheap, and useful as an additional layer:

```ts
const origin = req.headers.origin ?? new URL(req.headers.referer ?? '').origin;
if (origin && origin !== config.appOrigin) {
  return res.status(403).json({error: 'Cross-origin request rejected'});
}
```

Modern browsers send `Origin` on state-changing requests. `Referer` can be
stripped by privacy tools and proxies, so **do not reject solely because it is
absent** — that breaks legitimate users.

---

## Framework Support

Most frameworks provide this. Use theirs rather than writing your own.

| Framework   | Mechanism                                                             |
| ----------- | --------------------------------------------------------------------- |
| **Laravel** | `VerifyCsrfToken` middleware, `@csrf` in Blade                        |
| **Django**  | `CsrfViewMiddleware`, `{% csrf_token %}`                              |
| **Rails**   | `protect_from_forgery`, on by default                                 |
| **Spring**  | Enabled by default in Spring Security                                 |
| **Express** | `csrf-csrf` or `csurf` (deprecated — prefer the former)               |
| **Next.js** | Server Actions include an origin check; add tokens for route handlers |

**Exempting an endpoint should be deliberate and rare.** The usual legitimate
case is a webhook receiver, which is authenticated by
[signature](/knowledge-base/apis/webhooks#verify-the-signature) rather than by a
session cookie — and therefore is not CSRF-attackable in the first place.

---

## Common Mistakes

**State-changing `GET` requests.** `GET /posts/42/delete` is exploitable with
nothing more than an `<img src>` tag, and `SameSite=Lax` does not help because
top-level `GET` navigations still carry the cookie.

**Adding CSRF protection to a bearer-token API.** Not attackable, and now you
have added complexity and a source of confusing 403s.

**A global CSRF token rather than a per-session one.** An attacker signs up,
receives a valid token, and uses it against other users.

**Comparing tokens with `===`.** Use a constant-time comparison; a
byte-by-byte comparison leaks the token through timing.

**Rejecting requests with no `Referer`.** Privacy tools and corporate proxies
strip it. Prefer `Origin`, and fall back gracefully.

**Relying on `SameSite` alone.** It does not protect against a same-site
attacker, and it is disabled entirely when you set `None`.

**Not rotating the token on login.** Allows a fixation-style attack on the CSRF
token itself.

**Exempting endpoints to fix a bug.** The 403 is usually a missing token in one
form, not a reason to disable the protection.

---

## Testing

```ts
it('rejects a state-changing request with no CSRF token', async () => {
  await request(app).post('/transfer')
    .set('Cookie', sessionCookie)
    .send({to: 'attacker', amount: 10000})
    .expect(403);
});

it('rejects a token belonging to a different session', async () => {
  await request(app).post('/transfer')
    .set('Cookie', sessionCookie)
    .send({_csrf: otherSessionToken, to: 'x', amount: 1})
    .expect(403);
});

it('rejects a cross-origin Origin header', async () => {
  await request(app).post('/transfer')
    .set('Cookie', sessionCookie)
    .set('Origin', 'https://evil.example')
    .send({_csrf: validToken})
    .expect(403);
});
```

The second test is the one people omit, and it is what catches a global rather
than per-session token.

---

## Do's and Don'ts

### Do

- Set `SameSite=Lax` (or `Strict`) on session cookies.
- Use your framework's CSRF protection for cookie-authenticated requests.
- Use a per-session, cryptographically random token.
- Compare tokens in constant time.
- Rotate the token when the session id rotates.
- Check the `Origin` header as an additional layer.
- Keep `GET` requests free of side effects.
- Require a custom header or JSON content type for AJAX endpoints.

### Don't

- Don't change state on `GET`.
- Don't add CSRF tokens to a bearer-token-only API.
- Don't use a global or static token.
- Don't put the token in a URL.
- Don't rely on `SameSite` as the only defence.
- Don't reject purely because `Referer` is missing.
- Don't use unsigned double-submit where you can store session state.
- Don't disable protection to make an error go away.

---

## Debugging

| Symptom                                 | Cause and fix                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| 419 / 403 on every form submission      | The token is missing from the form, or the session cookie is not being sent.         |
| Works locally, fails in production      | `Secure` cookie on HTTP, or a mismatched cookie domain.                              |
| Fails only after a period of inactivity | The session expired, so the token no longer matches. Handle it with a clear message. |
| Fails for SPA requests only             | The client is not sending the token header, or `credentials` is not set.             |
| Fails after login                       | The token was not rotated with the session id.                                       |
| Intermittent failures across tabs       | A global token being regenerated per request while an old page holds a stale one.    |
| Webhook endpoint returns 403            | It should be exempt — it is signature-authenticated, not cookie-authenticated.       |

---

## FAQ

**Do I still need CSRF tokens with `SameSite=Lax`?**
Yes for cookie-authenticated state changes. `SameSite` does not cover same-site
attackers or clients that ignore it, and it is defence in depth rather than a
complete control.

**Does a bearer-token API need CSRF protection?**
No. An attacker's page cannot set an `Authorization` header cross-origin. Adding
tokens there is unnecessary complexity.

**What about a JWT stored in a cookie?**
Then it behaves like a cookie session and **is** CSRF-attackable. The
authentication format is irrelevant; automatic credential attachment is what
matters.

**Is `SameSite=Strict` better?**
More restrictive, and it stops users arriving logged in from external links,
which reads as a bug. A common pattern is `Lax` for the session plus `Strict`
for a separate high-privilege cookie.

**Do GraphQL APIs need protection?**
If cookie-authenticated, yes. Requiring `application/json` and a custom header
helps, since a form cannot produce either.

**Does CORS prevent CSRF?**
No, and this is a common misunderstanding. CORS governs whether script may
**read** a cross-origin response. CSRF does not need the response. A form
submission is not subject to CORS at all. See
[CORS](/knowledge-base/security/cors).

---

## Check your understanding

<Quiz
question="An API authenticates exclusively with `Authorization: Bearer <token>` set by JavaScript. Does it need CSRF protection?"
options={[
{
text: 'No — an attacker\'s page cannot set an Authorization header on a cross-origin request, so the browser never attaches credentials automatically',
correct: true,
why: 'CSRF depends on the browser attaching credentials without the attacker\'s involvement. A bearer token is attached by your own script, and a cross-origin fetch attempting a custom header triggers a preflight your server will reject.',
},
{text: 'Yes — every state-changing endpoint needs CSRF protection', why: 'A blanket rule that adds complexity and confusing 403s where no attack is possible.'},
{text: 'Yes, unless the API also sets SameSite cookies', why: 'If there are no cookies, there is nothing for SameSite to govern.'},
{text: 'Only for endpoints that accept JSON', why: 'Content type affects which form-based attacks are possible; it does not change how bearer tokens are attached.'},
]}
explanation={<>The test is whether the browser attaches credentials automatically. Cookies and Basic auth: yes. An explicitly-set header: no. A hybrid API accepting either <em>does</em> need protection, because the cookie path is attackable.</>}
reference={{label: 'When CSRF applies', href: '/knowledge-base/security/csrf#when-csrf-applies'}}
/>

<Quiz
question="Why can an attacker's page not simply read the CSRF token from your form and include it?"
options={[
{
text: 'The same-origin policy prevents script on another origin from reading your page\'s response, so the token is unobtainable',
correct: true,
why: 'The attacker can cause a request but cannot read what comes back. That asymmetry is what CSRF exploits, and it is exactly what makes an unguessable per-session token effective.',
},
{text: 'The token is encrypted, so it cannot be understood', why: 'It is typically a random value in plain text in the HTML. Secrecy comes from the origin boundary, not encryption.'},
{text: 'Browsers strip hidden form fields from cross-origin responses', why: 'No such mechanism exists — the whole response is simply unreadable cross-origin.'},
{text: 'The token expires too quickly to be used', why: 'Rotation helps, but the primary protection is that the token cannot be read at all.'},
]}
explanation={<>This also explains the same-site attacker gap: a compromised <em>subdomain</em> may be able to read or set cookies for the parent domain, which is why unsigned double-submit is weaker than the synchroniser pattern.</>}
reference={{label: 'Synchroniser token pattern', href: '/knowledge-base/security/csrf#synchroniser-token-pattern'}}
/>

<Quiz
question="An application uses `GET /posts/42/delete` for deletions, and the session cookie is SameSite=Lax. Is it protected?"
options={[
{
text: 'No — Lax still sends the cookie on top-level GET navigations, so a link or redirect from an attacker\'s page performs the deletion',
correct: true,
why: 'Lax specifically permits top-level GET. A state-changing GET is exploitable with an <img> tag or a link, which is why safe methods must have no side effects.',
},
{text: 'Yes — Lax blocks all cross-site requests', why: 'It blocks cross-site POST. Top-level GET navigation is explicitly allowed so that inbound links work.'},
{text: 'Yes, provided the endpoint also requires authentication', why: 'The victim is authenticated — that is the point of the attack.'},
{text: 'Only if the deletion is idempotent', why: 'Idempotency concerns repeat safety, not whether the request should be causable cross-site.'},
]}
explanation={<>Use <code>DELETE</code> or <code>POST</code> for state changes, and keep <code>GET</code> genuinely safe. This is also why crawlers and prefetchers can wreak havoc on state-changing GET endpoints, entirely without malice.</>}
reference={{label: 'SameSite cookies', href: '/knowledge-base/security/csrf#samesite-cookies'}}
/>

<Quiz
question="Which of these are genuine weaknesses of relying on SameSite=Lax alone?"
type="multiple"
options={[
{text: 'A compromised subdomain is same-site, so SameSite does not apply between them', correct: true, why: 'SameSite operates at the registrable-domain level. A vulnerable subdomain is not cross-site and is unaffected by the restriction.'},
{text: 'Top-level GET navigations still carry the cookie', correct: true, why: 'Which leaves any state-changing GET exploitable.'},
{text: 'Setting SameSite=None for a legitimate cross-site flow disables the protection entirely', correct: true, why: 'Embedded widgets and SSO iframes often require None, at which point the defence is gone.'},
{text: 'Some clients and older browsers ignore the attribute', correct: true, why: 'Non-browser clients and legacy browsers do not enforce it.'},
{text: 'It prevents your own JavaScript from sending the cookie on same-origin requests', why: 'Same-origin requests are unaffected — SameSite only governs cross-site ones.'},
]}
explanation={<>SameSite removed most classic CSRF and is genuinely valuable. Keep tokens for state-changing requests; the two together cover the gaps neither closes alone.</>}
reference={{label: 'Defences', href: '/knowledge-base/security/csrf#defences'}}
/>

<Quiz
question="A team is told that CORS protects them from CSRF. Is that correct?"
options={[
{
text: 'No — CORS controls whether script may read a cross-origin response. CSRF does not need the response, and form submissions are not subject to CORS at all',
correct: true,
why: 'The attack is the side effect of the request, not the data returned. A cross-origin form POST is a "simple request" that the browser sends without any CORS approval.',
},
{text: 'Yes — CORS blocks all cross-origin requests', why: 'It does not block requests; it governs whether the response may be read by script.'},
{text: 'Yes, provided Access-Control-Allow-Origin is not a wildcard', why: 'The header affects response readability, not whether the request reached the server and had its effect.'},
{text: 'Only for requests that trigger a preflight', why: 'Preflighted requests are indeed constrained — but the classic CSRF vector is a form POST, which is never preflighted.'},
]}
explanation={<>This is one of the most persistent misunderstandings in web security. CORS is about <em>reading</em>; CSRF is about <em>causing</em>. They solve different problems and neither substitutes for the other.</>}
reference={{label: 'FAQ', href: '/knowledge-base/security/csrf#faq'}}
/>

---

## References

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
  — the definitive treatment of each defence and its limits.
- [MDN: SameSite cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
  — behaviour of each value.
- [RFC 9110: Safe methods](https://www.rfc-editor.org/rfc/rfc9110.html#name-safe-methods)
  — why `GET` must not change state.
- [csrf-csrf](https://github.com/Psifi-Solutions/csrf-csrf) — the maintained
  Express middleware, `csurf` having been deprecated.
- [Sessions and Cookies](/knowledge-base/security/sessions-and-cookies) — cookie
  attributes in full.
