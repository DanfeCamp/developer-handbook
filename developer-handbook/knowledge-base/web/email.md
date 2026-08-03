---
title: 'Email Systems'
description: 'Sending transactional email that reaches the inbox — SPF, DKIM, DMARC, deliverability, HTML email, bounce handling and testing.'
---

# Email Systems

## Introduction

Sending email is trivial. Getting it **delivered to the inbox** is not, and the
gap between the two is where teams lose days.

**The problem.** Email has no built-in authentication — SMTP was designed in
1982 for a network where everyone was trusted. Anyone can claim to send from any
address. Two decades of anti-spam has layered authentication on top, and if you
do not implement it correctly your legitimate mail is quietly filed as spam or
rejected outright.

**Two kinds of email**, with different rules:

- **Transactional** — password resets, receipts, notifications. Triggered by a
  user action, expected, and must arrive quickly.
- **Marketing** — newsletters, campaigns. Requires explicit consent, one-click
  unsubscribe, and different legal obligations (GDPR, CAN-SPAM, PECR).

**Send them from different subdomains.** A marketing campaign that generates
spam complaints will damage the reputation of the domain it was sent from, and
you do not want that domain to be the one sending password resets.

**Use a provider.** Running your own SMTP server means managing IP reputation,
feedback loops, bounce processing, TLS and blocklist delisting. Postmark,
Resend, SES, SendGrid and Mailgun have solved this, and their deliverability is
better than yours will be.

---

## Authentication: SPF, DKIM, DMARC

The three DNS records that determine whether your mail is trusted. All three are
required — and since 2024, **Gmail and Yahoo enforce them for bulk senders**,
which made this mandatory rather than advisory.

### SPF — who may send

A DNS TXT record listing the servers authorised to send for your domain.

```text
example.com.  TXT  "v=spf1 include:_spf.google.com include:sendgrid.net -all"
```

- `include:` delegates to a provider's list.
- `-all` means **hard fail** — reject anything else. `~all` (soft fail) is a
  reasonable starting point, and `-all` is where you should end up.
- **The 10-lookup limit is the trap.** Every `include:` costs a DNS lookup, and
  exceeding ten makes the whole record fail with a `permerror` — silently
  breaking authentication for everything. Providers with nested includes consume
  several each. Flatten or consolidate.
- **One SPF record per domain.** Two records is a `permerror`, and it happens
  whenever two teams each add one.

### DKIM — cryptographic signature

The sending server signs the message with a private key; the public key is in
DNS.

```text
selector1._domainkey.example.com.  TXT  "v=DKIM1; k=rsa; p=MIGfMA0GCSq..."
```

Unlike SPF, DKIM **survives forwarding** — the signature travels with the
message. This matters because mailing lists and forwarding rules break SPF
routinely.

Use a **2048-bit key**, and rotate it periodically using selectors — publish the
new selector, switch signing, retire the old.

### DMARC — policy and reporting

Ties the two together and tells receivers what to do on failure.

```text
_dmarc.example.com.  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@example.com; adkim=s; aspf=s; pct=100"
```

| Policy         | Effect                                     |
| -------------- | ------------------------------------------ |
| `p=none`       | Monitor only. Report, but deliver normally |
| `p=quarantine` | Failing mail goes to spam                  |
| `p=reject`     | Failing mail is rejected outright          |

**The rollout that works:** start at `p=none` with `rua` reporting, read the
reports for a few weeks until you have found every legitimate sender (there is
always one nobody remembered — the CRM, the helpdesk, an old marketing tool),
then move to `quarantine`, then `reject`.

**Alignment is the part people miss.** DMARC requires that the domain in the
visible `From:` header matches the domain authenticated by SPF or DKIM. Passing
SPF for your provider's bounce domain while sending as `you@example.com` does
**not** align, and DMARC fails despite SPF passing.

**Read the aggregate reports.** `rua` reports are XML and unpleasant raw; a
dashboard (Postmark's free tool, dmarcian, Valimail) makes them readable and
will show you senders you did not know existed.

### The 2024 bulk sender requirements

Gmail and Yahoo now require, for senders above roughly 5,000 messages a day:

- SPF **and** DKIM **and** DMARC (at least `p=none`).
- **One-click unsubscribe** (`List-Unsubscribe` with `List-Unsubscribe-Post`)
  for marketing mail.
- **Spam complaint rate below 0.3 %**, ideally under 0.1 %.
- TLS for transmission.

These are now table stakes, and they apply to more senders than expected once
you count notification volume.

---

## Deliverability

Authentication gets you eligible for the inbox. Reputation decides whether you
reach it.

**What determines reputation:**

- **Complaint rate.** The single strongest signal. Above 0.3 % and you are in
  trouble.
- **Bounce rate.** Sending to invalid addresses signals a purchased or stale
  list. Keep hard bounces under 2 %.
- **Engagement.** Opens, replies and moves out of spam help; ignored mail hurts.
- **Spam traps.** Recycled dead addresses — hitting one badly damages
  reputation, and they exist precisely to catch senders who never clean lists.
- **Consistency.** Sudden volume spikes look like a compromised account.

**Practices that matter:**

- **Separate subdomains** — `mail.example.com` for transactional,
  `news.example.com` for marketing. Reputation is per-domain.
- **Warm up a new domain or IP.** Start at tens of messages a day and increase
  gradually over weeks. Sending 100,000 from a cold domain lands in spam.
- **Honour unsubscribes immediately** — a legal requirement as well as a
  reputation one.
- **Clean your lists.** Remove hard bounces at once, and suppress addresses that
  have not engaged in a year.
- **Never buy a list.** It is the fastest route to a blocklist, and in the EU it
  is unlawful.
- **Double opt-in** for marketing, which produces a smaller list with far better
  engagement.

**A dedicated IP is not automatically better.** It needs consistent high volume
to build reputation; below roughly 100,000 messages a month, a well-managed
shared pool usually delivers better.

---

## Transactional Email

```ts
import {Resend} from 'resend';

await resend.emails.send({
  from: 'Acme <notifications@mail.example.com>',
  to: user.email,
  replyTo: 'support@example.com',
  subject: `Order ${order.reference} confirmed`,
  html: renderOrderConfirmation(order),
  text: renderOrderConfirmationText(order), // always include a plain-text part
  headers: {'X-Entity-Ref-ID': order.id}, // helps prevent threading in Gmail
});
```

**Send asynchronously.** An email provider can be slow or briefly unavailable;
that must not fail a user's checkout.

```ts
await db.order.create({data: order});
await queue.enqueue('send-order-confirmation', {orderId: order.id}); // after commit
```

**Make it idempotent.** Queues deliver at least once, and duplicate password
reset emails are confusing while duplicate receipts are alarming. Record what
you have sent. See [Queues](/knowledge-base/operations/queues).

**Include a plain-text part.** Some clients prefer it, some users force it, and
HTML-only mail scores worse with spam filters.

**`Reply-To` should be a monitored address.** `noreply@` is a poor default —
users reply to transactional email constantly, and discarding those replies
means missing genuine problems.

---

## HTML Email

Email HTML is roughly two decades behind web HTML, and Outlook renders with
Microsoft Word's engine.

**The constraints:**

- **Tables for layout.** Flexbox and Grid are unsupported in Outlook.
- **Inline CSS.** Many clients strip `<style>` blocks. Use an inliner as part of
  the build.
- **No JavaScript**, ever — it is stripped.
- **Limited web font support.** Provide a system fallback stack.
- **Gmail clips messages above ~102 KB**, hiding the rest behind "View entire
  message".
- **Images are often blocked by default**, so the message must make sense
  without them and every image needs `alt` text.
- **Dark mode** is applied inconsistently; test both.

**Do not hand-write this.** Use **MJML** or **React Email**, which compile to
the table-based, inlined HTML that works everywhere:

```jsx
import {Html, Button, Text, Container} from '@react-email/components';

export function OrderConfirmation({order}) {
  return (
    <Html>
      <Container>
        <Text>Your order {order.reference} is confirmed.</Text>
        <Button href={`https://example.com/orders/${order.id}`}>View order</Button>
      </Container>
    </Html>
  );
}
```

**Accessibility applies here too:** semantic headings, meaningful alt text,
sufficient contrast, and a sensible reading order. Screen readers are used with
email as much as with the web.

---

## Bounces, Complaints and Webhooks

Ignoring these is how a good sending reputation degrades quietly.

**Hard bounce** — permanent (the address does not exist). **Suppress
immediately and permanently.** Continuing to send to it is the fastest way to
look like a spammer.

**Soft bounce** — temporary (mailbox full, server down). Retry a few times, then
suppress.

**Complaint** — the recipient pressed "spam". Suppress immediately, whatever the
message was.

```ts
// Provider webhook handler
export async function POST(request: Request) {
  const event = await verifyWebhookSignature(request); // ALWAYS verify

  switch (event.type) {
    case 'email.bounced':
      if (event.bounceType === 'hard') await suppress(event.email, 'hard_bounce');
      break;
    case 'email.complained':
      await suppress(event.email, 'complaint');
      break;
    case 'email.delivered':
      await recordDelivery(event.messageId);
      break;
  }

  return new Response(null, {status: 200});
}
```

**Maintain a suppression list and check it before every send.** Most providers
maintain one for you; keeping your own means you still have it if you change
provider.

See [Webhooks](/knowledge-base/apis/webhooks) for signature verification and
idempotency.

---

## Testing

**Never send test mail to real addresses.** A test run against production data
is a genuine incident, and it has happened to almost everyone.

```ts
// Local development: capture rather than send
// Mailpit or MailHog runs an SMTP server with a web UI
const transport = config.isProduction
  ? realProvider
  : nodemailer.createTransport({host: 'localhost', port: 1025});
```

- **Mailpit / MailHog** — catch all outgoing mail locally and view it in a
  browser.
- **Provider sandbox modes** — SES and others have test modes that accept and
  discard.
- **Litmus / Email on Acid** — render previews across dozens of real clients.
  The only reliable way to know what Outlook will do.
- **mail-tester.com** — send one message and get a spam score with specific
  problems listed.
- **Assert in tests** that the right email was queued, not that it was sent.

**Guard production sends in staging.** An allowlist of internal domains, enforced
in code, is worth the ten minutes:

```ts
if (!config.isProduction && !ALLOWED_TEST_DOMAINS.has(domainOf(to))) {
  logger.warn({to}, 'Blocked non-production email');
  return;
}
```

---

## Do's and Don'ts

### Do

- Configure SPF, DKIM and DMARC, and progress DMARC to `p=reject`.
- Read your DMARC aggregate reports.
- Use separate subdomains for transactional and marketing mail.
- Send asynchronously through a queue, idempotently.
- Include a plain-text alternative.
- Handle bounce and complaint webhooks, and suppress immediately.
- Use MJML or React Email rather than hand-writing table HTML.
- Provide one-click unsubscribe on marketing mail.
- Capture mail locally in development.

### Don't

- Don't run your own SMTP server without a strong reason.
- Don't exceed SPF's 10-lookup limit, or publish two SPF records.
- Don't send marketing and transactional mail from the same domain.
- Don't buy or scrape lists.
- Don't keep sending to hard-bounced addresses.
- Don't send HTML-only mail.
- Don't use JavaScript, Flexbox or Grid in email.
- Don't send from an unmonitored `noreply@`.
- Don't let email failures break a user-facing request.

---

## Common Mistakes

**DMARC alignment misunderstood.** SPF passes for the provider's bounce domain,
but the visible `From:` is your domain, so DMARC fails. Configure a custom
return-path or rely on aligned DKIM.

**Too many SPF includes.** Silent `permerror` past ten lookups, and
authentication stops working with no obvious symptom.

**Two SPF records.** Also a `permerror`. Merge them.

**Marketing damaging transactional reputation.** One campaign with high
complaints puts password resets in spam.

**Not handling bounces.** Reputation degrades, and nobody notices until
delivery collapses.

**Sending inline.** The checkout fails because the email provider had a slow
minute.

**No idempotency.** A queue retry sends three copies of a receipt.

**Testing against production data.** Real customers receive test emails.

**Assuming sent means delivered.** A provider accepting a message says nothing
about the inbox. Track delivery, bounce and complaint events.

---

## Debugging

| Symptom                                 | Cause and fix                                                        |
| --------------------------------------- | -------------------------------------------------------------------- |
| Everything lands in spam                | Check SPF/DKIM/DMARC alignment first; then reputation and content.   |
| Gmail delivers, Outlook does not        | Different filtering. Check `mail-tester.com` and Microsoft SNDS.     |
| Works from staging, fails in production | Different sending domain or missing DNS records.                     |
| DMARC failing despite SPF passing       | Alignment — the `From:` domain does not match the authenticated one. |
| Delivery dropped suddenly               | A complaint spike, a blocklist entry, or an expired DKIM key.        |
| Message clipped in Gmail                | Above ~102 KB. Reduce the HTML.                                      |
| Layout broken in Outlook only           | Word rendering engine. Use tables and inline CSS.                    |
| Images not displaying                   | Blocked by default. Ensure the message works without them.           |
| Bounce rate climbing                    | Stale list. Suppress hard bounces and clean.                         |

Inspect the received headers — `Authentication-Results` shows exactly what SPF,
DKIM and DMARC evaluated to:

```text
Authentication-Results: mx.google.com;
  spf=pass (google.com: domain of ... designates ...) smtp.mailfrom=mail.example.com;
  dkim=pass header.i=@example.com;
  dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.com
```

---

## FAQ

**Which provider should I use?**
Postmark for transactional deliverability, Resend for developer experience, SES
for cost at volume, SendGrid or Mailgun for mixed workloads. Any of them beats
self-hosting.

**Do I need a dedicated IP?**
Only above roughly 100,000 messages a month with consistent volume. Below that,
a well-managed shared pool is usually better.

**How do I stop mail going to spam?**
In order: correct SPF/DKIM/DMARC with alignment; separate subdomains; handle
bounces and complaints; avoid spam-trigger content; build reputation gradually.

**Can I send email from my application server directly?**
Technically yes; practically no. Cloud provider IPs are widely blocked, and port
25 is often closed outbound.

**What about GDPR?**
Transactional email to fulfil a contract generally does not need separate
consent. Marketing does. Keep proof of consent, and honour unsubscribes.

**How do I track opens and clicks?**
A tracking pixel and rewritten links — both increasingly blocked by privacy
features, so treat open rates as directional at best.

**Why does Outlook break my layout?**
It renders with Microsoft Word's HTML engine. Tables and inline CSS are the
workaround, which is why MJML exists.

---

## Check your understanding

<Quiz
question="SPF passes and DKIM passes, but DMARC fails. What is the most likely cause?"
options={[
{
text: 'Alignment — the domain in the visible From: header does not match the domain authenticated by SPF or DKIM',
correct: true,
why: 'DMARC requires alignment, not merely that SPF or DKIM passed. Passing SPF for a provider’s bounce domain while sending as you@example.com does not align.',
},
{text: 'The DMARC record has a syntax error', why: 'Possible, and it would usually produce no DMARC evaluation rather than a fail.'},
{text: 'The DKIM key is too short', why: 'A weak key may be rejected outright, but the premise says DKIM passed.'},
{text: 'DMARC requires both SPF and DKIM to pass', why: 'Either is sufficient — provided it aligns with the From: domain.'},
]}
explanation={<>Fix it with a custom return-path (aligning SPF) or by ensuring DKIM signs with your domain. Check the <code>Authentication-Results</code> header on a received message — it shows exactly what each mechanism evaluated to.</>}
reference={{label: 'DMARC', href: '/knowledge-base/web/email#dmarc--policy-and-reporting'}}
/>

<Quiz
question="A company sends marketing campaigns and password resets from the same domain. A campaign generates a 0.5% complaint rate. What happens?"
options={[
{
text: 'Domain reputation drops, so password resets and receipts start landing in spam too — reputation is per-domain and the two share it',
correct: true,
why: 'Receivers judge the sending domain. High-complaint marketing poisons the reputation that transactional mail depends on, and users then cannot log in.',
},
{text: 'Only the marketing campaign is affected', why: 'Reputation attaches to the domain, not the message category.'},
{text: 'Nothing — 0.5% is within acceptable limits', why: 'Gmail’s threshold is 0.3%, and under 0.1% is the target. 0.5% is a problem.'},
{text: 'The provider will automatically separate the two streams', why: 'Providers can segment IPs, but the From: domain reputation is yours.'},
]}
explanation={<>Use separate subdomains — <code>mail.example.com</code> for transactional, <code>news.example.com</code> for marketing — so a bad campaign cannot stop password resets arriving.</>}
reference={{label: 'Deliverability', href: '/knowledge-base/web/email#deliverability'}}
/>

<Quiz
question="A team adds a fifth email tool to their SPF record. Authentication silently stops working for all mail. Why?"
options={[
{
text: 'SPF permits a maximum of 10 DNS lookups; each include: costs at least one and nested includes cost more. Exceeding it produces a permerror that fails the whole record',
correct: true,
why: 'The limit counts recursively, so a handful of providers with nested includes exhausts it. The failure is a permerror rather than an obvious error message, which is why it goes unnoticed.',
},
{text: 'SPF records have a 255-character limit that was exceeded', why: 'A single string is limited to 255 characters, but records can be split — and that produces a different failure.'},
{text: 'Only four senders may be authorised per domain', why: 'There is no sender count limit; the constraint is DNS lookups.'},
{text: 'The record must be re-signed after each change', why: 'SPF is a plain TXT record with no signing.'},
]}
explanation={<>Flatten or consolidate includes, and check the count with an SPF validator after every change. Also ensure there is exactly <em>one</em> SPF record — two produces a permerror, and it happens whenever two teams each add their own.</>}
reference={{label: 'SPF', href: '/knowledge-base/web/email#spf--who-may-send'}}
/>

<Quiz
question="Which practices protect sending reputation?"
type="multiple"
options={[
{text: 'Suppressing hard-bounced addresses immediately and permanently', correct: true, why: 'Continuing to send to non-existent addresses is a strong signal of a purchased or unmaintained list.'},
{text: 'Handling complaint webhooks and suppressing those recipients at once', correct: true, why: 'Complaint rate is the single strongest reputation signal; above 0.3% delivery suffers.'},
{text: 'Warming up a new sending domain gradually over weeks', correct: true, why: 'A cold domain suddenly sending high volume looks exactly like a compromised account.'},
{text: 'Using double opt-in for marketing lists', correct: true, why: 'Produces a smaller list with much better engagement, which improves reputation.'},
{text: 'Buying a targeted list from a reputable data vendor', why: 'The fastest route to spam traps and a blocklist — and unlawful in the EU regardless of the vendor.'},
]}
explanation={<>Reputation is earned slowly and lost quickly. The bounce and complaint webhooks are the ones teams most often skip, and their absence degrades delivery invisibly until it collapses.</>}
reference={{label: 'Bounces, complaints and webhooks', href: '/knowledge-base/web/email#bounces-complaints-and-webhooks'}}
/>

<Quiz
question="An order confirmation is sent inline during checkout. What problems does this cause?"
options={[
{
text: 'A slow or unavailable email provider delays or fails the checkout — an unrelated third party can break a revenue path',
correct: true,
why: 'Email delivery is not something the user is waiting for. Enqueue it after the transaction commits so the provider’s availability cannot affect the purchase.',
},
{text: 'None, provided the provider has good uptime', why: 'Good uptime is not perfect uptime, and latency spikes are more common than outages.'},
{text: 'Only that the email arrives slightly later', why: 'Inline sending makes it arrive sooner and couples the checkout to the provider.'},
{text: 'It prevents using HTML email', why: 'Unrelated to when the send happens.'},
]}
explanation={<>Enqueue after the database commits, and make the job idempotent — queues deliver at least once, and a duplicate receipt is alarming to a customer.</>}
reference={{label: 'Transactional email', href: '/knowledge-base/web/email#transactional-email'}}
/>

---

## References

- [Google: Email sender guidelines](https://support.google.com/a/answer/81126) —
  the 2024 bulk sender requirements, authoritatively.
- [DMARC.org](https://dmarc.org/overview/) — how the three mechanisms fit
  together.
- [Postmark: SPF, DKIM and DMARC guides](https://postmarkapp.com/guides/spf) —
  clear, practical setup instructions.
- [MJML](https://mjml.io/) and [React Email](https://react.email/) — generate
  HTML that works in Outlook.
- [mail-tester.com](https://www.mail-tester.com/) — a spam score with specific
  problems listed.
- [Mailpit](https://mailpit.axllent.org/) — capture outgoing mail in
  development.
- [Can I Email](https://www.caniemail.com/) — feature support across email
  clients.
