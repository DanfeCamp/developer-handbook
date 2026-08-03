---
title: 'Accessibility'
description: 'Building interfaces everyone can use — WCAG, semantic HTML, keyboard access, focus management, ARIA, forms and testing that actually finds problems.'
---

# Accessibility

## Introduction

Accessibility means people can use your interface regardless of how they
perceive, navigate or interact with it — with a screen reader, by keyboard
alone, with a magnifier, with voice control, or simply on a phone in bright
sunlight with one hand.

**Who this is for.** Roughly one in six people worldwide has a significant
disability. But permanent disability is only part of it: accessibility work also
serves temporary impairments (a broken wrist, an eye infection) and situational
ones (holding a baby, glare, a noisy train). Captions help deaf users and
everyone watching without sound.

**The legal position changed recently, and materially.** The **European
Accessibility Act became enforceable on 28 June 2025**, extending accessibility
obligations to private-sector digital services across the EU. Penalties are set
by member state and range roughly from €5,000 to €500,000. The UK Equality Act,
US ADA and Section 508 already applied. **For most commercial products this is
now a compliance requirement**, not only an ethical one.

**The most useful thing to know:** the overwhelming majority of accessibility is
using the right HTML element. Most remaining work is keyboard access and focus
management. ARIA is a small last resort, and is more often used wrongly than
usefully.

---

## WCAG

The Web Content Accessibility Guidelines are the standard everything references.

**Four principles (POUR):**

- **Perceivable** — information must be presentable in ways users can perceive.
- **Operable** — the interface must be usable, including by keyboard.
- **Understandable** — content and operation must be comprehensible.
- **Robust** — it must work with assistive technologies.

**Three levels:** A (minimum), **AA (the practical and legal target)**, AAA
(rarely required in full).

**Which version applies.** WCAG 2.2 was published in October 2023 and adds nine
success criteria, mostly around focus visibility, dragging alternatives and
target size. However, **EN 301 549 — the harmonised European standard the EAA
relies on — has not yet been updated to 2.2, so WCAG 2.1 AA remains the
operative benchmark for EAA compliance.** Build to 2.2 anyway; it is a
superset, and the next EN revision is expected to adopt it.

WCAG 3.0 is a long-term draft. It is not a target for anything shipping now.

---

## Semantic HTML

The single highest-leverage practice on this page. Native elements carry
behaviour, roles and states that you would otherwise have to reimplement — and
almost certainly reimplement incompletely.

```html
<!-- ❌ No keyboard access, no role, no focus ring, no announcement -->
<div class="btn" onclick="save()">Save</div>

<!-- ✅ All of that, free -->
<button type="button" onclick="save()">Save</button>
```

A `<button>` gives you focusability, Enter and Space activation, a focus
indicator, a role of "button" and disabled-state handling. Recreating that on a
`<div>` needs `tabindex`, `role`, `onKeyDown` for two keys, and `aria-disabled`
— and people stop after `role`.

**Use the right element:**

| Need                | Element                                              |
| ------------------- | ---------------------------------------------------- |
| Navigate somewhere  | `<a href>`                                           |
| Perform an action   | `<button>`                                           |
| Group form controls | `<fieldset>` + `<legend>`                            |
| Page regions        | `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` |
| A modal             | `<dialog>` with `showModal()`                        |
| Expandable content  | `<details>` + `<summary>`                            |
| Tabular data        | `<table>` with `<th scope>`                          |

**Headings describe structure, not size.** Screen-reader users navigate by
heading, and a page with no `<h1>` or with levels skipped is genuinely harder to
use. Style with CSS; choose the level by meaning.

**One `<main>` per page**, and a skip link so keyboard users can bypass
navigation:

```html
<a href="#main" class="skip-link">Skip to content</a>
```

---

## Keyboard Access

If it cannot be done with a keyboard, it cannot be done by a substantial number
of users — screen-reader users, people with motor impairments, and anyone whose
trackpad has failed.

**Test it yourself: unplug the mouse and complete a core flow.** This takes ten
minutes and finds more real problems than most automated tooling.

**The rules:**

- **Everything interactive must be reachable by `Tab`** and operable with
  `Enter` or `Space`.
- **Tab order follows visual order.** Positive `tabindex` values break this;
  never use them. `tabindex="0"` adds an element to the natural order,
  `tabindex="-1"` makes it focusable only programmatically.
- **The focus indicator must be visible.** Never `outline: none` without a
  replacement:

  ```css
  :focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  ```

  `:focus-visible` shows the ring for keyboard users and not on mouse click,
  which removes the usual reason people delete it.

- **No keyboard traps.** Focus must always be able to leave a component.

### Focus management

The part that trips up single-page applications.

**Modals** must move focus in on open, trap it inside, restore it on close, and
close on `Escape`. `<dialog>` with `showModal()` does all of this natively,
which is a strong argument for using it rather than a `<div>` with
`position: fixed`.

**Route changes** in an SPA do not move focus — the user tabs from wherever they
were, often into the old page's footer. Move focus to the new page heading and
announce the change:

```jsx
useEffect(() => {
  headingRef.current?.focus(); // heading has tabIndex={-1}
}, [pathname]);
```

**Deleting an element** that has focus sends focus to `<body>`, losing the
user's place. Move it somewhere sensible first — the next item, or the container.

---

## ARIA

ARIA supplies roles, states and properties that HTML lacks. It is a last resort,
and it is misused constantly.

:::warning The first rule of ARIA
**No ARIA is better than bad ARIA.** Incorrect ARIA actively breaks the
experience — it overrides what assistive technology would otherwise infer
correctly. `<div role="button">` is worse than `<button>` in every respect, and
a wrong `aria-label` silently replaces perfectly good text.
:::

**The useful patterns:**

```html
<!-- Accessible name where no visible label exists -->
<button aria-label="Close dialog"><svg aria-hidden="true">…</svg></button>

<!-- Expandable content -->
<button aria-expanded="false" aria-controls="menu">Options</button>
<ul id="menu" hidden>…</ul>

<!-- Current page in navigation -->
<a href="/orders" aria-current="page">Orders</a>

<!-- Decorative image or icon: hide it from the accessibility tree -->
<svg aria-hidden="true" focusable="false">…</svg>

<!-- Announce dynamic changes -->
<div role="status" aria-live="polite">3 results found</div>
<div role="alert">Payment failed</div>
```

**Live regions** are how a screen-reader user learns that something changed
without their focus moving. `polite` waits for a pause; `alert` interrupts. The
element must exist in the DOM before the content changes — inserting a populated
live region announces nothing.

**`aria-hidden="true"` on decorative icons** prevents meaningless
announcements, and must never be applied to anything focusable.

---

## Forms

Where accessibility failures are most costly, because a broken form blocks the
transaction.

```html
<div>
  <label for="email">Email address</label>
  <input
    id="email"
    name="email"
    type="email"
    autocomplete="email"
    required
    aria-describedby="email-hint email-error"
    aria-invalid="true"
  />
  <p id="email-hint">We will only use this for order updates.</p>
  <p id="email-error" role="alert">Enter a valid email address</p>
</div>
```

- **Every input needs a `<label>`** associated by `for`/`id`. A placeholder is
  not a label: it disappears on typing, fails contrast requirements, and is not
  reliably announced.
- **`autocomplete` attributes** let browsers and password managers fill fields —
  a WCAG 2.1 requirement (1.3.5) and a genuine usability win.
- **Errors must be associated** with their field via `aria-describedby`, and
  `aria-invalid` set. Colour alone is never sufficient.
- **Group related controls** with `<fieldset>` and `<legend>` — essential for
  radio groups.
- **Announce errors on submit** and move focus to the first invalid field or an
  error summary.
- **Do not disable the submit button** until the form is valid; the user gets no
  explanation of what is wrong.

---

## Visual Design

**Contrast** (WCAG AA):

| Content                            | Minimum ratio |
| ---------------------------------- | ------------- |
| Normal text                        | **4.5 : 1**   |
| Large text (18.66 px bold / 24 px) | **3 : 1**     |
| UI components and graphics         | **3 : 1**     |

Check with DevTools' colour picker or the WebAIM contrast checker. Placeholder
text and disabled controls are the usual failures.

**Never use colour alone** to convey meaning. A red border needs an icon or text
as well — around 8 % of men have some colour vision deficiency.

**Support 200 % zoom and 400 % reflow** without horizontal scrolling. Relative
units and a responsive layout handle this; fixed pixel heights do not.

**Target size** — WCAG 2.2 requires interactive targets of at least 24×24 CSS
pixels (2.5.8), with exceptions for inline links. 44×44 is the comfortable
mobile target.

**Respect motion preferences:**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Vestibular disorders make parallax and large motion genuinely unpleasant, and
sometimes physically uncomfortable.

---

## Testing

**Automated tools catch roughly 30–40 % of issues.** They are necessary and
nowhere near sufficient — they can detect a missing `alt`, not whether the alt
text is meaningful.

```bash
npm install -D @axe-core/playwright eslint-plugin-jsx-a11y
```

```ts
import AxeBuilder from '@axe-core/playwright';

test('checkout has no detectable accessibility violations', async ({page}) => {
  await page.goto('/checkout');
  const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
```

**Manual testing is where the real findings are:**

- **Keyboard only.** Unplug the mouse; complete a purchase.
- **Screen reader.** VoiceOver (macOS/iOS, built in), NVDA (Windows, free),
  TalkBack (Android). An hour with one is more educational than any article.
- **Zoom to 200 % and 400 %.**
- **Reduce motion**, and check nothing becomes unusable.

**Query by role in component tests.** This is the highest-value habit, because
it makes accessibility a by-product of testing:

```ts
screen.getByRole('button', {name: /place order/i});
```

A test that finds elements the way a screen reader does fails when the markup
stops being accessible. See [Testing](/knowledge-base/testing).

---

## Common Mistakes

**`<div>` with an `onClick`.** No keyboard access, no role, no focus ring. The
commonest failure by a wide margin.

**Removing focus outlines.** `outline: none` for aesthetics, with no
replacement. Use `:focus-visible`.

**Placeholder as label.** Disappears on typing, poor contrast, unreliable
announcement.

**Icon buttons with no accessible name.** A screen reader announces "button" and
nothing else.

**Skipped heading levels.** `<h1>` then `<h3>` because it looked right.

**Colour as the only signal.** Red-bordered fields with no text or icon.

**ARIA applied to fix a symptom.** Adding `role="button"` to a `<div>` rather
than using a `<button>`; adding `aria-label` that contradicts visible text.

**Auto-playing carousels** that cannot be paused.

**`tabindex` above zero.** Breaks the natural order in ways that are very hard
to reason about.

**Accessibility overlays.** Widgets promising one-line compliance do not deliver
it, are [widely opposed by disabled users](https://overlayfactsheet.com/), and
have featured in litigation. Fix the markup.

---

## Debugging

| Symptom                               | Cause and fix                                                 |
| ------------------------------------- | ------------------------------------------------------------- |
| Element unreachable by keyboard       | Not a native interactive element and no `tabindex="0"`.       |
| Screen reader announces "button" only | No accessible name. Add `aria-label` or visible text.         |
| Focus disappears after an action      | The focused element was removed. Move focus deliberately.     |
| Modal lets you tab to the page behind | No focus trap. Use `<dialog>` with `showModal()`.             |
| Dynamic update not announced          | No live region, or it was inserted already populated.         |
| Focus ring invisible                  | `outline: none` without a `:focus-visible` replacement.       |
| Form errors not announced             | Not associated with `aria-describedby`, or no `role="alert"`. |
| axe passes but users struggle         | Expected — automation catches a minority. Test manually.      |

**Use the accessibility tree**, not the DOM, when debugging: Chrome DevTools →
Elements → Accessibility pane shows the computed name, role and state, which is
what assistive technology actually receives.

---

## Do's and Don'ts

### Do

- Use the correct semantic element before anything else.
- Test with the keyboard on every feature.
- Use `:focus-visible` for a visible focus indicator.
- Label every form field, and associate errors with `aria-describedby`.
- Provide meaningful `alt` text; `alt=""` for decorative images.
- Meet 4.5:1 contrast for body text.
- Announce dynamic changes with a live region.
- Respect `prefers-reduced-motion`.
- Query by role in tests.

### Don't

- Don't use `<div>` for buttons or links.
- Don't remove focus outlines without a replacement.
- Don't use a placeholder as a label.
- Don't rely on colour alone.
- Don't use positive `tabindex`.
- Don't add ARIA where HTML already does the job.
- Don't apply `aria-hidden` to focusable elements.
- Don't ship an accessibility overlay instead of fixing the markup.
- Don't treat an automated pass as compliance.

---

## FAQ

**Where do I start on an existing site?**
Keyboard-test the primary flow, run axe, and fix in this order: missing labels,
`div`-as-button, focus indicators, contrast. Those four cover a large share of
real findings.

**Is WCAG 2.1 or 2.2 the target?**
Build to 2.2 — it is a superset. For EU compliance specifically, EN 301 549
still references 2.1 AA, so that is the current legal benchmark.

**How much does the EAA actually apply to me?**
If you sell digital products or services to EU consumers, it very likely does,
since 28 June 2025. Micro-enterprises have some exemptions. Take legal advice
rather than a blog post.

**Do automated tools mean I am compliant?**
No. They catch roughly a third of issues and cannot judge whether alt text is
meaningful or whether a flow is usable.

**Does accessibility conflict with good design?**
No. Constraints — contrast, target size, focus visibility, clear labelling —
improve interfaces for everyone. Captions and larger touch targets are used far
more by non-disabled users than by disabled ones.

**Do I need to support very old screen readers?**
Target current versions of NVDA, JAWS and VoiceOver. Semantic HTML degrades
better than ARIA-heavy markup on anything older.

---

## Check your understanding

<Quiz
question="A design system implements its button as a div with an onClick handler, rather than a native button element. What is lost?"
options={[
{
text: 'Focusability, Enter/Space activation, the implicit button role, the focus indicator and disabled-state handling — all of which must otherwise be reimplemented',
correct: true,
why: 'A native button supplies all of that. Recreating it needs tabindex, role, an onKeyDown handling two keys, and aria-disabled — and most implementations stop after role.',
},
{text: 'Nothing, provided role="button" is added', why: 'role fixes the announcement only. The element is still not focusable and still does not respond to Enter or Space.'},
{text: 'Only the default browser styling', why: 'Styling is the one thing you were going to override anyway; the behaviour is what matters.'},
{text: 'Only screen reader support', why: 'Keyboard users without a screen reader are equally blocked.'},
]}
explanation={<>This is the single most common accessibility failure. The general principle: native elements carry behaviour you would otherwise reimplement incompletely.</>}
reference={{label: 'Semantic HTML', href: '/knowledge-base/web/accessibility#semantic-html'}}
/>

<Quiz
question="An SPA changes route on click. Screen reader users report being lost. Why?"
options={[
{
text: 'A client-side route change does not move focus or announce the new page, so the user continues from wherever they were in the old document',
correct: true,
why: 'Unlike a full page load, an SPA navigation leaves focus in place and produces no announcement. Move focus to the new page heading and announce the change in a live region.',
},
{text: 'Screen readers do not support single-page applications', why: 'They support them fine; the application has to manage focus, which a browser navigation would have done for it.'},
{text: 'The router needs to force a full page reload', why: 'That works by accident and discards the benefit of client-side routing. Managing focus is the correct fix.'},
{text: 'aria-live must be set on the router element', why: 'A live region can announce the change, and focus still needs moving so the user’s position is correct.'},
]}
explanation={<>Give the page heading <code>tabIndex=&#123;-1&#125;</code> and focus it on navigation. The same reasoning applies when deleting a focused element — send focus somewhere deliberate rather than letting it fall to <code>body</code>.</>}
reference={{label: 'Focus management', href: '/knowledge-base/web/accessibility#focus-management'}}
/>

<Quiz
question="Which statements about ARIA are correct?"
type="multiple"
options={[
{text: 'No ARIA is better than bad ARIA', correct: true, why: 'Incorrect ARIA overrides what assistive technology would otherwise infer correctly, actively degrading the experience.'},
{text: 'aria-hidden="true" must never be applied to a focusable element', correct: true, why: 'It creates an element a keyboard user can reach but a screen reader cannot describe.'},
{text: 'A live region must exist in the DOM before its content changes', correct: true, why: 'Inserting an already-populated live region announces nothing — the change has to happen inside an existing region.'},
{text: 'aria-label overrides visible text for screen reader users', correct: true, why: 'Which is why a mismatched label is harmful: it silently replaces text the user can see.'},
{text: 'role="button" on a div makes it fully keyboard accessible', why: 'It fixes the announced role only. Focusability and Enter/Space activation still have to be added by hand.'},
]}
explanation={<>ARIA supplies semantics HTML lacks — expanded state, live regions, current page. It never supplies <em>behaviour</em>, which is why it cannot rescue a non-semantic element.</>}
reference={{label: 'ARIA', href: '/knowledge-base/web/accessibility#aria'}}
/>

<Quiz
question="A form uses placeholders instead of labels to keep the design clean. What are the problems?"
options={[
{
text: 'The placeholder disappears once the user types, typically fails contrast requirements, and is not reliably announced as the field name',
correct: true,
why: 'Users who are interrupted lose the only indication of what the field is for. Placeholder text is also usually low-contrast by default, and assistive technology treats it inconsistently.',
},
{text: 'No problem, provided the placeholder text is descriptive', why: 'Descriptiveness does not help once it has vanished, and it does not fix contrast or announcement.'},
{text: 'Only a problem for screen reader users', why: 'Losing the field name on typing affects everyone, particularly anyone distracted mid-form.'},
{text: 'Only a problem if the form has more than one field', why: 'A single unlabelled field is equally ambiguous.'},
]}
explanation={<>Use a visible <code>&lt;label for&gt;</code> and keep the placeholder for a format example if you want one. Add <code>autocomplete</code> so browsers and password managers can fill the field — a WCAG 2.1 requirement in its own right.</>}
reference={{label: 'Forms', href: '/knowledge-base/web/accessibility#forms'}}
/>

<Quiz
question="A team runs axe on every page in CI with zero violations and declares the product accessible. What is wrong with that conclusion?"
options={[
{
text: 'Automated tools detect roughly 30–40% of issues — they can find a missing alt attribute but not whether the alt text is meaningful, or whether a flow is completable by keyboard',
correct: true,
why: 'Automation checks what is machine-verifiable. Judgement calls — meaningful names, logical focus order, whether a task can actually be completed — require manual testing.',
},
{text: 'axe only checks WCAG level A', why: 'It can be configured for AA and beyond. The limitation is the class of problem, not the level.'},
{text: 'Nothing — zero violations means compliance', why: 'No automated tool vendor makes that claim, and neither does WCAG.'},
{text: 'They should run it in production rather than CI', why: 'Where it runs does not change what it can detect.'},
]}
explanation={<>Keep the automated gate — it catches regressions cheaply — and add keyboard-only testing of core flows plus periodic screen-reader testing. An hour with VoiceOver or NVDA finds things no scanner will.</>}
reference={{label: 'Testing', href: '/knowledge-base/web/accessibility#testing'}}
/>

---

## References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — the normative guidelines.
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — correct
  patterns for widgets HTML does not provide.
- [MDN: Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
  — practical reference.
- [The A11y Project checklist](https://www.a11yproject.com/checklist/) — a
  readable, actionable version of WCAG.
- [WebAIM contrast checker](https://webaim.org/resources/contrastchecker/) and
  [WebAIM screen reader survey](https://webaim.org/projects/screenreadersurvey/)
  — what real users actually use.
- [axe DevTools](https://www.deque.com/axe/devtools/) — the standard automated
  scanner.
- [European Accessibility Act](https://ec.europa.eu/social/main.jsp?catId=1202)
  — scope and obligations.
- [Overlay Fact Sheet](https://overlayfactsheet.com/) — why overlay widgets are
  not a solution.
