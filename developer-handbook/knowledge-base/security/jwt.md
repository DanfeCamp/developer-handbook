---
title: 'JWT'
description: 'Signed tokens, and the mistakes that make them unsafe — structure, algorithms, the alg=none and confusion attacks, revocation, and when not to use one.'
---

# JWT

## Introduction

A JSON Web Token is a compact, URL-safe, **signed** container for claims. The
recipient can verify it was issued by someone holding the signing key, without
calling back to the issuer.

**The problem it solves.** In a distributed system, checking a session on every
request means a lookup against a shared store. A JWT carries the claims with it
and is verified locally, which removes that round trip — genuinely valuable for
service-to-service calls and for APIs that must scale statelessly.

:::danger Two things to internalise before anything else
**A JWT is signed, not encrypted.** Anyone can decode it and read every claim.
Paste one into [jwt.io](https://jwt.io) and it displays in full. Never put
anything confidential in a payload.

**A JWT cannot be revoked.** Once issued it is valid until it expires. There is
no "log this user out" — that is the fundamental trade, and it is why they are
usually the wrong choice for browser sessions.
:::

**Where they fit:** service-to-service authentication, short-lived access
tokens in an OAuth flow, stateless APIs with many instances, and signed
single-use links.

**Where they do not:** ordinary browser session management. Use
[server-side sessions](/knowledge-base/security/sessions-and-cookies) — immediate
revocation, simpler model, and none of the pitfalls below.

---

## Structure

Three base64url segments separated by dots:

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsImV4cCI6MTc4NTMxMjAwMH0.dBjftJeZ4CVP…
└─────────── header ───────────┘ └────────── payload ──────────┘ └── signature ──┘
```

```json
// Header — how it is signed
{"alg": "RS256", "typ": "JWT", "kid": "2026-08-key-1"}

// Payload — the claims
{
  "iss": "https://auth.example.com",   // issuer
  "sub": "42",                          // subject: who this is about
  "aud": "https://api.example.com",     // audience: who it is for
  "exp": 1785312000,                    // expiry (seconds, not milliseconds)
  "iat": 1785308400,                    // issued at
  "jti": "01J9XQ7F3K",                  // unique token id, for denylisting
  "scope": "orders:read orders:write"
}
```

The **registered claims** are not decorative. `iss`, `aud` and `exp` are what
stop a token issued by a different system, for a different service, last year,
from being accepted by yours — and each must be checked explicitly.

`kid` identifies which key signed it, which is what makes key rotation possible.

---

## The Attacks

JWT has a poor security record, and almost all of it comes from verification
being easy to get subtly wrong.

### alg: none

The original flaw. The specification permits `"alg": "none"` for unsigned
tokens, and some libraries historically accepted it.

```json
{"alg": "none", "typ": "JWT"}
```

An attacker forges any payload, omits the signature, and a naive verifier
accepts it. **Never let the token decide how it is verified** — specify the
algorithm at the verification site:

```ts
jwt.verify(token, publicKey, {algorithms: ['RS256']}); // an allowlist, always
```

### Algorithm confusion

Subtler and still found in the wild. A server verifying RS256 (asymmetric) holds
a **public** key, which is not secret. An attacker re-signs the token with HS256
(symmetric) using that public key as the HMAC secret. A verifier that reads the
algorithm from the header then validates it successfully.

The `algorithms` allowlist above prevents this too. It is the single most
important line in any JWT implementation.

### Missing claim validation

```ts
// ❌ Signature valid, everything else unchecked
const claims = jwt.verify(token, key, {algorithms: ['RS256']});

// ✅ Verify who issued it, who it is for, and whether it is still valid
const claims = jwt.verify(token, key, {
  algorithms: ['RS256'],
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  clockTolerance: 30, // seconds, for clock skew
});
```

Without an audience check, a token issued for one service is accepted by
another. Without an issuer check, any trusted issuer's token works everywhere.

### Weak secrets

An HS256 token signed with `secret` or `changeme` is brute-forced offline in
seconds — `hashcat` does this at scale, and the token itself provides the
verification oracle. Use at least 256 bits of randomness, or use RS256/ES256 and
avoid shared secrets entirely.

### Storing tokens where JavaScript can read them

Covered in [Sessions and Cookies](/knowledge-base/security/sessions-and-cookies#not-localstorage),
and worth repeating: a JWT in `localStorage` is exfiltrated by any XSS and then
usable from anywhere until it expires. Use an `HttpOnly` cookie for browser
clients.

---

## Signing Algorithms

| Algorithm | Type                 | Use when                                     |
| --------- | -------------------- | -------------------------------------------- |
| **HS256** | Symmetric (HMAC)     | One party issues and verifies                |
| **RS256** | Asymmetric (RSA)     | Many verifiers; the standard for OIDC        |
| **ES256** | Asymmetric (ECDSA)   | Same, with smaller tokens and faster signing |
| **EdDSA** | Asymmetric (Ed25519) | Modern, fast; growing support                |
| `none`    | —                    | **Never**                                    |

**Symmetric means every verifier can also issue.** With HS256, any service that
can check a token can mint one. In a microservice architecture that is usually
unacceptable — one compromised service can impersonate anyone. **Use RS256 or
ES256**, distribute the public key, and keep the private key with the issuer
alone.

### Key rotation and JWKS

Publish public keys at a well-known endpoint so verifiers fetch them and rotation
requires no coordinated deploy:

```json title="/.well-known/jwks.json"
{
  "keys": [
    {"kid": "2026-08-key-1", "kty": "RSA", "alg": "RS256", "use": "sig", "n": "…", "e": "AQAB"},
    {"kid": "2026-05-key-1", "kty": "RSA", "alg": "RS256", "use": "sig", "n": "…", "e": "AQAB"}
  ]
}
```

Rotate by publishing the new key, signing with it, and keeping the old one
listed until every token signed with it has expired. **Cache the JWKS** and
refresh on an unknown `kid` — fetching it per request is both slow and a
denial-of-service vector against your own auth server.

---

## Revocation

The hard problem, and the reason to think carefully before choosing JWTs.

A signed token is valid until `exp`. Deleting the user, changing their password
or revoking their access changes nothing — the token still verifies.

Four approaches, none free:

**1. Short expiry plus refresh tokens.** The standard answer. Access tokens live
5–15 minutes; a long-lived refresh token obtains new ones. Revocation happens at
refresh time, so the exposure window is one access-token lifetime.

**2. A denylist.** Store revoked `jti` values in Redis until they expire. This
works and reintroduces the per-request lookup that JWTs existed to avoid —
though the denylist is far smaller than a session store.

**3. A token version claim.** Include `tokenVersion` in the token and on the
user; bump it to invalidate everything. Still a lookup, but a cheap one that
caches well.

**4. Accept the window.** For low-risk tokens with a short lifetime, sometimes
correct — decided deliberately, not by omission.

### Refresh tokens

```text
Access token:  15 minutes, sent with every request, a JWT
Refresh token: 30 days, sent only to /auth/refresh, an opaque random string
```

Make the refresh token **opaque and stored server-side** — it is long-lived, so
it needs the revocability a JWT lacks.

**Rotate on every use, and detect reuse.** Issue a new refresh token each time
and invalidate the old one. If a previously used token is presented again,
either it was stolen or replayed — revoke the entire family and force
re-authentication. This is the standard defence and it turns theft into a
detectable event.

Store refresh tokens in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie scoped
to the refresh path.

---

## Implementation

```ts
import * as jose from 'jose';

// Issue
const token = await new jose.SignJWT({scope: 'orders:read'})
  .setProtectedHeader({alg: 'RS256', kid: currentKeyId})
  .setIssuer('https://auth.example.com')
  .setAudience('https://api.example.com')
  .setSubject(user.id)
  .setIssuedAt()
  .setExpirationTime('15m')
  .setJti(crypto.randomUUID())
  .sign(privateKey);

// Verify
const jwks = jose.createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'));

const {payload} = await jose.jwtVerify(token, jwks, {
  algorithms: ['RS256'],
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  clockTolerance: 30,
});
```

**Use a maintained library.** `jose` for JavaScript, `PyJWT` with explicit
options for Python, `nimbus-jose-jwt` for Java. Hand-rolled verification is how
the attacks above keep succeeding, and the failure is silent.

Keep tokens small — they travel on every request, and headers have practical
size limits. Put an id in the token and look up the detail; do not put the
user's whole profile in it.

---

## JWT or Session?

|                            | Server session     | JWT                                    |
| -------------------------- | ------------------ | -------------------------------------- |
| Revocation                 | Immediate          | Not until expiry                       |
| Storage                    | Redis / database   | None                                   |
| Verification               | A lookup           | Local signature check                  |
| Size                       | ~30-byte cookie    | 500 bytes to several KB                |
| Contents visible to client | No                 | **Yes**                                |
| Cross-service              | Needs shared store | Natural                                |
| Complexity                 | Low                | Higher — rotation, refresh, revocation |

**Use a session** for a browser application with one backend. This is most
applications, and the decision people most often get wrong.

**Use a JWT** for service-to-service authentication, third-party API access, and
as the access token in an [OAuth](/knowledge-base/security/oauth) flow.

The common failure is choosing JWTs for a conventional web app because they are
"stateless" and "scalable", then rebuilding revocation with a Redis denylist —
arriving at a session store with extra steps and more ways to get it wrong.

---

## Common Mistakes

**Not pinning the algorithm.** Enables both `alg: none` and algorithm confusion.

**Not validating `iss`, `aud` and `exp`.** A valid signature only proves who
signed it, not that it was meant for you or is still current.

**Treating a JWT as encrypted.** Putting an email address, internal ids, roles
or anything else sensitive in a payload the user can read.

**Storing it in `localStorage`.** XSS becomes durable token theft.

**Long-lived access tokens.** A 30-day access token is a 30-day window with no
revocation.

**Refresh tokens as JWTs.** They are long-lived, so they need revocability —
which is the one thing JWTs lack.

**Weak HMAC secrets.** Offline brute force, with the token as the oracle.

**Symmetric keys across services.** Every verifier becomes an issuer.

**Confusing expiry units.** `exp` is in **seconds**; `Date.now()` is in
milliseconds. Getting this wrong produces tokens valid for fifty thousand years.

---

## Debugging

| Symptom                                         | Cause and fix                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| "invalid signature"                             | Wrong key, wrong `kid`, or the token was re-signed. Check the JWKS. |
| "jwt expired" immediately                       | Milliseconds passed where seconds were expected.                    |
| Intermittent expiry failures                    | Clock skew. Sync NTP; allow ~30 seconds tolerance.                  |
| Token valid on one service, rejected on another | Audience mismatch — working as intended.                            |
| Verification passes for a forged token          | The algorithm is not pinned. Add an allowlist.                      |
| 431 / header too large                          | Too many claims. Store an id and look up the rest.                  |
| Users still authorised after being disabled     | JWTs are not revocable. Shorten expiry; check a version claim.      |
| Works locally, fails in production              | Different signing key, or a stale JWKS cache.                       |

Decode without verifying to inspect claims — but never trust the result:

```bash
echo "$TOKEN" | cut -d. -f2 | base64 -d | jq
```

---

## Do's and Don'ts

### Do

- Pin the algorithm with an explicit allowlist.
- Validate `iss`, `aud` and `exp` on every verification.
- Use RS256 or ES256 when more than one party verifies.
- Publish a JWKS and include `kid`, so keys can rotate.
- Keep access tokens to 5–15 minutes.
- Use opaque, server-stored, rotating refresh tokens with reuse detection.
- Store tokens in `HttpOnly` cookies for browser clients.
- Use a maintained library.

### Don't

- Don't put anything confidential in the payload.
- Don't accept the algorithm from the token header.
- Don't use JWTs for ordinary browser sessions.
- Don't issue long-lived access tokens.
- Don't make refresh tokens JWTs.
- Don't share an HMAC secret between services.
- Don't store tokens in `localStorage`.
- Don't implement verification yourself.

---

## FAQ

**Can I encrypt a JWT?**
Yes — JWE, as opposed to the signed JWS form described here. It is more complex
and rarely necessary; the usual answer is to keep sensitive data out of the
token.

**How long should an access token last?**
5–15 minutes. That window is what bounds the revocation problem.

**How do I log a user out?**
Delete the refresh token server-side and clear the cookies. The access token
remains valid until it expires, which is why it should be short-lived.

**Is `localStorage` ever acceptable?**
For a native mobile app there is no cookie jar, so a token in the platform
keychain is correct. In a browser, use `HttpOnly` cookies.

**Should I use JWTs between microservices?**
Yes — this is their strongest use. Asymmetric signing, short expiry, and an
audience per service.

**What is the difference between JWT and OAuth?**
JWT is a token format. OAuth is an authorisation framework that often uses JWTs
as its access tokens. See [OAuth](/knowledge-base/security/oauth).

---

## Check your understanding

<Quiz
question="An API verifies tokens with `jwt.verify(token, publicKey)` and no options. An attacker re-signs a forged payload using HS256, with the server's public RSA key as the HMAC secret. What happens?"
options={[
{
text: 'It verifies successfully — the library reads the algorithm from the token header, and the public key is not secret',
correct: true,
why: 'Algorithm confusion. A verifier expecting RS256 holds a public key; used as an HMAC secret it is entirely known to the attacker, who can therefore produce a valid HS256 signature.',
},
{text: 'It fails, because the key is an RSA key rather than an HMAC secret', why: 'To an HMAC implementation the key is just bytes. Nothing rejects it.'},
{text: 'It fails, because the header says HS256 but the token was issued as RS256', why: 'A verifier that trusts the header has no record of how the token was originally issued.'},
{text: 'It only works if the public key is under 256 bits', why: 'Key length is irrelevant — the attacker knows the whole key whatever its size.'},
]}
explanation={<>One line prevents both this and <code>alg: none</code>: pass an explicit allowlist, <code>&#123;algorithms: ['RS256']&#125;</code>. Never let the token decide how it is verified.</>}
reference={{label: 'Algorithm confusion', href: '/knowledge-base/security/jwt#algorithm-confusion'}}
/>

<Quiz
question="A team stores the user's email, role and internal customer id in the JWT payload so the frontend can read them without an API call. What is wrong?"
options={[
{
text: 'A JWT is signed, not encrypted — anyone holding the token can decode and read every claim, so this exposes personal data and internal identifiers',
correct: true,
why: 'Base64url is an encoding, not encryption. Pasting the token into jwt.io displays the payload in full, to the user and to anyone who intercepts or exfiltrates it.',
},
{text: 'Nothing — the signature prevents the payload being read', why: 'The signature prevents _modification_, not reading.'},
{text: 'It is fine provided HTTPS is used', why: 'TLS protects transit. The token is still readable wherever it is stored, logged or copied.'},
{text: 'Only the role claim is a problem', why: 'The email is personal data and the internal id aids enumeration. Both matter.'},
]}
explanation={<>Put an opaque subject id in the token and look up the detail server-side. If a claim must be confidential, you need JWE (encrypted), not JWS.</>}
reference={{label: 'Introduction', href: '/knowledge-base/security/jwt#introduction'}}
/>

<Quiz
question="Which choices are correct for a browser application's authentication?"
type="multiple"
options={[
{text: 'A server-side session with an HttpOnly cookie', correct: true, why: 'Immediate revocation, a small opaque cookie, and no claims visible to the client. The right default for a browser app with one backend.'},
{text: 'If using JWTs, an access token of 5–15 minutes', correct: true, why: 'The short lifetime is what bounds the revocation gap, since the token cannot be withdrawn.'},
{text: 'An opaque, server-stored refresh token that rotates on each use', correct: true, why: 'Long-lived credentials need revocability, and rotation with reuse detection turns theft into a detectable event.'},
{text: 'A 30-day JWT access token in localStorage for convenience', why: 'Two serious problems at once: a month-long unrevocable window, and a token any XSS can exfiltrate and reuse from anywhere.'},
{text: 'A JWT as the refresh token, so no server state is needed', why: 'Refresh tokens are long-lived and must be revocable — precisely what a JWT cannot do.'},
]}
explanation={<>The recurring failure is choosing JWTs for a conventional web app because they are "stateless", then rebuilding revocation with a Redis denylist — a session store with extra steps.</>}
reference={{label: 'JWT or session?', href: '/knowledge-base/security/jwt#jwt-or-session'}}
/>

<Quiz
question="A user is disabled in the admin panel but continues making authenticated requests for another 20 minutes. Why, and what is the appropriate fix?"
options={[
{
text: 'JWTs cannot be revoked — the token remains valid until exp. Shorten access-token lifetime, and revoke at refresh time or check a token-version claim',
correct: true,
why: 'Verification is local and consults nothing. Disabling the account changes the database, not the already-issued token.',
},
{text: 'The signing key needs rotating to invalidate the token', why: 'Rotating the key invalidates _every_ token for _every_ user — a blunt instrument that logs out the whole system.'},
{text: 'The token cache needs clearing', why: 'There is no cache: the token is self-contained and verified locally.'},
{text: 'This is a bug in the JWT library', why: 'It is the designed behaviour, and the central trade-off of the format.'},
]}
explanation={<>Decide the approach deliberately: short expiry plus refresh (standard), a <code>jti</code> denylist in Redis (reintroduces a lookup), or a token-version claim (a cheap cacheable check). Choosing by omission means accepting the full window.</>}
reference={{label: 'Revocation', href: '/knowledge-base/security/jwt#revocation'}}
/>

<Quiz
question="A microservice architecture signs all JWTs with a shared HS256 secret held by every service. What is the risk?"
options={[
{
text: 'Any service that can verify a token can also mint one, so compromising the least-secured service allows impersonating any user to any other service',
correct: true,
why: 'Symmetric signing means the verification key is the signing key. Asymmetric algorithms let services hold only the public key, so verification does not confer the ability to issue.',
},
{text: 'HS256 is cryptographically broken', why: 'HMAC-SHA256 is sound. The problem is key distribution, not the algorithm.'},
{text: 'Tokens will be too large', why: 'HS256 tokens are smaller than RSA-signed ones. Size is not the issue.'},
{text: 'Only that key rotation is harder', why: 'Rotation is indeed harder, but the impersonation capability is the serious risk.'},
]}
explanation={<>Use RS256 or ES256, publish the public keys as a JWKS with <code>kid</code> so rotation needs no coordinated deploy, and give each service its own <code>aud</code> so a token for one is rejected by another.</>}
reference={{label: 'Signing algorithms', href: '/knowledge-base/security/jwt#signing-algorithms'}}
/>

---

## References

- [RFC 7519: JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519) — the
  specification, including registered claims.
- [RFC 8725: JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
  — the normative guidance on algorithm pinning and claim validation.
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
  — attacks and mitigations.
- [jose](https://github.com/panva/jose) — the maintained JavaScript
  implementation, with JWKS support.
- [jwt.io](https://jwt.io) — decode and inspect tokens; a good demonstration
  that payloads are readable.
- [Sessions and Cookies](/knowledge-base/security/sessions-and-cookies) — the
  alternative, and usually the better one for browsers.
