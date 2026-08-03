---
title: 'Sessions and Cookies'
description: 'Keeping users logged in safely — cookie attributes, SameSite, session storage, expiry, and why localStorage is the wrong place for a token.'
---

# Sessions and Cookies

## Introduction

HTTP is stateless: each request arrives with no memory of the last. A **session**
is how a server remembers that this request comes from someone who logged in
five minutes ago, and a **cookie** is how the browser carries that identity.

**The mechanism.** After a successful login the server issues a session
identifier. The browser stores it and sends it automatically with every
subsequent request to that origin. The server looks it up and knows who is
calling.

**Why the details matter.** The session identifier _is_ the user's identity for
the lifetime of the session. Anyone who obtains it is that user — no password
required, and often no way for the victim to notice. Almost every rule on this
page exists to keep that value out of an attacker's hands.

---

## Cookie Attributes

Six attributes, and the security ones are not optional.

```http
Set-Cookie: session=abc123;
            HttpOnly;
            Secure;
            SameSite=Lax;
            Path=/;
            Max-Age=3600
```

| Attribute             | Effect                                  | Verdict                                   |
| --------------------- | --------------------------------------- | ----------------------------------------- |
| **`HttpOnly`**        | JavaScript cannot read it               | **Always, for session cookies**           |
| **`Secure`**          | Sent only over HTTPS                    | **Always**                                |
| **`SameSite`**        | Controls sending on cross-site requests | **`Lax` or `Strict`**                     |
| `Domain`              | Which hosts receive it                  | Omit unless you need subdomains           |
| `Path`                | Which paths receive it                  | Usually `/`                               |
| `Max-Age` / `Expires` | Lifetime                                | Set one; otherwise it is a session cookie |

**`HttpOnly` is the single most valuable one.** It means an
[XSS](/knowledge-base/security/xss) vulnerability cannot read the session
cookie. The attacker can still act _as_ the user while the page is open, which
is bad — but they cannot exfiltrate the token and reuse it later from their own
machine. That difference is the whole argument against storing tokens in
`localStorage`.

**`Domain` widens rather than narrows.** Setting `Domain=example.com` sends the
cookie to `app.example.com`, `blog.example.com` and every other subdomain —
including one running third-party software you do not control. Omit it unless
subdomain sharing is a requirement.

### SameSite

The attribute that mitigates [CSRF](/knowledge-base/security/csrf), and the one
people misconfigure.

| Value        | Sent on cross-site requests?                                 |
| ------------ | ------------------------------------------------------------ |
| **`Strict`** | Never — including when following a link from another site    |
| **`Lax`**    | Only on top-level `GET` navigations. **The browser default** |
| **`None`**   | Always. **Requires `Secure`**                                |

**`Lax` is the right default.** It blocks cross-site `POST`, which is the usual
CSRF vector, while still allowing a user who clicks a link from an email to
arrive logged in. `Strict` breaks that link-arrival experience, which surprises
users — a common pattern is `Strict` for a separate high-privilege cookie and
`Lax` for the main session.

**`SameSite=None` requires `Secure`**, and browsers silently reject the cookie
without it. If you need genuine cross-site cookies — an embedded widget, an SSO
iframe — you need both, and you should expect increasing browser restrictions on
third-party cookies to affect you.

**`SameSite` is a defence in depth, not a complete CSRF fix.** It does not
protect against a same-site attacker (a vulnerable subdomain), and older clients
may ignore it. Keep CSRF tokens for state-changing requests.

### Cookie prefixes

An under-used hardening measure. The browser enforces the rules, so a
misconfiguration becomes a rejected cookie rather than a silent weakness:

```http
Set-Cookie: __Host-session=abc123; Secure; Path=/; HttpOnly; SameSite=Lax
```

- **`__Secure-`** — the browser requires `Secure`.
- **`__Host-`** — requires `Secure`, `Path=/`, and **no `Domain`**, so the
  cookie is locked to the exact host. This prevents a compromised subdomain
  overwriting your session cookie.

`__Host-` is the strongest option for a session cookie and costs nothing.

---

## Where to Store the Session

### Server-side sessions

The identifier is opaque and meaningless; the data lives on the server.

```ts
// The cookie contains only a random id
Set-Cookie: __Host-session=8f3a2b9c...

// Redis holds the state
session:8f3a2b9c → {userId: 42, roles: ['customer'], createdAt: …}
```

**Revocation is immediate** — delete the key and the session is gone. That
single property is why this remains the right default for browser applications.

Store sessions in Redis or a database, **never in process memory**: an in-memory
store works perfectly on one server and logs users out at random the moment you
run two. See [Redis](/knowledge-base/redis) and
[Statelessness](/knowledge-base/general/idempotency-and-state#statelessness).

### Signed cookie sessions

The data lives in the cookie, cryptographically signed so it cannot be tampered
with.

```ts
// Express, cookie-session or similar
app.use(cookieSession({keys: [config.sessionSecret], maxAge: 3600_000}));
```

No server storage and no lookup, which suits serverless and horizontally scaled
deployments. The costs are real: **you cannot revoke** before expiry, the cookie
travels on every request so size matters (4 KB limit), and **signed is not
encrypted** — anyone can read the contents unless you encrypt as well.

|                     | Server-side         | Signed cookie         |
| ------------------- | ------------------- | --------------------- |
| Revocation          | Immediate           | Not until expiry      |
| Storage             | Redis / database    | None                  |
| Scales horizontally | With a shared store | Naturally             |
| Size limit          | None                | ~4 KB                 |
| Contents readable   | No                  | Yes, unless encrypted |

### Not localStorage

**Do not store session tokens in `localStorage`.** It is readable by any
JavaScript on the page, which means one XSS — including from a compromised
dependency — exfiltrates the token to an attacker who can then use it from
anywhere, at leisure.

The frequent counter-argument is "cookies are vulnerable to CSRF". They are, and
CSRF has a complete solution (`SameSite` plus tokens). XSS token theft does not
have an equivalent mitigation once the token is reachable from JavaScript.

**`HttpOnly` cookies for browser sessions. Every time.** See
[JWT](/knowledge-base/security/jwt), where the same argument recurs.

---

## Session Lifecycle

### Creation

```ts
// Regenerate the id at every privilege change — this prevents session fixation
await session.regenerate();
session.userId = user.id;
session.createdAt = Date.now();
```

Without regeneration, an attacker who plants a known session id in the victim's
browser inherits an authenticated session once the victim logs in.

### Expiry

Two timers, and you want both:

- **Idle timeout** — expires after a period of inactivity. 30 minutes for
  sensitive applications, hours to days for low-risk ones.
- **Absolute timeout** — expires a fixed time after creation regardless of
  activity. Caps how long a stolen token stays useful.

**Re-authenticate before high-risk actions** — changing a password, adding a
payout account, deleting an account — even within a valid session.

### Destruction

```ts
async function logout(req, res) {
  await sessionStore.destroy(req.session.id); // server-side FIRST
  res.clearCookie('__Host-session', {path: '/', secure: true, httpOnly: true});
}
```

**Clearing the cookie is not logging out.** If the server-side record survives,
anyone who captured the token still has a working session. Destroy the record,
then clear the cookie.

**Invalidate every session** on password change, MFA change or detected
compromise. Storing sessions keyed by user makes this a single operation:

```ts
await redis.del(...(await redis.smembers(`user:${userId}:sessions`)));
```

---

## Common Mistakes

**Missing `HttpOnly`.** An XSS becomes permanent account takeover rather than a
temporary one.

**Missing `Secure`.** The cookie travels in plaintext over any HTTP request,
including a downgrade attack.

**`SameSite=None` without understanding why.** Often copied from a Stack
Overflow answer to fix a local development problem, and left in production.

**No session regeneration at login.** Session fixation.

**In-memory session store behind a load balancer.** Random logouts that only
appear in production.

**Logout that only clears the cookie.** The server-side session remains valid.

**No absolute expiry.** A token stolen a year ago still works.

**Session data in the cookie, unencrypted.** Signing prevents tampering, not
reading. Roles, emails and internal ids become visible.

**Setting `Domain` unnecessarily.** Every subdomain now receives the session
cookie, including ones you do not control.

---

## Debugging

| Symptom                                               | Cause and fix                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Cookie not set at all                                 | `Secure` on plain HTTP, or `SameSite=None` without `Secure`.           |
| Users logged out randomly                             | In-memory store with several instances. Use Redis.                     |
| Login works, next request anonymous                   | `Domain`/`Path` mismatch, or the cookie was set on a different origin. |
| Cookie missing after redirect from a payment provider | `SameSite=Strict` blocking the cross-site return. Use `Lax`.           |
| Session survives logout                               | Server-side record not destroyed.                                      |
| Works in one browser, not another                     | Third-party cookie restrictions, or clock skew on expiry.              |
| "Cookie too large" / silently dropped                 | Signed cookie session over the ~4 KB limit.                            |
| Cross-subdomain session unexpectedly shared           | `Domain` set too broadly.                                              |

```bash
curl -i https://example.com/login -c cookies.txt   # inspect Set-Cookie
```

DevTools → Application → Cookies shows every attribute as the browser
interpreted it, which is usually faster than reasoning about what you intended
to send.

---

## Do's and Don'ts

### Do

- Set `HttpOnly`, `Secure` and `SameSite=Lax` on every session cookie.
- Use the `__Host-` prefix so the browser enforces the rules.
- Regenerate the session id on login and privilege change.
- Set both an idle and an absolute timeout.
- Destroy the server-side session on logout, then clear the cookie.
- Invalidate all sessions on password or MFA change.
- Use a shared session store, not process memory.
- Re-authenticate before high-risk actions.

### Don't

- Don't store session tokens in `localStorage` or `sessionStorage`.
- Don't use `SameSite=None` unless you genuinely need cross-site cookies.
- Don't set `Domain` unless subdomains must share the session.
- Don't put sensitive data in a signed-but-unencrypted cookie.
- Don't rely on `SameSite` alone for CSRF protection.
- Don't let sessions live indefinitely.
- Don't treat clearing the cookie as logging out.

---

## FAQ

**Sessions or JWTs?**
Server-side sessions for browser applications — immediate revocation and a
simpler model. JWTs suit stateless service-to-service calls. See
[JWT](/knowledge-base/security/jwt).

**How long should a session last?**
Idle: 30 minutes for banking, hours or days for a consumer app. Absolute: a few
days at most, and shorter for anything sensitive.

**`Lax` or `Strict`?**
`Lax` for the main session — `Strict` prevents a user arriving logged in from an
external link, which reads as a bug. Consider `Strict` for a separate
high-privilege cookie.

**Do I still need CSRF tokens with `SameSite=Lax`?**
Yes, for state-changing requests. `SameSite` does not protect against a
same-site attacker such as a vulnerable subdomain, and it is defence in depth
rather than a complete fix.

**How do I share a session across subdomains?**
Set `Domain=.example.com` — deliberately, understanding that every subdomain
receives it, and that you cannot then use the `__Host-` prefix.

**What about mobile apps?**
There is no cookie jar in the same sense. Use tokens in the `Authorization`
header, stored in the platform keychain — see
[React Native](/knowledge-base/react-native#data-and-state).

---

## Check your understanding

<Quiz
question="A single-page app stores its session token in localStorage because 'cookies are vulnerable to CSRF'. What is wrong with that reasoning?"
options={[
{
text: 'CSRF has a complete solution (SameSite plus tokens), while a token readable by JavaScript can be exfiltrated by any XSS and reused from anywhere afterwards',
correct: true,
why: 'An HttpOnly cookie cannot be read by script, so XSS is limited to acting while the page is open. A localStorage token is stolen outright and works from the attacker’s machine indefinitely.',
},
{text: 'localStorage is slower than cookies', why: 'Performance is irrelevant here; the difference is who can read the value.'},
{text: 'localStorage is not available in all browsers', why: 'It is universally supported. Availability is not the objection.'},
{text: 'It is correct — localStorage avoids CSRF entirely', why: 'It does avoid CSRF, at the cost of a worse and less fixable problem. The trade is not favourable.'},
]}
explanation={<>The general principle: prefer a vulnerability class you can fully mitigate over one you cannot. CSRF is solvable; XSS token exfiltration is not, once the token is reachable from script.</>}
reference={{label: 'Not localStorage', href: '/knowledge-base/security/sessions-and-cookies#not-localstorage'}}
/>

<Quiz
question="Which cookie attributes should a session cookie carry?"
type="multiple"
options={[
{text: 'HttpOnly', correct: true, why: 'Stops JavaScript reading it, which downgrades an XSS from permanent token theft to temporary in-page abuse.'},
{text: 'Secure', correct: true, why: 'Prevents the cookie travelling over plain HTTP where it can be intercepted.'},
{text: 'SameSite=Lax', correct: true, why: 'Blocks cross-site POST — the usual CSRF vector — while still letting users arrive logged in from an external link.'},
{text: 'The __Host- name prefix', correct: true, why: 'The browser then enforces Secure, Path=/ and no Domain, so a compromised subdomain cannot overwrite the session cookie.'},
{text: 'Domain=.example.com by default', why: 'Domain widens scope rather than narrowing it — every subdomain, including third-party software you do not control, receives the cookie.'},
]}
explanation={<>The <code>__Host-</code> prefix is the under-used one: it converts a configuration mistake into a rejected cookie rather than a silent weakness.</>}
reference={{label: 'Cookie attributes', href: '/knowledge-base/security/sessions-and-cookies#cookie-attributes'}}
/>

<Quiz
question="A logout handler calls res.clearCookie('session') and redirects. Is the user logged out?"
options={[
{
text: 'No — the server-side session record still exists, so anyone holding a copy of the token still has a valid session',
correct: true,
why: 'Clearing the cookie removes the browser’s copy. It does nothing to the server-side state, which is what actually authorises requests.',
},
{text: 'Yes — without the cookie the browser cannot authenticate', why: 'That browser cannot. An attacker who captured the token earlier still can.'},
{text: 'Yes, provided the cookie had HttpOnly set', why: 'HttpOnly affects script access, not whether the server-side session remains valid.'},
{text: 'Only if the cookie also had Secure set', why: 'Secure controls transport. Neither flag destroys server state.'},
]}
explanation={<>Destroy the server-side record first, then clear the cookie. The same reasoning means a password change must invalidate <em>all</em> of that user's sessions, not just the current one.</>}
reference={{label: 'Destruction', href: '/knowledge-base/security/sessions-and-cookies#destruction'}}
/>

<Quiz
question="After returning from a payment provider's hosted checkout, users arrive logged out. The session cookie is SameSite=Strict. Why?"
options={[
{
text: 'Strict withholds the cookie on any cross-site request, including a top-level navigation back from another origin, so the return lands unauthenticated',
correct: true,
why: 'Strict blocks the cookie even when the user follows a link or is redirected from an external site. Lax permits top-level GET navigations, which covers this flow.',
},
{text: 'The payment provider stripped the cookie', why: 'A third-party site cannot remove cookies for your origin.'},
{text: 'The Secure flag blocks redirects', why: 'Secure only requires HTTPS; it has no effect on redirect behaviour.'},
{text: 'The session expired during checkout', why: 'Possible in principle, but the described symptom is precisely the Strict behaviour.'},
]}
explanation={<>This is why <code>Lax</code> is the recommended default for the main session. Where a genuinely strict cookie is wanted, keep a second high-privilege cookie at <code>Strict</code> and require it only for sensitive operations.</>}
reference={{label: 'SameSite', href: '/knowledge-base/security/sessions-and-cookies#samesite'}}
/>

<Quiz
question="An app moves from one server to three behind a load balancer. Users now get logged out unpredictably. What is the cause?"
options={[
{
text: 'Sessions are held in process memory, so a request routed to a different instance finds no session',
correct: true,
why: 'In-memory session state is per process. With several instances only one has any given session, and each request may land elsewhere.',
},
{text: 'The cookie Domain is now wrong', why: 'The domain is unchanged by adding instances.'},
{text: 'SameSite is blocking the load balancer', why: 'SameSite concerns the requesting site, not which backend serves it.'},
{text: 'Session ids are colliding between instances', why: 'Cryptographically random ids do not collide meaningfully.'},
]}
explanation={<>Move sessions to Redis or a database. Sticky sessions appear to fix it and reintroduce the problem the moment an instance restarts or is scaled down.</>}
reference={{label: 'Server-side sessions', href: '/knowledge-base/security/sessions-and-cookies#server-side-sessions'}}
/>

---

## References

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
  — the definitive practical checklist.
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
  — every attribute, with browser behaviour.
- [MDN: SameSite cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
  — the three values and their effects.
- [RFC 6265bis](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis)
  — cookie prefixes and `SameSite`, normatively.
- [OWASP: Cookie security](https://owasp.org/www-community/controls/SecureCookieAttribute)
  — attribute-by-attribute rationale.
