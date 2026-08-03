---
title: 'SSL/TLS'
description: 'Certificates, HTTPS and transport security in practice — the handshake, ACME automation, the shrinking certificate lifetime, HSTS and configuration.'
---

# SSL/TLS

## Introduction

TLS encrypts traffic between client and server, verifies you are talking to the
server you think you are, and detects tampering in transit. HTTPS is HTTP over
TLS.

**"SSL" is the obsolete name.** SSL 2.0 and 3.0 are broken and disabled
everywhere; the protocol has been TLS since 1999. The word persists in product
names and configuration directives, and everyone knows what you mean — but the
thing you are configuring is TLS.

**What it actually provides:**

- **Confidentiality** — nobody on the path reads the traffic.
- **Integrity** — nobody modifies it undetected.
- **Authentication** — the certificate proves the server controls the domain.

**What it does not provide.** A valid certificate proves domain control, not
that the operator is honest. A phishing site with a Let's Encrypt certificate
shows a padlock, which is why browsers stopped presenting the padlock as a trust
signal.

:::warning Certificate lifetimes are shrinking, and automation is now mandatory
The CA/Browser Forum has voted to reduce maximum certificate lifetime on a
schedule: **200 days from March 2026**, 100 days in 2027, and **47 days by
2029**. Let's Encrypt already issues 6-day certificates and is moving its
default from 90 to 45 days.

Manual renewal is no longer viable. Anything not automated will expire in
production. This is the single most important operational change in TLS in a
decade.
:::

---

## The Handshake

Worth understanding because it explains latency, SNI and most configuration
errors.

```text
Client                                  Server
  │── ClientHello ────────────────────▶│  supported versions, ciphers, SNI
  │◀── ServerHello, Certificate ───────│  chosen cipher, cert chain
  │── key exchange, Finished ─────────▶│
  │◀── Finished ───────────────────────│
  │═══ encrypted application data ════▶│
```

**TLS 1.3 completes this in one round trip**, against two for TLS 1.2. On a
200 ms connection that is a real saving on every new connection, which is one
reason to enable it.

**SNI (Server Name Indication)** is the field in `ClientHello` naming the
hostname the client wants. Without it, a server hosting many sites on one IP
could not know which certificate to present — the certificate is chosen _before_
the HTTP `Host` header is visible. SNI is sent in the clear, which is why a
"wrong certificate" error is usually a server-name mismatch rather than a
certificate problem.

**Session resumption** and TLS 1.3's **0-RTT** avoid the full handshake for
returning clients. 0-RTT data is replayable, so it must only carry idempotent
requests.

---

## Certificates and Chains

A certificate binds a public key to a domain name, signed by a certificate
authority the browser trusts.

```text
Root CA (in the browser/OS trust store, offline)
  └── Intermediate CA (signs day to day)
        └── Your certificate (example.com)
```

**The server must send the full chain** — its own certificate plus every
intermediate, in order. Omitting an intermediate is the classic
"works in Chrome, fails on Android and in `curl`" bug: some clients cache
intermediates from previous connections and paper over the mistake, and others
do not.

```bash
openssl s_client -connect example.com:443 -servername example.com -showcerts
```

**Certificate types:**

| Type                            | Validates                    | Notes                                                    |
| ------------------------------- | ---------------------------- | -------------------------------------------------------- |
| **DV** — domain validated       | Control of the domain        | Automated, free, and what almost everyone should use     |
| **OV** — organisation validated | Domain plus company identity | Manual, paid                                             |
| **EV** — extended validation    | Deeper identity checks       | Browsers removed the green bar; little practical benefit |

**DV is the right default.** Browsers no longer display organisation identity
differently, so OV and EV buy paperwork rather than user-visible trust.

**Wildcards** (`*.example.com`) cover one level of subdomain — not
`a.b.example.com` — and require DNS-01 validation. A **SAN certificate** listing
several explicit names is usually preferable: narrower scope, and one
compromised key does not cover every subdomain.

---

## ACME and Automation

ACME is the protocol that automates issuance and renewal. It is what makes the
shrinking lifetimes manageable.

**Validation methods:**

- **HTTP-01** — serve a token at `/.well-known/acme-challenge/`. Simple, needs
  port 80 reachable, cannot issue wildcards.
- **DNS-01** — publish a TXT record. Works behind a firewall, and is **required
  for wildcards**. Needs API access to your DNS provider.
- **TLS-ALPN-01** — validation over port 443. Useful when port 80 is closed.

**The tools:**

```bash
# Certbot — the reference client
certbot --nginx -d example.com -d www.example.com

# acme.sh — shell, no dependencies, excellent DNS provider coverage
acme.sh --issue --dns dns_cf -d example.com -d '*.example.com'
```

**Caddy obtains and renews certificates automatically with no configuration at
all**, which is a strong argument for it on a simple deployment:

```caddy
example.com {
  reverse_proxy localhost:3000
}
```

That is the entire config, including TLS.

**Automation requirements**, given lifetimes measured in weeks:

- **Renew at half the lifetime**, not near expiry. Certbot's timer does this.
- **Reload the server after renewal** — a renewed certificate on disk that
  nginx has not reloaded is still the old one in memory. Use a deploy hook.
- **Monitor expiry independently** of the renewal process. If renewal breaks
  silently, the certificate is what tells you.
- **Rate limits exist** — Let's Encrypt allows 50 certificates per registered
  domain per week, and 5 duplicates. Use `--dry-run` and the staging endpoint
  while testing, or you will be locked out for a week.

---

## Configuration

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;  # full chain
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    ssl_protocols       TLSv1.2 TLSv1.3;   # nothing older
    ssl_prefer_server_ciphers off;          # let the client choose in 1.3
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    ssl_stapling on;                        # OCSP stapling
    ssl_stapling_verify on;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;   # redirect, do not serve
}
```

Note `fullchain.pem`, not `cert.pem` — that is the chain problem above.

**Do not hand-write cipher lists.** Use
[Mozilla's SSL Configuration Generator](https://ssl-config.mozilla.org/), which
produces current configuration for your server and a chosen compatibility level.
Cipher advice ages badly, and a copied 2015 config is now actively harmful.

**Protocol versions:** TLS 1.2 and 1.3 only. TLS 1.0 and 1.1 are deprecated and
fail PCI compliance. TLS 1.3 removed every weak cipher by design, which is why
cipher configuration barely matters once you are on it.

**HSTS** tells browsers to use HTTPS for this domain without asking:

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

It closes the window where a first plain-HTTP request can be intercepted and
downgraded. **Be careful with `includeSubDomains` and `preload`** — preloading
is baked into browsers and effectively irreversible for a long time. Every
subdomain, including internal tools and legacy systems, must then serve valid
HTTPS. Start with a short `max-age`, confirm nothing breaks, then extend.

---

## Where TLS Terminates

A decision with security and operational consequences.

**At a CDN or load balancer** — the common pattern. TLS terminates at the edge,
and traffic continues to your origin over HTTP or a second TLS connection.

- Certificate management is handled for you.
- **The traffic between edge and origin must still be protected.** Plain HTTP
  over the public internet is a real exposure. Use TLS to the origin, a private
  network, or an authenticated tunnel.
- Your application no longer sees the client IP or protocol directly — it must
  trust `X-Forwarded-For` and `X-Forwarded-Proto`, and only from the proxy. See
  [Reverse Proxy](/knowledge-base/hosting/reverse-proxy).

**At your own reverse proxy** — nginx or Caddy terminates, and proxies to the
application over localhost. The standard single-server arrangement.

**At the application** — Node or Go serving TLS directly. Workable, and you take
on certificate reloading, cipher configuration and OCSP yourself. Usually not
worth it.

**End-to-end (mTLS)** — both sides present certificates. Standard for
service-to-service authentication inside a mesh, and rare for public traffic.

---

## Common Mistakes

**Manual renewal.** With lifetimes heading to 47 days, this is now guaranteed to
fail. Automate or use a platform that does.

**Serving `cert.pem` instead of `fullchain.pem`.** Missing intermediates, and it
appears to work in the browser you tested.

**Forgetting to reload after renewal.** The new certificate is on disk and the
old one is in memory.

**No expiry monitoring.** Renewal breaks silently; the outage is the
notification.

**Hitting Let's Encrypt rate limits while testing.** Use `--dry-run` and the
staging environment.

**Copied cipher configuration from an old tutorial.** Weak ciphers and
deprecated protocols, presented as hardening.

**HSTS preload before you are ready.** Every subdomain must serve valid HTTPS,
and removal from the preload list takes months.

**Mixed content.** An HTTPS page loading HTTP resources — blocked by browsers,
and a real downgrade. Use protocol-relative or absolute HTTPS URLs.

**Plain HTTP between proxy and origin over a public network.** TLS terminated at
the edge and then abandoned.

**Certificate on the wrong hostname.** SNI mismatches produce alarming browser
warnings for what is a configuration slip.

---

## Debugging

| Symptom                                        | Cause and fix                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `NET::ERR_CERT_AUTHORITY_INVALID`              | Self-signed, or missing intermediates. Serve `fullchain.pem`.             |
| `NET::ERR_CERT_COMMON_NAME_INVALID`            | Certificate does not cover the requested hostname.                        |
| Works in Chrome, fails in `curl` or on Android | Missing intermediate; Chrome cached it from elsewhere.                    |
| Certificate expired despite automation         | Renewal ran but the server was not reloaded; or the timer is not enabled. |
| ACME HTTP-01 challenge fails                   | Port 80 blocked, or a redirect intercepting `/.well-known/`.              |
| ACME DNS-01 fails                              | TXT record not propagated yet, or wrong API credentials.                  |
| Mixed-content warnings                         | HTTP resources on an HTTPS page.                                          |
| TLS handshake very slow                        | No session resumption, or an unnecessarily long chain.                    |
| Rate limit from Let's Encrypt                  | Too many issuances. Wait, and use staging for testing.                    |

```bash
# Inspect the served certificate and chain
openssl s_client -connect example.com:443 -servername example.com

# Check expiry
echo | openssl s_client -connect example.com:443 2>/dev/null \
  | openssl x509 -noout -dates

# Verify a renewal will work, without spending rate limit
certbot renew --dry-run
```

[SSL Labs](https://www.ssllabs.com/ssltest/) grades a public endpoint and lists
every weakness — the fastest external check available.

---

## Do's and Don'ts

### Do

- Automate issuance and renewal with ACME, and renew at half the lifetime.
- Serve the full chain.
- Reload the server after renewal via a deploy hook.
- Monitor certificate expiry independently of the renewal process.
- Use TLS 1.2 and 1.3 only, with Mozilla's generated configuration.
- Redirect HTTP to HTTPS and send HSTS.
- Protect traffic between edge and origin.
- Set CAA records to limit which CAs may issue for you.
- Test with `--dry-run` and the staging endpoint.

### Don't

- Don't renew manually.
- Don't serve `cert.pem` without the intermediates.
- Don't copy cipher lists from old tutorials.
- Don't enable HSTS preload before every subdomain is ready.
- Don't pay for EV expecting a user-visible trust signal.
- Don't allow TLS 1.0 or 1.1.
- Don't leave plain HTTP between proxy and origin across a public network.
- Don't put a private key in version control.

---

## FAQ

**Do I still need to buy certificates?**
Almost never. Let's Encrypt, ZeroSSL and every major platform issue DV
certificates free. Paid certificates buy support, warranties and OV/EV
validation, none of which browsers surface.

**Why are lifetimes being reduced?**
Shorter lifetimes limit the damage from a compromised key, reduce reliance on
revocation (which has never worked reliably), and force the automation that
makes the whole system more robust.

**Wildcard or SAN certificate?**
SAN with explicit names where practical — narrower blast radius. Wildcards when
subdomains are created dynamically; note they require DNS-01.

**Does TLS slow things down?**
Negligibly on modern hardware, and TLS 1.3 needs only one round trip. HTTP/2 and
HTTP/3 require it, so HTTPS is usually _faster_ overall.

**What about mTLS?**
Both sides present certificates. Standard for service-to-service authentication
in a mesh; impractical for public users.

**Is the padlock a trust signal?**
No, and browsers have de-emphasised it for exactly that reason. It means the
connection is encrypted, not that the site is honest.

**How do I handle certificates in containers?**
Terminate at an ingress or load balancer that manages them, or mount them from a
secret store. Do not bake certificates into images.

---

## Check your understanding

<Quiz
question="A site works in Chrome but fails with a certificate error in curl and on some Android devices. What is the most likely cause?"
options={[
{
text: 'The server is not sending the intermediate certificates — Chrome had cached them from another site, so it completed the chain where stricter clients could not',
correct: true,
why: 'The server must present its own certificate plus every intermediate. Some clients cache intermediates from previous connections and mask the omission; curl and many mobile stacks do not.',
},
{text: 'The certificate has expired', why: 'Expiry fails consistently across every client, not selectively.'},
{text: 'curl does not support TLS 1.3', why: 'It does, and a protocol mismatch produces a different error.'},
{text: 'Android requires an EV certificate', why: 'No client requires EV, and browsers no longer display it differently.'},
]}
explanation={<>Point the server at <code>fullchain.pem</code> rather than <code>cert.pem</code>, and verify with <code>openssl s_client -showcerts</code>. Testing in one browser is exactly how this ships.</>}
reference={{label: 'Certificates and chains', href: '/knowledge-base/hosting/ssl-tls#certificates-and-chains'}}
/>

<Quiz
question="Why has manual certificate renewal stopped being viable?"
options={[
{
text: 'The CA/Browser Forum is reducing maximum lifetimes on a schedule — 200 days from March 2026, 100 days in 2027, 47 days by 2029 — so renewal becomes a frequent, unavoidable operational task',
correct: true,
why: 'At 47 days a certificate must be replaced roughly eight times a year per domain. Any manual process will eventually miss one, and the failure is a full outage.',
},
{text: 'Certificate authorities have stopped issuing long-lived certificates voluntarily', why: 'It is a Baseline Requirements change binding on all publicly trusted CAs, not a voluntary choice.'},
{text: 'Manual renewal was never possible', why: 'It was standard practice for years with one- and two-year certificates.'},
{text: 'Browsers now reject any certificate not issued via ACME', why: 'The issuance protocol is not checked by browsers; only validity and chain are.'},
]}
explanation={<>Two automation details matter as much as the renewal itself: reload the server afterwards (a renewed file is not a reloaded process), and monitor expiry <em>independently</em>, so a silently broken renewal is caught before it becomes an outage.</>}
reference={{label: 'ACME and automation', href: '/knowledge-base/hosting/ssl-tls#acme-and-automation'}}
/>

<Quiz
question="A team enables HSTS with includeSubDomains and preload on their main domain. What should they check first?"
options={[
{
text: 'That every subdomain — including internal tools and legacy systems — serves valid HTTPS, because preload is baked into browsers and effectively irreversible for a long time',
correct: true,
why: 'includeSubDomains applies the policy to every subdomain, and preloading means browsers enforce it without ever contacting your server. Removal from the preload list takes months.',
},
{text: 'That the certificate is EV rather than DV', why: 'Certificate type has no bearing on HSTS.'},
{text: 'That max-age is under 24 hours', why: 'Preload submission requires a long max-age; a short one is for cautious rollout before preloading.'},
{text: 'That TLS 1.0 is still enabled for compatibility', why: 'TLS 1.0 is deprecated and should be disabled regardless.'},
]}
explanation={<>Roll out in stages: a short <code>max-age</code> first, then extend, then add <code>includeSubDomains</code>, and only submit for preload once you are confident. The forgotten legacy subdomain is what breaks.</>}
reference={{label: 'Configuration', href: '/knowledge-base/hosting/ssl-tls#configuration'}}
/>

<Quiz
question="Which statements about TLS are accurate?"
type="multiple"
options={[
{text: 'A valid certificate proves domain control, not that the operator is trustworthy', correct: true, why: 'Which is why phishing sites have padlocks, and why browsers have de-emphasised the padlock as a trust indicator.'},
{text: 'SNI is sent unencrypted, so the server can choose a certificate before seeing the Host header', correct: true, why: 'The certificate must be selected during the handshake, before any HTTP is exchanged.'},
{text: 'TLS 1.3 completes the handshake in one round trip rather than two', correct: true, why: 'A measurable saving on every new connection, particularly on high-latency links.'},
{text: 'Wildcard certificates require DNS-01 validation', correct: true, why: 'HTTP-01 cannot prove control of arbitrary subdomains, so wildcards need a DNS TXT record.'},
{text: 'EV certificates display organisation identity in modern browsers', why: 'Browsers removed the green bar and organisation display years ago, which removed most of EV’s rationale.'},
]}
explanation={<>The practical upshot: use free DV certificates, automate them, and spend the saved effort on configuration and monitoring rather than on validation tiers nobody sees.</>}
reference={{label: 'Certificates and chains', href: '/knowledge-base/hosting/ssl-tls#certificates-and-chains'}}
/>

<Quiz
question="TLS terminates at a CDN, which then forwards to the origin over plain HTTP across the public internet. What is wrong?"
options={[
{
text: 'The traffic between edge and origin is unencrypted on a public network — TLS was terminated and then abandoned, leaving the segment readable and modifiable',
correct: true,
why: 'Termination at the edge is a normal pattern, but the hop to the origin still crosses untrusted infrastructure. Use TLS to the origin, a private network, or an authenticated tunnel.',
},
{text: 'Nothing — the CDN handles all security concerns', why: 'The CDN secures the client-to-edge hop only.'},
{text: 'It only matters if the site handles payments', why: 'Session cookies and personal data are exposed on any site, and an on-path attacker can modify responses.'},
{text: 'It prevents HTTP/2 from working', why: 'Protocol support is independent of whether the origin hop is encrypted.'},
]}
explanation={<>Note the related consequence: with TLS terminated upstream, your application no longer sees the real client IP or protocol, so it must trust <code>X-Forwarded-For</code> and <code>X-Forwarded-Proto</code> — and only from the proxy.</>}
reference={{label: 'Where TLS terminates', href: '/knowledge-base/hosting/ssl-tls#where-tls-terminates'}}
/>

---

## References

- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) —
  current, correct configuration for every common server.
- [SSL Labs Server Test](https://www.ssllabs.com/ssltest/) — grade a live
  endpoint and see every weakness.
- [Let's Encrypt documentation](https://letsencrypt.org/docs/) — ACME, rate
  limits, and the certificate lifetime roadmap.
- [CA/Browser Forum Baseline Requirements](https://cabforum.org/working-groups/server/baseline-requirements/documents/)
  — the normative source for the lifetime schedule.
- [Certbot](https://certbot.eff.org/) and [acme.sh](https://github.com/acmesh-official/acme.sh)
  — the two most-used ACME clients.
- [Caddy](https://caddyserver.com/) — automatic HTTPS with no configuration.
- [MDN: Transport Layer Security](https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security)
  — protocol reference.
