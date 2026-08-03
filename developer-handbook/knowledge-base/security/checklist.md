---
title: 'Security Checklist'
description: 'A practical pre-launch review — the OWASP Top 10:2025 mapped to concrete checks, headers, dependencies, secrets and incident readiness.'
---

# Security Checklist

## Introduction

A checklist is not a security programme. It is a way of ensuring that the things
you already know are actually done, on this system, before it ships — because
the majority of breaches exploit well-understood problems that somebody meant to
get to.

**How to use it.** Walk the whole list once before launch. Re-walk the relevant
sections when you add authentication, accept file uploads, integrate a third
party, or take on regulated data. Treat unchecked items as findings with owners,
not as aspirations.

**What it is not.** A substitute for threat modelling, penetration testing, or
thinking about your specific system. A checklist catches the common; an attacker
looks for the specific.

:::note Baseline
Organised around the **OWASP Top 10:2025**, released in final form in January 2026. Two categories are new since 2021 — **A03 Software Supply Chain Failures**
and **A10 Mishandling of Exceptional Conditions** — and **SSRF has been folded
into A01 Broken Access Control**. Security Misconfiguration moved from #5 to
**#2**, reflecting how often continuous deployment outpaces continuous review.
:::

---

## A01 — Broken Access Control

The most exploited category, and the one most likely to be missed. Full detail
in [Authorization](/knowledge-base/security/authorization).

- [ ] **Every endpoint checks authorisation per object**, not just per route.
      Changing an id in a URL must not return another user's data.
- [ ] Queries **filter by owner or tenant in the database**, not in application
      code after loading.
- [ ] **Deny by default** — a new endpoint is inaccessible until explicitly
      opened.
- [ ] **Row-level security** enabled for multi-tenant data, as a backstop.
- [ ] Tenant and user identity derive **from the session**, never from a header,
      body or query parameter.
- [ ] **Mass assignment blocked** — request bodies are parsed into an explicit
      allowlist, so a user cannot set `role` or `isAdmin`.
- [ ] Write and delete paths are checked as carefully as reads.
- [ ] Indirect exposure reviewed: exports, search indexes, admin reports,
      webhook payloads.
- [ ] **404 rather than 403** for resources the user should not know exist.
- [ ] **SSRF**: any URL fetched on the server is validated against private
      ranges (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`) **after DNS
      resolution and after every redirect**.
- [ ] Negative tests exist: owner, other user, other tenant, anonymous.

## A02 — Security Misconfiguration

Now second on the list. Mostly cheap to fix and easy to leave undone.

- [ ] **Debug mode off** in production. No stack traces in responses.
- [ ] Default credentials changed; sample and admin accounts removed.
- [ ] **Directory listing disabled**; `.git`, `.env` and backups not served.
- [ ] Unused ports, services and endpoints closed.
- [ ] **Security headers** set (see [below](#security-headers)).
- [ ] Cloud storage buckets are **not public** unless deliberately so.
- [ ] Database not reachable from the internet.
- [ ] Admin interfaces IP-restricted or behind a VPN.
- [ ] Error pages are generic, with detail logged against a correlation id.
- [ ] Infrastructure-as-code reviewed; configuration drift detected.

## A03 — Software Supply Chain Failures

**New in 2025**, and broader than "vulnerable dependencies" — it covers build
systems and distribution too.

- [ ] **Lockfile committed**, and CI installs from it (`npm ci`,
      `composer install`).
- [ ] Automated dependency updates (Renovate, Dependabot) with a **cooldown** on
      brand-new versions.
- [ ] `npm audit --omit=dev` / `composer audit` in CI, gated on high and
      critical.
- [ ] Consider `ignore-scripts=true`, allow-listing the packages that genuinely
      need lifecycle scripts.
- [ ] **CI/CD secrets scoped and rotated**; build pipelines cannot be modified
      by an unreviewed commit.
- [ ] GitHub Actions **pinned to commit SHAs**, not tags.
- [ ] Publishing uses **OIDC trusted publishing**, not long-lived tokens.
- [ ] An SBOM is generated for anything you ship.
- [ ] Base container images pinned by digest and rebuilt regularly.
- [ ] New dependencies reviewed before adoption — maintenance, install count,
      transitive weight.

See [npm best practices](/knowledge-base/npm/best-practices#security).

## A04 — Cryptographic Failures

- [ ] **HTTPS everywhere**, HTTP redirected, **HSTS** with a long max-age.
- [ ] TLS 1.2 minimum, ideally 1.3. Weak ciphers disabled.
- [ ] Passwords hashed with **Argon2id** (or bcrypt cost ≥ 10 / scrypt).
      Never MD5, SHA-1 or plain SHA-256.
- [ ] Sensitive data encrypted at rest.
- [ ] Encryption keys in a secret manager, **not in the repository**, and
      rotatable.
- [ ] No sensitive data in URLs, logs, or JWT payloads.
- [ ] Randomness from a CSPRNG (`crypto.randomBytes`), never `Math.random()`.
- [ ] No home-made cryptography.

## A05 — Injection

- [ ] **Every query parameterised.** No string concatenation into SQL.
- [ ] Table names, column names and sort direction come from an **allowlist**.
- [ ] ORM raw-query escape hatches audited: `$queryRawUnsafe`, `whereRaw`,
      `DB::raw`, `.raw(`.
- [ ] **Output escaped for its context**; framework escaping not bypassed
      without review.
- [ ] Rich HTML sanitised with DOMPurify or the Sanitizer API, **on output**.
- [ ] Command execution avoids a shell; arguments passed as an array.
- [ ] NoSQL queries validate input **types** to prevent operator injection.
- [ ] Template engines never render user input as a template (SSTI).
- [ ] LDAP, XPath and header values escaped where used.

See [SQL Injection](/knowledge-base/security/sql-injection) and
[XSS](/knowledge-base/security/xss).

## A06 — Insecure Design

- [ ] Threat modelling done for the important flows — payment, auth, data
      export.
- [ ] **Rate limiting** on login, registration, password reset, and anything
      sending email or SMS.
- [ ] Business logic limits enforced server-side: quantities, refund amounts,
      discount stacking.
- [ ] Workflows cannot be skipped by calling steps out of order.
- [ ] **Idempotency keys** on anything that charges, sends or provisions.
- [ ] Abuse cases considered, not only use cases.

## A07 — Authentication Failures

Full detail in [Authentication](/knowledge-base/security/authentication).

- [ ] Passwords checked against a **breach corpus**; no composition rules or
      forced rotation.
- [ ] **MFA available**; passkeys offered where practical.
- [ ] **Session id regenerated on login** and privilege change.
- [ ] Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix.
- [ ] Idle **and** absolute session timeouts.
- [ ] Generic error messages and constant-ish timing — no user enumeration.
- [ ] Reset tokens: random, hashed at rest, short-lived, single use.
- [ ] **All sessions invalidated** on password change; the user is notified.
- [ ] MFA is not reset by a password reset.
- [ ] Rate limiting on login, reset and MFA verification.

## A08 — Software and Data Integrity Failures

- [ ] **Webhook signatures verified** against the raw body, in constant time,
      with a timestamp check.
- [ ] Deserialisation of untrusted data avoided; no `pickle`, no PHP
      `unserialize` on user input.
- [ ] Subresource Integrity on third-party scripts, or self-host them.
- [ ] Auto-update mechanisms verify signatures.
- [ ] CI/CD cannot deploy from an unreviewed branch.

## A09 — Logging and Monitoring Failures

- [ ] Authentication events logged: success, failure, lockout, MFA, password
      change.
- [ ] Authorisation failures logged.
- [ ] **Correlation id on every log line**, propagated across services.
- [ ] Logs shipped off-host and retained.
- [ ] **Alerts** on failed-login spikes, authorisation-failure spikes, error-rate
      changes, and dead-letter queues.
- [ ] **No secrets, passwords, tokens or full request bodies in logs.**
- [ ] Logs are tamper-resistant.
- [ ] Someone actually reads the alerts.

See [Logging](/knowledge-base/operations/logging) and
[Monitoring](/knowledge-base/operations/monitoring).

## A10 — Mishandling of Exceptional Conditions

**New in 2025.** Covers improper error handling, logic errors and failing open.

- [ ] Errors **fail closed** — a failed authorisation check denies access rather
      than allowing it.
- [ ] No sensitive detail in error responses: no stack traces, SQL, file paths
      or library versions.
- [ ] Timeouts on every outbound call; a hanging dependency does not hang you.
- [ ] Circuit breakers where a dependency failure would cascade.
- [ ] Unhandled exceptions caught at a boundary and logged, not swallowed.
- [ ] Retries only on idempotent operations.
- [ ] Degraded modes are deliberate and documented.
- [ ] Error paths are tested, not just happy paths.

---

## Security Headers

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{random}' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```

- [ ] **HSTS** with a long max-age. Consider preload once you are confident.
- [ ] **CSP**, nonce-based, rolled out via `Report-Only` first.
- [ ] `nosniff` — stops the browser guessing content types.
- [ ] `frame-ancestors 'none'` in CSP — the modern replacement for
      `X-Frame-Options`.
- [ ] `Referrer-Policy` so URLs do not leak to third parties.
- [ ] `Permissions-Policy` denying features you do not use.
- [ ] **`X-XSS-Protection` removed** — the legacy browser filter is deprecated
      and was itself a vulnerability. CSP replaces it.

Verify with [securityheaders.com](https://securityheaders.com) or
[Mozilla Observatory](https://observatory.mozilla.org/).

---

## Secrets

- [ ] **No secrets in the repository**, including history.
- [ ] `.env` in `.gitignore`; a committed `.env.example` with keys but no
      values.
- [ ] Secret scanning in CI (`gitleaks`) **and** forge push protection.
- [ ] Secrets in a manager — Vault, AWS Secrets Manager, Doppler — not in
      environment files on disk.
- [ ] **Rotatable**, and rotated on staff changes.
- [ ] Different secrets per environment.
- [ ] Any secret ever committed is **rotated**, not merely deleted.

See [Git: committing a secret](/knowledge-base/git/common-mistakes#committing-a-secret).

---

## File Uploads

- [ ] File **type validated by content**, not by extension or `Content-Type`.
- [ ] Size limits enforced, at the proxy as well as the application.
- [ ] Stored **outside the web root**, or in object storage.
- [ ] Served from a **separate origin** or as `Content-Disposition: attachment`
      — an uploaded SVG or HTML file on your origin is stored XSS.
- [ ] Filenames generated, never taken from the user (path traversal).
- [ ] Images re-encoded to strip metadata and embedded payloads.
- [ ] Malware scanning where users share files with each other.

See [File Uploads](/knowledge-base/web/file-uploads).

---

## Pre-Launch

- [ ] Dependency audit clean, or every finding triaged with a reason.
- [ ] Staging is **not** indexable and requires authentication.
- [ ] Backups exist **and a restore has been tested**.
- [ ] TLS certificate auto-renewal working, with expiry alerting.
- [ ] An incident contact and escalation path exists.
- [ ] `security.txt` published so researchers can report to you.
- [ ] A rollback procedure exists and has been rehearsed.
- [ ] Penetration test or security review for anything handling money, health
      or identity data.

## Ongoing

- [ ] Dependency updates weekly; majors reviewed deliberately.
- [ ] Access reviews quarterly — who still has production access?
- [ ] Log and alert review; alerts that never fire are as suspicious as alerts
      that always do.
- [ ] Restore drills, not just backup jobs.
- [ ] Post-incident reviews that produce changes, not documents.

---

## Frequently Missed

Ranked by how often they appear in real reviews:

1. **Object-level authorisation on one forgotten endpoint.** Everything else is
   protected; one route is not.
2. **A staging environment with production data** and weak access control.
3. **Verbose errors in production** because `DEBUG` was left on.
4. **A secret committed months ago**, deleted in a later commit, never rotated.
5. **No rate limiting on password reset**, so it becomes the enumeration and
   abuse vector the login form was protected against.
6. **`SameSite=None`** copied from a fix for a local development problem.
7. **CORS reflecting the request origin** with credentials enabled.
8. **An unmonitored dead-letter queue** silently discarding events.
9. **Backups that have never been restored.**
10. **An admin interface on a public URL** with only a password in front of it.

---

## FAQ

**Where do I start with an existing system?**
A01 and A02. Broken access control is the most exploited, and misconfiguration
is the cheapest to fix.

**How often should this be reviewed?**
Fully before launch and annually thereafter; the relevant sections whenever you
add authentication, uploads, a third-party integration, or regulated data.

**Do I need a penetration test?**
For anything handling money, health or identity data, yes. Otherwise start with
automated scanning and a careful walk of this list — a test finds far more when
the obvious is already fixed.

**What if I cannot fix everything?**
Rank by exploitability × impact. An unauthenticated data-exposure bug outranks a
missing header every time.

**Is a WAF worth having?**
As a speed bump and a source of alerts, yes. Never as a substitute for fixing
the underlying issue — it is bypassed by anyone paying attention.

**How do I keep this from going stale?**
Automate what you can: dependency scanning, secret scanning, header checks and
authorisation tests all belong in CI, where they fail loudly rather than waiting
for a review.

---

## Check your understanding

<Quiz
question="Which two categories are new in the OWASP Top 10:2025, and what happened to SSRF?"
options={[
{
text: 'Software Supply Chain Failures and Mishandling of Exceptional Conditions are new; SSRF was folded into Broken Access Control',
correct: true,
why: 'The 2025 revision broadened "vulnerable components" into the whole supply chain, added a category for error handling and failing open, and consolidated SSRF into A01.',
},
{text: 'Cryptographic Failures and Insecure Design are new; SSRF was removed entirely', why: 'Both of those appeared in 2021, and SSRF was consolidated rather than dropped.'},
{text: 'Injection and Broken Access Control are new; SSRF became its own top-three entry', why: 'Both are long-standing categories, and SSRF moved into A01.'},
{text: 'No categories changed; only the ordering was revised', why: 'Two categories were added and Security Misconfiguration moved from #5 to #2.'},
]}
explanation={<>The supply-chain addition matters most for day-to-day work: it makes lockfile discipline, pinned CI actions and OIDC publishing explicit Top 10 concerns rather than good practice.</>}
reference={{label: 'Introduction', href: '/knowledge-base/security/checklist#introduction'}}
/>

<Quiz
question="A team has a clean dependency audit, strict CSP, HSTS and MFA. A tester still extracts every customer's invoices. What was most likely missed?"
options={[
{
text: 'Object-level authorisation on one endpoint — the id in the URL is not checked against the requesting user',
correct: true,
why: 'Headers, MFA and dependency hygiene are all perimeter and platform concerns. Broken access control is A01 precisely because it must be enforced at every endpoint, and one omission is a breach.',
},
{text: 'The CSP is not strict enough', why: 'CSP mitigates XSS. It has no bearing on an API returning records the caller should not see.'},
{text: 'HSTS is not preloaded', why: 'HSTS concerns transport security, not entitlement to data.'},
{text: 'MFA is optional rather than mandatory', why: 'The attacker is authenticating successfully as themselves — MFA does not change what they may then read.'},
]}
explanation={<>This is the most common finding in real reviews: everything is protected except one route. Structural defences — filtering by owner in the query, plus row-level security — beat remembering.</>}
reference={{label: 'Frequently missed', href: '/knowledge-base/security/checklist#frequently-missed'}}
/>

<Quiz
question="Which of these belong under A03 Software Supply Chain Failures?"
type="multiple"
options={[
{text: 'Committing the lockfile and installing from it in CI', correct: true, why: 'Reproducible installs with integrity hashes are the baseline defence against a tampered or substituted package.'},
{text: 'Pinning GitHub Actions to commit SHAs rather than tags', correct: true, why: 'A tag can be moved to point at malicious code; a SHA cannot.'},
{text: 'Publishing packages via OIDC trusted publishing instead of long-lived tokens', correct: true, why: 'Removes the durable credential whose theft lets an attacker publish as you.'},
{text: 'Delaying adoption of brand-new dependency versions by a few days', correct: true, why: 'Most malicious releases are detected and pulled within hours, so a cooldown turns most incidents into non-events.'},
{text: 'Enabling HSTS with a long max-age', why: 'A transport security control under A04, unrelated to the supply chain.'},
]}
explanation={<>The 2025 category deliberately extends past dependencies to build systems and distribution — your CI pipeline and publishing credentials are now explicitly in scope.</>}
reference={{label: 'A03 Software Supply Chain Failures', href: '/knowledge-base/security/checklist#a03--software-supply-chain-failures'}}
/>

<Quiz
question="An application allows users to upload a profile picture, stored in object storage and served from the same origin as the app. What is the risk?"
options={[
{
text: 'An uploaded SVG or HTML file served from your origin executes script in your origin — stored XSS with full session access',
correct: true,
why: 'SVG is XML and can contain script. Serving user-controlled files from your own origin gives that script your origin’s privileges, including access to same-origin data.',
},
{text: 'None, provided the file extension is checked', why: 'Extension checks are trivially bypassed, and the content type is what the browser acts on.'},
{text: 'Only a storage cost concern', why: 'Cost is a consideration; the security issue is code execution in your origin.'},
{text: 'Only a problem if the file is larger than the size limit', why: 'Size limits address denial of service, not content execution.'},
]}
explanation={<>Serve user uploads from a separate origin, or with <code>Content-Disposition: attachment</code> and <code>X-Content-Type-Options: nosniff</code>. Re-encode images to strip embedded payloads and metadata.</>}
reference={{label: 'File uploads', href: '/knowledge-base/security/checklist#file-uploads'}}
/>

<Quiz
question="A code review finds an API key that was committed six months ago and deleted in a later commit. What is the correct action?"
options={[
{
text: 'Rotate the key immediately — it remains in Git history, in every clone and every fork, and deletion in a later commit changes none of that',
correct: true,
why: 'A later commit only changes the current tree. The old commit is still present everywhere the repository has been cloned, and public repositories are scraped continuously.',
},
{text: 'Nothing — the deletion resolved it', why: 'The secret is still readable in history by anyone with the repository.'},
{text: 'Rewrite history with filter-repo and consider it closed', why: 'Necessary as a follow-up step, and it cannot recall clones, forks or forge caches that already exist.'},
{text: 'Add it to .gitignore so it cannot recur', why: 'Prevents recurrence and does nothing about the exposed credential.'},
]}
explanation={<>Order matters: rotate first, then clean history, then prevent recurrence with push protection and a <code>gitleaks</code> pre-commit hook. "Deleted in a later commit" should be read as "still exposed".</>}
reference={{label: 'Secrets', href: '/knowledge-base/security/checklist#secrets'}}
/>

---

## References

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) — the current list, with
  the two new categories.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
  — a far more detailed requirements catalogue, in three assurance levels.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — the
  practical guidance behind most items above.
- [Mozilla Web Security Guidelines](https://infosec.mozilla.org/guidelines/web_security)
  — headers and TLS configuration.
- [securityheaders.com](https://securityheaders.com) and
  [SSL Labs](https://www.ssllabs.com/ssltest/) — verify what you actually
  deployed.
- [OpenSSF Scorecard](https://securityscorecards.dev/) — supply-chain posture
  for your own repositories.
