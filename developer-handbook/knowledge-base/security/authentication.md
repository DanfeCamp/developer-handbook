---
title: 'Authentication'
description: 'Verifying who a user is — password storage, passkeys, MFA, the login flow, account recovery and the mistakes that leak accounts.'
---

# Authentication

## Introduction

Authentication answers **"who are you?"**. It is distinct from
[authorisation](/knowledge-base/security/authorization), which answers "what may
you do?" — and confusing the two is the source of a large share of real
vulnerabilities.

**Why it is worth getting right first.** Every other control assumes it works.
Authorisation, audit logs, rate limits and encryption are all built on a correct
answer to "who is this request from?" Get authentication wrong and none of the
rest matters.

**The strongest advice on this page:** for most applications, **do not build
this yourself.** Auth0, Clerk, WorkOS, Supabase Auth, Firebase Auth, Keycloak
and the framework-native options (Laravel Fortify, Django's auth, ASP.NET
Identity) have solved password storage, MFA, passkeys, recovery flows, session
management and enumeration defences, and they have been attacked far more than
your implementation will be.

Build it yourself when you have unusual requirements or genuine regulatory
constraints. Understand it either way — this page is what you need to evaluate
whichever option you choose.

:::note Baseline
Written against the **OWASP Top 10:2025** (final release January 2026), in which
Broken Access Control remains A01 and Security Misconfiguration has moved to
A02. Password guidance follows the current OWASP Password Storage Cheat Sheet,
which puts **Argon2id** first.
:::

---

## Factors

Authentication uses one or more of:

- **Something you know** — a password, a PIN.
- **Something you have** — a phone, a security key, a passkey.
- **Something you are** — a fingerprint, a face.

**Multi-factor** means factors from _different_ categories. A password plus a
security question is one factor twice, and the security question is usually the
weaker of the two.

---

## Passwords

Still the default for most applications, and the part most often implemented
badly.

### Storage

**Never store a password.** Store a hash produced by a slow, memory-hard
function with a per-password salt.

```ts
import argon2 from 'argon2';

// OWASP's current first recommendation.
const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — the OWASP minimum
  timeCost: 2,
  parallelism: 1,
});

const ok = await argon2.verify(hash, submittedPassword);
```

| Algorithm           | Verdict                                                            |
| ------------------- | ------------------------------------------------------------------ |
| **Argon2id**        | **Preferred.** Memory-hard, resists GPU and side-channel attacks   |
| **scrypt**          | Good alternative where Argon2 is unavailable                       |
| **bcrypt**          | Still acceptable — use cost ≥ 10, and note its 72-byte input limit |
| **PBKDF2**          | Only where FIPS compliance requires it                             |
| MD5, SHA-1, SHA-256 | **Never.** Fast by design — a GPU tries billions per second        |

The reason a general-purpose hash is wrong is precisely that it is fast.
Password hashing needs to be _slow_ and memory-hungry, so that an attacker with
a stolen database cannot test candidates in bulk.

**Salting is automatic** in all three recommended algorithms — the salt is
embedded in the output string. You do not need to manage it, and you must not
reuse one.

**A pepper** — a secret key held outside the database and mixed in — adds
defence when the database leaks but the application secret does not. Useful,
and secondary to choosing the right algorithm.

### Policy

Modern guidance (NIST SP 800-63B) overturns a lot of received wisdom:

**Do:**

- Require a minimum length of **at least 8, preferably 12+** characters.
- Allow **at least 64 characters**, all Unicode, including spaces.
- **Check against known-breached passwords** — Have I Been Pwned's k-anonymity
  API lets you do this without sending the password.
- Allow paste, so password managers work.

**Do not:**

- **Do not force composition rules** ("one uppercase, one symbol"). They produce
  `Password1!` and little else.
- **Do not force periodic rotation** without evidence of compromise. It causes
  `Summer2026!` → `Autumn2026!`.
- **Do not use security questions.** Mother's maiden name is public information.
- **Do not truncate or restrict characters.** A length cap below 64 usually
  hints that the password is being stored badly.

### The login flow

```ts
export async function login(email: string, password: string) {
  const user = await db.user.findUnique({where: {email}});

  // Always hash, even when the user does not exist, so timing does not reveal
  // which accounts are registered.
  const valid = user
    ? await argon2.verify(user.passwordHash, password)
    : await argon2.verify(DUMMY_HASH, password);

  if (!user || !valid) {
    // One generic message for both cases.
    throw new AuthError('Invalid email or password');
  }

  // Rotate the session id on privilege change — prevents session fixation.
  await session.regenerate();
  session.userId = user.id;

  // Rehash if parameters have been strengthened since this hash was made.
  if (argon2.needsRehash(user.passwordHash, {memoryCost: 19456, timeCost: 2})) {
    await db.user.update({where: {id: user.id}, data: {passwordHash: await argon2.hash(password)}});
  }
}
```

Four things in there matter:

1. **A generic error message.** "No account with that email" is a user
   enumeration oracle — an attacker learns which addresses are registered, which
   feeds credential stuffing and phishing.
2. **Constant-ish timing.** Skipping the hash for a non-existent user makes the
   response measurably faster, which leaks the same information the generic
   message was hiding.
3. **Session regeneration.** Reusing the pre-login session id allows **session
   fixation**, where an attacker plants a known id and inherits the session
   after the victim logs in.
4. **Opportunistic rehashing.** Parameters should strengthen over time, and
   login is the only moment you have the plaintext to upgrade with.

### Rate limiting

Without it, an attacker tries passwords until one works.

- **Per account** — slow down after ~5 failures, with increasing delay.
- **Per IP** — catch spraying across many accounts.
- **Globally** — catch distributed credential stuffing.
- **Prefer delay and CAPTCHA to hard lockout.** Lockout is itself a
  denial-of-service: an attacker can lock every account by failing five times
  each.

---

## Passkeys

The most significant change in authentication in a decade, and by 2026 they are
mainstream — supported in every major browser, with platform credential managers
(iCloud Keychain, Google Password Manager, Windows Hello) covering most devices.

**How they work.** A passkey is a public/private key pair. The private key never
leaves the device and is unlocked by biometrics or a device PIN; the server
stores only the public key.

**Why they matter:**

- **Phishing-resistant by construction.** The credential is bound to the origin,
  so a passkey for `example.com` cannot be used on `examp1e.com`. No amount of
  user error defeats it. This is the property no amount of training achieves
  with passwords.
- **Nothing to steal from your database.** A public key is not a secret.
- **No password to reuse**, so credential stuffing is irrelevant.

```ts
// Registration — simplified; use a library such as SimpleWebAuthn
const options = await generateRegistrationOptions({
  rpName: 'Acme',
  rpID: 'example.com',
  userName: user.email,
  authenticatorSelection: {residentKey: 'preferred', userVerification: 'preferred'},
});

// Verify the attestation, then store credential.id and credential.publicKey
```

**Practical adoption.** Offer passkeys alongside existing methods rather than
instead of them, and expect a long transition. The real complications are
account recovery when a device is lost, and cross-platform sync — a passkey
created in iCloud Keychain is not automatically available on an Android phone.
Let users register several.

---

## Multi-Factor Authentication

Ranked by strength:

| Method                   | Phishing-resistant | Notes                                    |
| ------------------------ | ------------------ | ---------------------------------------- |
| **Passkeys / WebAuthn**  | ✅                 | Origin-bound. The strongest option       |
| **Hardware key (FIDO2)** | ✅                 | Same mechanism, in a separate device     |
| **TOTP app**             | ❌                 | Good. Codes are phishable in real time   |
| **Push notification**    | ❌                 | Convenient; vulnerable to MFA fatigue    |
| **SMS**                  | ❌                 | **Weakest** — SIM swap, SS7 interception |

**SMS is the weakest common factor**, and NIST has discouraged it for years.
It is still enormously better than no second factor, so offer it as a fallback
rather than refusing to support it.

TOTP is a good default:

```ts
import {authenticator} from 'otplib';

const secret = authenticator.generateSecret();
const uri = authenticator.keyuri(user.email, 'Acme', secret); // becomes a QR code

// Verify, with a small window to tolerate clock drift
const valid = authenticator.verify({token: submitted, secret});
```

Three implementation details that are routinely missed:

- **Store the TOTP secret encrypted.** It is a shared secret; a database leak
  otherwise hands over the second factor too.
- **Reject a reused code** within its window, or an intercepted code can be
  replayed.
- **Issue recovery codes** at enrolment, hash them, and allow each to be used
  once. Without them, a lost phone means a support ticket for every user.

---

## Account Recovery

**Password reset is frequently the weakest link**, because attackers attack it
instead of the login form.

```ts
// Generate a high-entropy token, store only its hash.
const token = crypto.randomBytes(32).toString('base64url');

await db.passwordReset.create({
  data: {
    userId: user.id,
    tokenHash: sha256(token),   // a fast hash is fine — the token is already random
    expiresAt: addMinutes(new Date(), 15),
  },
});

await mail.send(user.email, `${config.appUrl}/reset?token=${token}`);
```

The rules:

- **Single use, short lived** — 15 to 60 minutes.
- **Store the hash**, so a database leak does not yield usable reset links.
- **Cryptographically random**, never a sequential id or a timestamp.
- **Respond identically whether or not the account exists.** "We have sent a
  link if that address is registered" — otherwise the reset form becomes the
  enumeration oracle the login form was careful to avoid.
- **Invalidate every session** on password change, so an attacker holding a
  stolen session is evicted.
- **Notify the user by email** on password change, MFA change and new-device
  login. This is often how a compromise is first noticed.
- **Do not reset MFA on a password reset.** An attacker with email access should
  not thereby defeat the second factor.

---

## Common Mistakes

**Rolling your own crypto or session handling.** Use vetted libraries. This is
not an area where cleverness pays.

**User enumeration.** Distinct messages, distinct status codes, or measurably
different response times between "no such user" and "wrong password".

**No session regeneration after login.** Session fixation.

**Storing passwords with a fast hash.** SHA-256 with a salt is still wrong — the
speed is the problem.

**Tokens in URLs.** Reset and magic links land in server logs, browser history
and referrer headers. Short expiry and single use limit the damage.

**Trusting the client.** A hidden `isAdmin` field, a role in a JWT nobody
verifies, a client-side redirect as the only guard.

**No rate limiting on login, reset or MFA verification.** All three are brute
force targets.

**Long-lived sessions with no absolute expiry.** A stolen session token should
not work indefinitely.

**Logging credentials.** `logger.info(req.body)` on a login route writes
plaintext passwords into your log pipeline, and now they are in three retention
systems.

---

## Debugging

| Symptom                                   | Cause and fix                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Users logged out randomly                 | Session store not shared across instances, or inconsistent cookie domain. |
| Login works, next request unauthenticated | Cookie flags wrong (`SameSite`, `Secure`, `Domain`, `Path`).              |
| MFA codes always rejected                 | Server clock drift. Sync NTP; allow a ±1 step window.                     |
| Reset links expired on arrival            | Timezone confusion — compare UTC instants, not local times.               |
| Timing differences between error cases    | Hash a dummy value on the not-found path.                                 |
| Passkey registration fails                | `rpID` must match the origin's domain exactly, and requires HTTPS.        |
| Sessions survive a password change        | Session invalidation missing on credential change.                        |

---

## Do's and Don'ts

### Do

- Use a vetted identity provider or framework module unless you have a reason
  not to.
- Hash with Argon2id (or bcrypt/scrypt), and rehash on login when parameters
  change.
- Check passwords against a breach corpus.
- Offer passkeys, and TOTP as the fallback second factor.
- Regenerate the session id on login and privilege change.
- Return generic messages and constant-ish timings.
- Expire reset tokens quickly, store them hashed, use them once.
- Invalidate all sessions on password change, and notify the user.
- Rate limit login, reset and MFA endpoints.

### Don't

- Don't invent your own password hashing or session scheme.
- Don't use MD5, SHA-1 or SHA-256 for passwords.
- Don't impose composition rules or forced rotation.
- Don't use security questions.
- Don't reveal whether an account exists.
- Don't reset MFA as part of a password reset.
- Don't put long-lived tokens in URLs.
- Don't log request bodies on authentication routes.

---

## FAQ

**Should I build authentication myself?**
Usually not. The failure modes are numerous, subtle and severe. Use a provider
or your framework's module.

**bcrypt or Argon2id?**
Argon2id for new systems. bcrypt with cost ≥ 10 remains acceptable; note its
72-byte input truncation, which matters if you pre-hash long inputs.

**Are passkeys ready?**
Yes for most consumer and workforce applications — browser support is universal
and platform managers cover most devices. Offer them alongside passwords and
plan recovery carefully.

**Sessions or JWTs?**
Server-side sessions for browser applications: revocation is immediate and the
model is simpler. JWTs suit stateless service-to-service calls. See
[Sessions and Cookies](/knowledge-base/security/sessions-and-cookies) and
[JWT](/knowledge-base/security/jwt).

**How long should a session last?**
An idle timeout of 30 minutes to a few hours for sensitive applications, plus an
absolute maximum regardless of activity. Re-authenticate before high-risk
actions.

**Is SMS 2FA worth offering?**
Yes as a fallback. Weak against SIM swapping, and far better than nothing.

---

## Check your understanding

<Quiz
question="A login endpoint returns 'No account with that email' or 'Incorrect password' depending on the failure. Why is this a vulnerability?"
options={[
{
text: 'It is a user enumeration oracle — an attacker can discover which addresses are registered, then target them with credential stuffing and phishing',
correct: true,
why: 'Distinguishing the two cases turns the login form into a membership-checking API for your user base. Return one generic message for both.',
},
{text: 'It is not a vulnerability, just poor user experience', why: 'Confirming which email addresses hold accounts is real information disclosure, and it feeds every subsequent attack.'},
{text: 'It only matters if the site has no rate limiting', why: 'Rate limiting slows enumeration; it does not stop the disclosure, and attackers distribute across IPs.'},
{text: 'It leaks the password hashing algorithm', why: 'The message reveals nothing about hashing.'},
]}
explanation={<>The generic message is only half the fix: also hash a dummy value when the user does not exist, or the faster response leaks exactly the same information through timing.</>}
reference={{label: 'The login flow', href: '/knowledge-base/security/authentication#the-login-flow'}}
/>

<Quiz
question="Why are passkeys described as phishing-resistant in a way that no amount of user training achieves?"
options={[
{
text: 'The credential is cryptographically bound to the origin, so a passkey for example.com simply cannot be used on a lookalike domain',
correct: true,
why: 'The browser will not offer or produce a valid assertion for a different origin. The protection is structural rather than dependent on the user noticing the URL.',
},
{text: 'Because they require biometric verification, which cannot be faked', why: 'Biometrics unlock the local key. They are not what defeats phishing — origin binding is.'},
{text: 'Because the private key is stored on a hardware security module', why: 'Storage location protects the key from theft; it does not stop a user authenticating to the wrong site.'},
{text: 'Because passkeys expire after each use', why: 'They do not expire per use. The key pair persists.'},
]}
explanation={<>The second structural benefit: your database holds only public keys, so a breach yields nothing usable — and there is no reused password to stuff elsewhere.</>}
reference={{label: 'Passkeys', href: '/knowledge-base/security/authentication#passkeys'}}
/>

<Quiz
question="Which password policies match current NIST and OWASP guidance?"
type="multiple"
options={[
{text: 'Check submitted passwords against a known-breach corpus', correct: true, why: 'Far more effective than composition rules — it blocks the passwords attackers actually try first.'},
{text: 'Allow at least 64 characters, including spaces and Unicode', correct: true, why: 'Length is the dominant strength factor, and passphrases need room.'},
{text: 'Allow paste so password managers work', correct: true, why: 'Blocking paste actively pushes users towards weaker, memorable passwords.'},
{text: 'Require an uppercase letter, a digit and a symbol', why: 'Composition rules produce predictable patterns like Password1! and add little real entropy. Current guidance advises against them.'},
{text: 'Force a password change every 90 days', why: 'Without evidence of compromise this produces incremental variants (Summer2026 → Autumn2026). Guidance now advises against scheduled rotation.'},
]}
explanation={<>The 2017 NIST revision reversed the previous decade's advice. A great deal of surviving policy — and many compliance checklists — still enforce rules that make passwords weaker.</>}
reference={{label: 'Policy', href: '/knowledge-base/security/authentication#policy'}}
/>

<Quiz
question="An application keeps the same session id before and after login. What attack does this enable?"
options={[
{
text: 'Session fixation — an attacker plants a session id in the victim\'s browser, waits for them to log in, and then uses that id as the authenticated user',
correct: true,
why: 'If the id does not change at the privilege boundary, an id known to the attacker beforehand becomes an authenticated session afterwards.',
},
{text: 'Session hijacking via XSS', why: 'A real risk, mitigated by HttpOnly cookies, and independent of whether the id is regenerated.'},
{text: 'CSRF', why: 'CSRF is about forcing an authenticated user to make a request. Unrelated to id rotation.'},
{text: 'Credential stuffing', why: 'That is reusing breached passwords against your login form.'},
]}
explanation={<>Regenerate the session identifier on login, on privilege escalation and on logout. Most frameworks provide a one-line call for this, and it is easy to omit when authentication is hand-rolled.</>}
reference={{label: 'The login flow', href: '/knowledge-base/security/authentication#the-login-flow'}}
/>

<Quiz
question="A password reset flow emails a link containing a random token, stores the token in the database, and expires it after 24 hours. What should be improved?"
options={[
{
text: 'Store only a hash of the token and shorten the expiry — a database leak currently yields working reset links for every pending request',
correct: true,
why: 'A plaintext reset token is a live credential. Hashing it means a leaked database cannot be used to take over accounts, and a short window limits exposure.',
},
{text: 'Nothing — a random token with an expiry is sufficient', why: 'Randomness stops guessing; it does nothing about the stored copy being directly usable.'},
{text: 'Use a sequential id so tokens are easier to invalidate', why: 'Predictable tokens are guessable, which is far worse.'},
{text: 'Extend the expiry so users are not inconvenienced', why: 'The opposite direction — a longer window means longer exposure.'},
]}
explanation={<>Also make it single-use, invalidate all existing sessions on reset, email the user that their password changed, and keep MFA enrolled — an attacker with mailbox access should not thereby clear the second factor.</>}
reference={{label: 'Account recovery', href: '/knowledge-base/security/authentication#account-recovery'}}
/>

---

## References

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
  — the practical checklist.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  — Argon2id parameters and algorithm choice.
- [NIST SP 800-63B: Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
  — the source of modern password policy advice.
- [WebAuthn specification](https://www.w3.org/TR/webauthn-3/) and
  [passkeys.dev](https://passkeys.dev/) — implementation guidance.
- [SimpleWebAuthn](https://simplewebauthn.dev/) — the practical library for
  passkeys in Node.
- [Have I Been Pwned: Pwned Passwords](https://haveibeenpwned.com/Passwords) —
  breach checking via k-anonymity.
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) — the current list.
