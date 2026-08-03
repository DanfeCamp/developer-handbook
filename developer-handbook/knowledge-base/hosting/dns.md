---
title: 'DNS'
description: 'How domain names resolve, and the records you actually need — record types, TTL, propagation, delegation, email records and migration without downtime.'
---

# DNS

## Introduction

DNS translates names people can remember into addresses machines can route to.
It is a distributed, hierarchical, heavily cached database, and those three
properties explain almost every confusing thing it does.

**Why developers need to understand it.** DNS sits in front of everything.
A misconfigured record takes a site offline; a misunderstood TTL turns a
five-minute change into a 48-hour outage; and email authentication —
[SPF, DKIM and DMARC](/knowledge-base/web/email#authentication-spf-dkim-dmarc)
— lives entirely in DNS.

**The resolution path**, which is worth knowing because it tells you where a
lookup can be cached or fail:

```text
Browser cache
  → OS cache
    → Recursive resolver (your ISP, 1.1.1.1, 8.8.8.8)
      → Root servers        "who handles .com?"
        → TLD servers       "who handles example.com?"
          → Authoritative   "what is www.example.com?"
```

Only the **authoritative** server holds the truth. Everything in front of it
holds a copy with an expiry, which is why changes are not instant and why
different people see different answers for a while.

---

## Record Types

The ones you will actually use:

| Type      | Purpose                                  | Example                      |
| --------- | ---------------------------------------- | ---------------------------- |
| **A**     | Name → IPv4                              | `example.com → 203.0.113.10` |
| **AAAA**  | Name → IPv6                              | `example.com → 2001:db8::1`  |
| **CNAME** | Alias to another name                    | `www → example.com`          |
| **MX**    | Mail servers, with priority              | `10 mx1.provider.com`        |
| **TXT**   | Arbitrary text — SPF, DKIM, verification | `"v=spf1 …"`                 |
| **NS**    | Delegates a zone to nameservers          | `ns1.provider.com`           |
| **CAA**   | Which CAs may issue certificates         | `0 issue "letsencrypt.org"`  |
| **SRV**   | Service location and port                | `_sip._tcp`                  |
| **PTR**   | IP → name (reverse)                      | Set by the IP owner          |

### The CNAME rules that catch people

**A CNAME cannot coexist with any other record for the same name.** This is a
protocol rule, not a provider limitation.

```text
❌ example.com  CNAME  target.example.net
   example.com  MX     10 mx.provider.com     ← illegal, and breaks email
```

**Therefore you cannot CNAME the apex** (`example.com` itself), because the apex
must carry `NS` and `SOA` records. This matters constantly, because platforms
like Netlify, Vercel and Heroku want you to point at a hostname rather than a
fixed IP.

The workaround is a provider-specific synthetic record — **ALIAS**, **ANAME**,
or Cloudflare's **CNAME flattening** — which behaves like a CNAME at the apex
while returning A records to the resolver. Route 53 calls it an _alias record_.
If your DNS provider does not offer one, use a provider that does.

### CAA is worth setting

An under-used record that limits which certificate authorities may issue for
your domain:

```text
example.com.  CAA  0 issue "letsencrypt.org"
example.com.  CAA  0 iodef "mailto:security@example.com"
```

CAs are required to check it. It is a cheap, real defence against
mis-issuance — a compromised registrar account or a social-engineered CA cannot
quietly obtain a certificate from a CA you have not authorised.

---

## TTL and Propagation

**"DNS propagation" is a misleading phrase.** Nothing propagates. Authoritative
changes are effective immediately; what you are waiting for is **caches to
expire**, and the TTL you set _before_ the change is what determines how long.

```text
www.example.com.  300  IN  A  203.0.113.10
                  ↑ TTL in seconds — how long resolvers may cache this
```

**The consequence that catches everyone:** if the TTL was 86400 (24 hours) when
you make a change, resolvers that cached the old value may serve it for a full
day. Lowering the TTL at the moment you change the record does nothing for
anyone holding the old copy.

**The migration procedure:**

1. **Lower the TTL to 300 seconds, at least 24–48 hours before the change** —
   long enough for the old, longer TTL to expire everywhere.
2. Verify the low TTL is being served.
3. Make the change. Caches now clear within five minutes.
4. Keep both old and new endpoints serving for a day or two, because some
   resolvers ignore TTLs.
5. Raise the TTL again once stable.

**Sensible TTLs:** 300 seconds during a migration, 3600 for records that change
occasionally, 86400 for stable records such as `MX` and `NS`. Very low TTLs
increase query volume and latency; there is no benefit outside a change window.

**Negative caching** matters too. The `SOA` record's minimum field controls how
long an `NXDOMAIN` is cached, so a record you have just created can appear
missing for a while if something looked it up first.

---

## Delegation and Nameservers

The `NS` records at your registrar decide which servers are authoritative. This
is the single highest-stakes DNS setting: point it at the wrong place and every
record you carefully configured is ignored.

**The split that confuses people:** your **registrar** (where you bought the
domain) and your **DNS host** (where records live) need not be the same. Buying
from Namecheap and hosting DNS at Cloudflare is normal — you set Cloudflare's
nameservers at Namecheap, and manage records at Cloudflare.

**Verify which nameservers are actually live:**

```bash
dig NS example.com +short
```

If that does not match what you expect, nothing else you check matters.

**Registrar hygiene**, because domain loss is catastrophic and entirely
preventable:

- **Auto-renew on**, with a payment method that will not expire.
- **Registrar lock** enabled to prevent unauthorised transfers.
- **2FA** on the registrar account.
- **A monitored role address** for the registrant contact, not one person's
  mailbox.
- **Watch for expiry** — set an independent calendar reminder as well.

---

## The Email Records

Email authentication is entirely DNS, and it is where most TXT-record mistakes
live. Full treatment in [Email Systems](/knowledge-base/web/email).

```text
example.com.               MX   10 mx1.provider.com
example.com.               TXT  "v=spf1 include:_spf.provider.com -all"
sel1._domainkey.example.com. TXT "v=DKIM1; k=rsa; p=MIGf..."
_dmarc.example.com.        TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@example.com"
```

Two DNS-specific traps:

- **Exactly one SPF record per domain.** Two `v=spf1` TXT records is a
  `permerror` that breaks authentication entirely, and it happens whenever two
  teams each add one.
- **Long TXT records must be split** into 255-character strings. Most providers
  handle this; some do not, and a truncated DKIM key fails silently.

**Set SPF and DMARC even on domains that send no mail**, so nobody can spoof
them:

```text
noreply.example.com.  TXT  "v=spf1 -all"
_dmarc.noreply.example.com.  TXT  "v=DMARC1; p=reject;"
```

---

## Debugging

`dig` is the tool. `nslookup` and `ping` are not — `ping` shows you a cached
answer with no detail.

```bash
dig example.com A +short              # just the answer
dig example.com A                     # full response, with TTL
dig @1.1.1.1 example.com A            # ask a specific resolver
dig @ns1.provider.com example.com A   # ask the AUTHORITATIVE server directly
dig example.com NS +short             # who is authoritative?
dig +trace example.com                # follow the full delegation from root
dig example.com TXT +short            # SPF, verification records
dig _dmarc.example.com TXT +short
```

**The two commands that resolve most confusion:**

`dig @<authoritative-server>` bypasses every cache and shows the truth. If that
returns the new value but your browser does not, you are waiting on a cache —
not looking at a misconfiguration.

`dig +trace` walks the delegation from the root, which finds the case where the
registrar's `NS` records point somewhere you forgot about.

| Symptom                                        | Cause and fix                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Change not visible                             | Cached. Check the old TTL; query the authoritative server directly.      |
| Works for you, not for others                  | Different resolver caches. Check with `dig @8.8.8.8` and `@1.1.1.1`.     |
| Email stopped after a DNS change               | A CNAME added at a name that also has MX records, or an SPF record lost. |
| `NXDOMAIN` for a record you created            | Negative caching, or the record is in a zone that is not authoritative.  |
| Apex CNAME rejected                            | Protocol restriction. Use ALIAS/ANAME/flattening.                        |
| Certificate issuance fails                     | A CAA record excludes that CA.                                           |
| Site resolves to an old IP long after a change | Long TTL, or a second A record you forgot to remove.                     |
| DNS works, site does not load                  | Not a DNS problem. Check the server, TLS and firewall.                   |

Online tools worth knowing: [dnschecker.org](https://dnschecker.org) for a
global view, and [MXToolbox](https://mxtoolbox.com/) for email records.

---

## Practical Setup

A typical zone:

```text
example.com.         3600  A      203.0.113.10        ; or ALIAS to a platform
example.com.         3600  AAAA   2001:db8::1
www.example.com.     3600  CNAME  example.com.
api.example.com.     3600  A      203.0.113.20
example.com.         3600  MX     10 mx1.provider.com.
example.com.         3600  TXT    "v=spf1 include:_spf.provider.com -all"
example.com.         3600  CAA    0 issue "letsencrypt.org"
_dmarc.example.com.  3600  TXT    "v=DMARC1; p=reject; rua=mailto:dmarc@example.com"
```

**Choose one canonical host** — `example.com` or `www.example.com` — and
redirect the other with a 301 at the application or proxy layer, not with DNS.
DNS cannot redirect; it only resolves names.

**Manage DNS as code** where the zone matters. Terraform, OctoDNS or your
provider's API give you review, history and rollback — and a DNS change made by
hand at 2 a.m. is how outages start.

**Use a provider with an anycast network** — Cloudflare, Route 53, NS1 — so
lookups resolve from a nearby location. DNS latency is on the critical path of
every first request. See [Cloudflare](/knowledge-base/cloudflare).

---

## Do's and Don'ts

### Do

- Lower TTLs 24–48 hours _before_ a planned change.
- Query the authoritative server directly when debugging.
- Set CAA records to restrict certificate issuance.
- Keep exactly one SPF record, and add SPF/DMARC to non-sending domains.
- Enable registrar lock, auto-renew and 2FA.
- Use ALIAS/ANAME/flattening for the apex when pointing at a platform.
- Manage important zones as code.
- Keep old endpoints alive for a day or two after a migration.

### Don't

- Don't add a CNAME at a name that has other records.
- Don't try to CNAME the apex.
- Don't lower TTL at the same moment you make the change.
- Don't use `ping` to debug DNS.
- Don't publish two SPF records.
- Don't let a domain sit on one person's personal email address.
- Don't use very low TTLs permanently.
- Don't expect DNS to redirect — it resolves, it does not rewrite.

---

## Common Mistakes

**Changing a record with a 24-hour TTL and expecting it to take effect.** The
most common DNS mistake, and entirely avoidable with planning.

**CNAME at the apex.** Rejected, or accepted by a provider that then breaks
email.

**Two SPF records.** Silent authentication failure.

**Decommissioning the old server too early.** Some resolvers cache past the TTL;
give it a day.

**Forgetting a stale second A record.** Traffic round-robins between the old and
new servers, producing intermittent failures that look impossible.

**Testing with a browser.** Browsers cache DNS independently of the OS. Use
`dig`.

**Assuming a DNS problem.** If `dig` returns the right answer, the problem is
elsewhere.

**Dangling records after decommissioning.** A CNAME pointing at a released
cloud resource is a **subdomain takeover** — someone else can claim that
hostname and serve content on your domain.

---

## FAQ

**How long does a DNS change take?**
As long as the previous TTL. Plan by lowering it in advance.

**A record or CNAME?**
A record when you have a stable IP. CNAME when pointing at a hostname a platform
manages — and ALIAS/ANAME at the apex.

**Do I need IPv6?**
Increasingly yes. Some mobile networks are IPv6-only, and adding an AAAA record
is usually free.

**Should the registrar host my DNS?**
Not necessarily, and separating them is common. Use a fast anycast DNS provider
regardless of where you bought the domain.

**What is a subdomain takeover?**
A DNS record pointing at a service you no longer own. Someone else registers
that resource and serves content on your subdomain. Remove records when you
decommission anything.

**Is DNS encrypted?**
Traditionally not — DNS-over-HTTPS and DNS-over-TLS encrypt the client-to-
resolver hop. DNSSEC is a different thing: it signs records to prevent
tampering, without hiding them.

---

## Check your understanding

<Quiz
question="A record's TTL is 86400. You lower it to 300 and change the value in the same session. How long until everyone sees the new value?"
options={[
{
text: 'Up to 24 hours — resolvers that cached the record before the change still hold the old value with the old 86400-second TTL',
correct: true,
why: 'The TTL that governs a cached copy is the one in effect when it was cached. Lowering it now only affects lookups made from now on.',
},
{text: 'Five minutes, because the new TTL is 300', why: 'The new TTL applies to fresh lookups. Existing cached entries expire on their original schedule.'},
{text: 'Immediately, since authoritative changes are instant', why: 'The authoritative answer changes instantly; every cache in front of it does not.'},
{text: 'It depends only on the resolver, not the TTL', why: 'Resolvers honour the TTL they received, with some ignoring very long or very short ones.'},
]}
explanation={<>The procedure: lower the TTL 24–48 hours <em>before</em> the change, verify it is being served, then change the value. Keep the old endpoint alive for a day afterwards, because some resolvers overrun TTLs.</>}
reference={{label: 'TTL and propagation', href: '/knowledge-base/hosting/dns#ttl-and-propagation'}}
/>

<Quiz
question="A team adds a CNAME at example.com pointing to their hosting platform. Email immediately stops working. Why?"
options={[
{
text: 'A CNAME cannot coexist with other records for the same name, so the MX records at the apex are invalidated — and the apex cannot be a CNAME at all, since it must carry NS and SOA',
correct: true,
why: 'This is a protocol rule rather than a provider limitation. Use an ALIAS, ANAME or CNAME-flattening record, which behaves like a CNAME at the apex while returning A records.',
},
{text: 'The CNAME target does not run a mail server', why: 'MX records point at mail servers independently of where A or CNAME records point.'},
{text: 'MX records must always be listed before CNAME records', why: 'DNS records are unordered; there is no precedence by position.'},
{text: 'The TTL on the MX records was too low', why: 'TTL affects caching, not whether a record is valid alongside a CNAME.'},
]}
explanation={<>This is the single most common DNS mistake when moving to a platform that wants a hostname rather than an IP. If your provider offers no ALIAS equivalent, that is a reason to change provider.</>}
reference={{label: 'The CNAME rules', href: '/knowledge-base/hosting/dns#the-cname-rules-that-catch-people'}}
/>

<Quiz
question="A DNS change is not visible in your browser. Which command tells you whether the change is live or you are waiting on a cache?"
options={[
{
text: 'dig @ns1.provider.com example.com A — querying the authoritative server directly bypasses every cache',
correct: true,
why: 'If the authoritative server returns the new value, the configuration is correct and you are waiting for caches. If it returns the old one, the change was never applied.',
},
{text: 'ping example.com', why: 'ping shows a cached resolution with no TTL or source detail. It cannot distinguish the two cases.'},
{text: 'Clearing the browser cache', why: 'Browsers cache DNS separately from the OS, and neither tells you what the authoritative server holds.'},
{text: 'dig example.com A with no server specified', why: 'Useful, and it queries your configured resolver — which may be serving a cached answer.'},
]}
explanation={<><code>dig +trace</code> is the other high-value command: it walks the delegation from the root and catches the case where the registrar's NS records point at a provider you had forgotten about.</>}
reference={{label: 'Debugging', href: '/knowledge-base/hosting/dns#debugging'}}
/>

<Quiz
question="Which DNS records are worth setting even on a domain that sends no email?"
type="multiple"
options={[
{text: 'SPF with -all, declaring that no server may send for this domain', correct: true, why: 'Without it, anyone can spoof mail from your domain. A hard-fail SPF on a non-sending domain is free anti-spoofing.'},
{text: 'DMARC with p=reject', correct: true, why: 'Tells receivers to reject anything claiming to be from the domain, which is exactly right when it never sends.'},
{text: 'CAA records restricting which CAs may issue certificates', correct: true, why: 'CAs are required to check it, so it limits mis-issuance from a compromised registrar account or a social-engineered CA.'},
{text: 'MX records pointing at a null target', why: 'A null MX (priority 0, target ".") is valid and signals no mail acceptance — but it concerns inbound mail, not spoofing.'},
{text: 'Very low TTLs on all records, for flexibility', why: 'Low TTLs increase query volume and add latency to every lookup. Use them during a change window only.'},
]}
explanation={<>Unused and parked domains are routinely spoofed precisely because nobody configures them. Three TXT-style records cost nothing and close it.</>}
reference={{label: 'The email records', href: '/knowledge-base/hosting/dns#the-email-records'}}
/>

<Quiz
question="A team decommissions a cloud service but leaves the CNAME pointing at its hostname. What is the risk?"
options={[
{
text: 'Subdomain takeover — someone else can claim that hostname on the platform and serve their own content from your subdomain',
correct: true,
why: 'A dangling record points at a resource you no longer control. An attacker registering the released hostname gains a page on your domain, with your cookies scoped to it in many configurations.',
},
{text: 'Only a broken page, which is a cosmetic problem', why: 'A broken page is the benign outcome; the record being claimable is the security issue.'},
{text: 'Increased DNS query costs', why: 'Query volume is negligible and not the concern.'},
{text: 'Nothing, provided the subdomain is not linked anywhere', why: 'Certificate transparency logs and DNS enumeration make subdomains easy to discover.'},
]}
explanation={<>Remove DNS records as part of decommissioning, and audit periodically for records pointing at hostnames you no longer own — it is a routine finding in security reviews.</>}
reference={{label: 'Common mistakes', href: '/knowledge-base/hosting/dns#common-mistakes'}}
/>

---

## References

- [Cloudflare Learning: What is DNS?](https://www.cloudflare.com/learning/dns/what-is-dns/)
  — clear explanations of resolution and record types.
- [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034) and
  [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035) — the normative
  specifications, including the CNAME restriction.
- [RFC 8659: CAA](https://www.rfc-editor.org/rfc/rfc8659) — restricting
  certificate issuance.
- [dig documentation](https://linux.die.net/man/1/dig) — the query tool.
- [MXToolbox](https://mxtoolbox.com/) — email record diagnostics.
- [OctoDNS](https://github.com/octodns/octodns) — DNS as code across providers.
