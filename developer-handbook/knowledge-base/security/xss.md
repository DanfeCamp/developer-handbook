---
title: 'XSS'
description: 'Stopping untrusted input from becoming executable code — the three types, context-aware escaping, sanitisation, CSP and Trusted Types.'
---

# XSS

## Introduction

Cross-site scripting is the injection of attacker-controlled script into a page
that other users load. The browser has no way to distinguish script you wrote
from script an attacker inserted — both arrived in the same document from the
same origin, so both run with the same privileges.

**What an attacker gets.** Everything the user's session can do: read and
exfiltrate any data the page can reach, make authenticated requests as the user,
capture keystrokes on a login form, rewrite the page to phish credentials, and —
if the session token is reachable from JavaScript — steal it and continue from
their own machine later.

**Why it persists.** Escaping is not one rule. The correct escaping depends on
_where_ the value lands: HTML text, an attribute, a URL, a `<script>` block and
a CSS declaration each need different treatment, and applying the wrong one is
as good as applying none.

**The good news.** Modern frameworks escape by default, which has moved XSS from
ubiquitous to something that appears mainly where you deliberately opt out. The
sinks are enumerable, and this page enumerates them.

---

## The Three Types

**Stored (persistent)** — the payload is saved on the server and served to
everyone who views it. A comment, a profile field, a product review. The most
damaging, because it does not need the victim to click anything.

**Reflected** — the payload is in the request and echoed straight back. A search
term rendered into "No results for …". Requires a crafted link, so it is
typically delivered by phishing.

**DOM-based** — the payload never reaches the server. Client-side JavaScript
reads attacker-controlled input and writes it into a dangerous sink.

```js
// A classic DOM XSS: the fragment never reaches the server, so no
// server-side filter can help.
document.querySelector('#welcome').innerHTML = location.hash.slice(1);
// …/page#<img src=x onerror=alert(document.cookie)>
```

DOM-based XSS is increasingly the common form, because so much rendering has
moved into the browser. Server-side scanners miss it entirely.

---

## The Sinks

There is no `<script>` tag in most real payloads. `<img src=x onerror=…>` is
enough, and so is a `javascript:` URL.

### HTML sinks

```js
// ❌ Every one of these parses HTML and will execute injected markup
el.innerHTML = untrusted;
el.outerHTML = untrusted;
el.insertAdjacentHTML('beforeend', untrusted);
el.setHTMLUnsafe(untrusted);
document.write(untrusted);

// ✅ Text is text — markup is never parsed
el.textContent = untrusted;
```

### URL sinks

Frequently overlooked. A `javascript:` URL executes on click:

```js
// ❌
anchor.href = untrusted;
iframe.src = untrusted;
location = untrusted;

// ✅ Validate the scheme against an allowlist
function safeUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}
```

### Execution sinks

```js
eval(untrusted);
new Function(untrusted);
setTimeout(untrusted, 0); // a string argument is evaluated
element.setAttribute('onclick', untrusted);
```

### Style sinks

```js
// A crafted background-image can exfiltrate data to an attacker's server
el.style.cssText = untrusted;
```

---

## Escaping Is Context-Dependent

The core insight, and the reason a single `escapeHtml()` helper is not enough.

| Context         | Example                            | Escape                                 |
| --------------- | ---------------------------------- | -------------------------------------- |
| HTML text       | `<p>HERE</p>`                      | `&` `<` `>`                            |
| Attribute value | `<div title="HERE">`               | The above plus quotes                  |
| URL             | `<a href="HERE">`                  | URL-encode **and** validate the scheme |
| JavaScript      | `<script>var x = "HERE"</script>`  | JS string escaping — avoid entirely    |
| CSS             | `<style>a { color: HERE }</style>` | CSS escaping — avoid entirely          |

```html
<!-- HTML-escaping is insufficient here: no quotes are needed to break out -->
<div class={{ userInput }}>
<!-- userInput = "x onmouseover=alert(1)" -->
```

**Never interpolate untrusted data into a `<script>` block or a `<style>`
block.** There is no reliable escaping. Pass data through a `data-` attribute
and read it with `dataset`, or serialise it as JSON into a
`<script type="application/json">` element and parse it.

---

## Framework Defaults

Modern frameworks escape by default. Know precisely where they stop.

### React

```jsx
<div>{userInput}</div>                                    {/* ✅ escaped */}
<div dangerouslySetInnerHTML={{__html: userInput}} />      {/* ❌ the opt-out */}
<a href={userInput}>link</a>                               {/* ❌ javascript: URLs */}
```

React escapes interpolated values, so the remaining sinks are the ones where you
opt out. The name `dangerouslySetInnerHTML` is deliberate — treat it as a
review trigger.

### Vue

```vue
<div>{{ userInput }}</div>        <!-- ✅ escaped -->
<div v-html="userInput"></div>    <!-- ❌ -->
```

### Angular

Strongest defaults of the three: it sanitises HTML bindings automatically, and
bypassing requires the conspicuously named
`bypassSecurityTrustHtml`.

### Server-side templates

| Engine      | Escaped by default | The unsafe form            |
| ----------- | ------------------ | -------------------------- |
| Blade       | ✅ `{{ }}`         | `{!! !!}`                  |
| Twig        | ✅                 | `\|raw`                    |
| Django      | ✅                 | `\|safe`, `autoescape off` |
| ERB (Rails) | ✅                 | `raw`, `html_safe`         |
| Handlebars  | ✅ `{{ }}`         | `{{{ }}}`                  |
| EJS         | ✅ `<%= %>`        | `<%- %>`                   |

**Grep for the unsafe forms.** In most codebases there are a handful, and each
is either fine or a vulnerability.

---

## Sanitising Rich HTML

Sometimes HTML is the requirement — a CMS body, a Markdown render, a rich-text
editor. Then you must sanitise.

```ts
import DOMPurify from 'dompurify';

el.innerHTML = DOMPurify.sanitize(untrustedHtml, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h2', 'h3'],
  ALLOWED_ATTR: ['href', 'title'],
});
```

The native **Sanitizer API** is arriving — `Element.setHTML()` shipped in
Firefox 148 and Chrome 146, though it is **not yet Baseline**, so feature-detect:

```ts
if ('setHTML' in Element.prototype) {
  el.setHTML(untrustedHtml); // safe defaults: no scripts, no event handlers
} else {
  el.innerHTML = DOMPurify.sanitize(untrustedHtml);
}
```

Two rules:

**Sanitise on output, not input.** Sanitising when storing means the moment a
second write path appears — an import, an admin tool, a migration — unsanitised
content enters the database. It also destroys the original, so you can never
re-render it under different rules.

**Use a maintained library.** Hand-written sanitisers are defeated by
mutation-XSS, nested encoding and parser quirks that took the DOMPurify authors
years to enumerate.

---

## Content Security Policy

Defence in depth: even if a payload lands, CSP can stop it executing.

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-r4nd0m' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  require-trusted-types-for 'script'
```

```html
<script nonce="r4nd0m">
  // Only scripts carrying the per-response nonce run
</script>
```

- **A nonce-based policy** is far stronger than an allowlist of domains.
  Allowlists are routinely bypassed via JSONP endpoints or hosted libraries on a
  permitted CDN.
- **`'strict-dynamic'`** lets a trusted script load further scripts, which is
  what makes nonces workable with bundlers.
- **`object-src 'none'` and `base-uri 'none'`** close two commonly forgotten
  vectors — plugin content, and `<base>` tag injection that redirects every
  relative URL.
- **Avoid `'unsafe-inline'` and `'unsafe-eval'`.** With them, the policy
  provides very little.

**Roll out with `Content-Security-Policy-Report-Only`** first and collect
violations; a strict CSP applied blind will break your site.

### Trusted Types

The strongest available control, and Chromium-only for now. It makes dangerous
sinks throw unless the value passed through a policy:

```http
Content-Security-Policy: require-trusted-types-for 'script'
```

```js
const policy = trustedTypes.createPolicy('app', {
  createHTML: (input) => DOMPurify.sanitize(input),
});

el.innerHTML = policy.createHTML(untrusted); // any other assignment throws
```

This converts DOM XSS from an invisible vulnerability into a loud runtime error,
and it makes the sinks statically greppable.

---

## Do's and Don'ts

### Do

- Use a framework's default escaping, and treat every opt-out as a review
  trigger.
- Escape for the specific context — text, attribute, URL.
- Validate URL schemes against an allowlist.
- Sanitise rich HTML with DOMPurify or the Sanitizer API, **on output**.
- Deploy a nonce-based CSP with `object-src 'none'` and `base-uri 'none'`.
- Set `HttpOnly` on session cookies so XSS cannot steal them.
- Adopt Trusted Types where you can.
- Grep for `dangerouslySetInnerHTML`, `v-html`, `|raw`, `{!! !!}` and
  `innerHTML`.

### Don't

- Don't interpolate untrusted data into `<script>` or `<style>` blocks.
- Don't write your own sanitiser.
- Don't sanitise on input only.
- Don't assume a single `escapeHtml()` covers every context.
- Don't put untrusted values in `href` or `src` without scheme validation.
- Don't use `eval`, `new Function`, or `setTimeout` with a string.
- Don't rely on CSP alone — it is a second layer, not the fix.
- Don't allow `'unsafe-inline'` in `script-src`.

---

## Common Mistakes

**Blocklist filtering.** Stripping `<script>` and `onerror`. There are hundreds
of variants, and encoding, nested tags and mutation-XSS defeat every blocklist
ever written. Allowlist instead.

**Escaping once, rendering twice.** A value escaped for HTML and then placed
into an attribute without quotes is still injectable.

**Trusting internal data.** Content from your own database, another service or a
partner API can carry a payload someone else stored.

**Forgetting DOM XSS.** Server-side escaping does nothing when the payload never
reaches the server.

**Sanitising then modifying.** Any string manipulation after sanitisation can
reintroduce a payload.

**Markdown rendered without sanitising.** Most Markdown renderers permit inline
HTML by default.

**`javascript:` URLs.** The sink people forget, because it does not look like
HTML injection.

**SVG uploads served from your origin.** SVG is XML and can contain script. Serve
user-uploaded files from a separate origin, or as
`Content-Disposition: attachment`. See
[File Uploads](/knowledge-base/web/file-uploads).

---

## Testing

```ts
it('escapes HTML in a comment body', async () => {
  await createComment({body: '<img src=x onerror=alert(1)>'});

  const html = await renderPage();
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img src=x');
});

it('rejects a javascript: URL in a profile link', () => {
  expect(safeUrl('javascript:alert(1)')).toBe('#');
});
```

Beyond unit tests:

- **`eslint-plugin-security`** and framework-specific rules flag dangerous
  sinks.
- **Grep the codebase** for every sink listed above; the list is short and
  finite.
- **CSP violation reports** from production reveal injections you did not know
  about.
- **DAST tools** (ZAP, Burp) probe reflected and stored XSS automatically.
- **Test a payload list**, not one string: `"><script>`, `javascript:`,
  `onerror=`, encoded variants, and SVG.

---

## FAQ

**Does React make me immune?**
No. It escapes interpolation, which removes the common case. It does not protect
`dangerouslySetInnerHTML`, `href` values, or any DOM manipulation you do
directly.

**Is CSP enough on its own?**
No. It is a second layer that limits the damage. Escaping remains the fix.

**Can XSS still steal a session with `HttpOnly` cookies?**
It cannot read the cookie, so it cannot exfiltrate the token — but it can make
authenticated requests from the page while it is open. `HttpOnly` reduces
severity substantially; it does not eliminate it.

**Should I sanitise on input or output?**
Output. Input sanitisation misses future write paths and destroys the original
data.

**What is mutation-XSS?**
A payload that is safe when parsed once but becomes dangerous after the browser
re-serialises and re-parses it. It is the main reason hand-written sanitisers
fail.

**Is `textContent` always safe?**
Yes for HTML injection — it never parses markup. It says nothing about the value
being safe for other contexts, such as a URL.

---

## Check your understanding

<Quiz
question="A React app renders `<a href={user.website}>` with a URL from the user's profile. Is this safe?"
options={[
{
text: 'No — React escapes text content but does not validate URL schemes, so javascript:alert(1) executes when the link is clicked',
correct: true,
why: 'URL sinks are outside React’s escaping. Validate the scheme against an allowlist of http, https and mailto before rendering.',
},
{text: 'Yes — React escapes all interpolated values including attributes', why: 'It escapes the value as an attribute string, which does not prevent the javascript: scheme from being honoured on click.'},
{text: 'Yes, provided the value came from the database', why: 'The database stores whatever the user submitted. Origin of the data is not a safety property.'},
{text: 'No, but only if the app also uses dangerouslySetInnerHTML', why: 'The two are independent sinks; this one is exploitable on its own.'},
]}
explanation={<>Parse the value with <code>new URL()</code> and allow only known-safe protocols. The same applies to <code>iframe src</code>, <code>form action</code> and any assignment to <code>location</code>.</>}
reference={{label: 'URL sinks', href: '/knowledge-base/security/xss#url-sinks'}}
/>

<Quiz
question="A team strips `<script>` tags and the string 'onerror' from user input before storing it. Why is this inadequate?"
options={[
{
text: 'Blocklist filtering cannot enumerate the attack surface — there are hundreds of event handlers, encodings and mutation-XSS variants that bypass any list',
correct: true,
why: 'onload, onfocus, onmouseover, SVG payloads, encoded entities and browser parser quirks all evade it. Allowlisting with a maintained sanitiser is the only workable approach.',
},
{text: 'It is adequate provided the list is kept updated', why: 'Every blocklist ever written has been bypassed. The approach is unsound rather than incomplete.'},
{text: 'The problem is only that it should run on output as well', why: 'Output-time sanitising is important, and a blocklist is still bypassable at either point.'},
{text: 'It is fine for stored XSS but not reflected', why: 'The bypasses work identically in both cases.'},
]}
explanation={<>Two fixes together: escape by default and use DOMPurify (or the native Sanitizer API) with an explicit <code>ALLOWED_TAGS</code> list where rich HTML is genuinely required.</>}
reference={{label: 'Common mistakes', href: '/knowledge-base/security/xss#common-mistakes'}}
/>

<Quiz
question="Which of these are genuine XSS sinks that require attention?"
type="multiple"
options={[
{text: 'element.innerHTML = untrusted', correct: true, why: 'Parses markup. `<img src=x onerror=…>` runs immediately, with no script tag involved.'},
{text: 'anchor.href = untrusted', correct: true, why: 'A javascript: URL executes on click. Validate the scheme.'},
{text: 'element.style.cssText = untrusted', correct: true, why: 'A crafted background-image URL can exfiltrate data to an attacker-controlled server.'},
{text: 'setTimeout(untrusted, 0) where untrusted is a string', correct: true, why: 'A string first argument is evaluated as code, exactly like eval.'},
{text: 'element.textContent = untrusted', why: 'Sets a text node; markup is never parsed. This is the safe sink and the default to reach for.'},
]}
explanation={<>The sink list is finite, which is what makes XSS tractable: grep for these, plus the framework opt-outs, and you have enumerated most of the risk in a codebase.</>}
reference={{label: 'The sinks', href: '/knowledge-base/security/xss#the-sinks'}}
/>

<Quiz
question="A page reads `location.hash` and writes it into innerHTML. A server-side WAF scanning request bodies finds nothing. Why?"
options={[
{
text: 'The fragment is never sent to the server, so this DOM-based XSS is invisible to any server-side filter or scanner',
correct: true,
why: 'Browsers do not transmit the portion after #. The payload travels only within the client, which is why DOM XSS requires client-side analysis to find.',
},
{text: 'The WAF needs its rule set updated', why: 'No rule can inspect data the server never receives.'},
{text: 'Fragments are automatically URL-encoded and therefore safe', why: 'Encoding is not sanitisation, and innerHTML decodes entities as it parses.'},
{text: 'It is only exploitable if the site also has reflected XSS', why: 'It is directly exploitable via a crafted link.'},
]}
explanation={<>DOM XSS is now the most common form, because rendering has moved into the browser. Trusted Types is the strongest mitigation — it makes the sink throw unless the value passed through an explicit policy.</>}
reference={{label: 'The three types', href: '/knowledge-base/security/xss#the-three-types'}}
/>

<Quiz
question="Why is a nonce-based CSP considered stronger than a domain allowlist?"
options={[
{
text: 'Allowlisted domains often host JSONP endpoints or libraries that can be abused to execute arbitrary code, whereas a per-response nonce authorises only the exact scripts you emitted',
correct: true,
why: 'Researchers have repeatedly shown that allowlists containing common CDNs are bypassable. A nonce is unguessable and regenerated per response, so injected markup cannot carry a valid one.',
},
{text: 'Nonces are faster for the browser to evaluate', why: 'Performance is not the consideration.'},
{text: 'Allowlists cannot be used with HTTPS', why: 'They work over HTTPS; the weakness is what the allowed origins themselves serve.'},
{text: 'Nonces remove the need to escape output', why: 'CSP is defence in depth. Escaping remains the actual fix.'},
]}
explanation={<>Pair the nonce with <code>'strict-dynamic'</code> so bundler-loaded scripts still work, and add <code>object-src 'none'</code> and <code>base-uri 'none'</code> — two vectors that are commonly left open.</>}
reference={{label: 'Content Security Policy', href: '/knowledge-base/security/xss#content-security-policy'}}
/>

---

## References

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
  — context-by-context escaping rules.
- [OWASP DOM-based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
  — the client-side sinks.
- [DOMPurify](https://github.com/cure53/DOMPurify) — the maintained sanitiser.
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
  — directives and reporting.
- [web.dev: Trusted Types](https://web.dev/articles/trusted-types) — eliminating
  DOM XSS by construction.
- [MDN: HTML Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API)
  — the native `setHTML()`, and its current availability.
- [The DOM](/knowledge-base/dom#security) — the same sinks from the DOM side.
