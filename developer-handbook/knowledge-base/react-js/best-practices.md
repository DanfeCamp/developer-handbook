---
id: best-practices
title: Best Practices
description: Production practices for React 19 — structure, data fetching, performance, forms, accessibility, testing and security.
---

# Best Practices

## Introduction

The practices below are the ones that hold up in applications maintained by
several people over several years. They are grouped by what they protect:
correctness first, then performance, then the things that are easy to skip and
expensive to retrofit — accessibility, testing and security.

Everything here assumes **React 19.2** and function components. Where React
Compiler changes the advice, that is called out.

---

## Structure

**Organise by feature, not by file type.** A `components/` directory with 200
alphabetised files tells you nothing about the application; a `features/checkout/`
directory tells you everything. Full layout in
[Component Design](/knowledge-base/react-js/component-design#file-and-folder-organisation).

**Colocate.** Tests, styles and types live beside the component they belong to.
The further a test is from its subject, the more likely it is to rot.

**Keep components pure.** No mutation of props, no writing to module scope
during render, no DOM access, no fetching. This is what makes Strict Mode,
concurrent rendering and the React Compiler work.

**Use TypeScript.** PropTypes were removed in React 19, and typed props are the
cheapest correctness win available. `strict: true` from day one — retrofitting it
is painful.

---

## Data Fetching

**Do not fetch in `useEffect` if you can avoid it.** Getting it right requires
an abort controller, loading state, error state, and race handling in every
component. Solve it once instead:

| Situation                            | Use                                  |
| ------------------------------------ | ------------------------------------ |
| Framework with server rendering      | Server Components, or a route loader |
| Client-side app                      | TanStack Query or SWR                |
| Genuinely one-off, no caching needed | `useEffect` with `AbortController`   |

```jsx
// A server-cache library handles caching, deduplication, revalidation,
// retries and race conditions — all of which you would otherwise hand-write.
function OrderList() {
  const {data, isPending, error} = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
  });

  if (isPending) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  return <List items={data} />;
}
```

**Separate server state from client state.** Server state is a cache of
something you do not own and that can go stale. Client state is UI that only
this browser knows about. Conflating them is the root of most state-management
confusion — see
[State Management](/knowledge-base/react-js/state-management).

**Handle all four states.** Loading, error, empty and success. The empty state
is the one teams forget, and it is the one users see on their first day.

---

## State

**Put state as low as it can go**, and lift it only when a second component
needs it. State in a large parent re-renders that parent for something it does
not use.

**Do not duplicate what you can derive.** Anything computable from props or
other state should be computed during render. Stored copies drift.

**Use the URL for shareable state** — filters, tabs, pagination, search. If
pressing Back or sharing a link should reproduce the view, the state belongs in
the URL.

**Reach for `useReducer`** when several pieces of state change together, or when
transitions have rules. A reducer makes the state machine explicit and testable
in isolation.

**Split contexts by update frequency.** One context holding
`{user, theme, cart}` re-renders every consumer whenever the cart changes.

---

## Performance

**Measure before optimising.** React DevTools Profiler shows what actually
rendered and why. Most perceived slowness is bundle size, waterfall requests or
too many DOM nodes — not React.

**With React Compiler enabled, stop memoising by hand.** `useMemo`,
`useCallback` and `React.memo` become redundant noise. Without the compiler, use
them where they pay: an expensive computation, or a value passed to a memoised
child.

**Virtualise long lists.** Ten thousand rows means ten thousand DOM nodes.
TanStack Virtual or `react-window` render only what is visible. This matters far
more than any memoisation.

**Code-split at route boundaries.**

```jsx
const Settings = lazy(() => import('./features/settings/Settings'));

<Suspense fallback={<PageSkeleton />}>
  <Settings />
</Suspense>;
```

**Keep input responsive with transitions.** Mark an expensive update non-urgent
so typing stays smooth:

```jsx
const [isPending, startTransition] = useTransition();

function handleSearch(value) {
  setQuery(value); // urgent — the input updates immediately
  startTransition(() => setResults(search(value))); // can be interrupted
}
```

**Stabilise references passed as props.** A new object or arrow function each
render defeats memoisation downstream — again, unless the compiler is doing it
for you.

**Set explicit dimensions on images and embeds** so the layout does not shift as
they load. See [Performance](/knowledge-base/web/performance).

---

## Forms

**Prefer uncontrolled inputs and `FormData`** for straightforward forms. Fewer
re-renders, less code:

```jsx
function ContactForm({onSubmit}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required />
      <button>Send</button>
    </form>
  );
}
```

**Use Actions for async submission.** React 19's `useActionState` handles
pending state and results without a `isSubmitting` flag of your own:

```jsx
const [state, formAction, isPending] = useActionState(submitOrder, null);

<form action={formAction}>
  <input name="quantity" type="number" />
  <button disabled={isPending}>{isPending ? 'Placing…' : 'Place order'}</button>
  {state?.error && <p role="alert">{state.error}</p>}
</form>;
```

**Reach for a form library** — React Hook Form, TanStack Form — once you need
per-field validation, dependent fields or complex arrays. Below that threshold
it is overhead.

**Validate on the server regardless.** Client validation is a convenience for
users, never a security control.

---

## Accessibility

Retrofitting accessibility is far more expensive than building it in, and most
of it is just using the right element.

- **Use semantic HTML.** `<button>` for actions, `<a>` for navigation. A `<div>`
  with an `onClick` has no keyboard access, no focus ring and no role.
- **Label every input.** A `<label htmlFor>` paired with an `id`, or an
  `aria-label` where no visible label exists.
- **Manage focus.** When a modal opens, move focus into it; when it closes,
  return focus to what opened it. `<dialog>` with `showModal()` does this for
  you — see [the DOM page](/knowledge-base/dom#dialogs-and-popovers).
- **Announce dynamic changes.** `role="alert"` or `aria-live` so screen-reader
  users learn about errors and updates.
- **Never remove focus outlines** without providing a visible replacement.
- **Test with the keyboard.** Tab through every flow. If you cannot complete it,
  neither can a significant number of users.

`eslint-plugin-jsx-a11y` catches a useful proportion of this at authoring time,
and `@axe-core/react` catches more at runtime. See
[Accessibility](/knowledge-base/web/accessibility).

---

## Testing

**Test behaviour through the DOM, not implementation.** Render the component,
interact the way a user would, assert on what appears.

```jsx
test('shows a validation error when email is empty', async () => {
  const user = userEvent.setup();
  render(<ContactForm onSubmit={vi.fn()} />);

  await user.click(screen.getByRole('button', {name: /send/i}));

  expect(await screen.findByText(/email is required/i)).toBeVisible();
});
```

- **Query by role and accessible name.** A test that finds elements the way a
  screen reader does is also asserting that the markup is accessible.
- **Prefer integration over unit tests** for components. Rendering a component
  with its real children catches far more than testing helpers in isolation.
- **Mock at the network boundary** with MSW, not by stubbing your own modules.
- **Do not assert on state or props directly.** They are implementation.

Full strategy in [Testing](/knowledge-base/testing).

---

## Security

React escapes interpolated values, which prevents the most common XSS. The gaps
are the places where you opt out of that:

- **`dangerouslySetInnerHTML` is a genuine sink.** Sanitise with DOMPurify or
  the native Sanitizer API before it goes anywhere near a component.
- **Validate URLs before putting them in `href` or `src`.** A `javascript:` URL
  executes on click. Allowlist the scheme.
- **Never put secrets in client code.** Anything in the bundle is public,
  including every `NEXT_PUBLIC_`/`VITE_` environment variable.
- **Validate at the boundary.** `await res.json() as User` is an assertion, not a
  check. Parse with Zod or equivalent.
- **Keep React patched.** 19.0.0–19.2.0 were affected by _React2Shell_; 19.2.1
  fixed it.

See [XSS](/knowledge-base/security/xss).

---

## Tooling

```json title="package.json"
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "validate": "npm run typecheck && npm run lint && npm run test"
  }
}
```

- **`eslint-plugin-react-hooks`** with the React Compiler rules enabled. Its
  warnings are not style opinions — they mark code the compiler will skip.
- **`eslint-plugin-jsx-a11y`** for accessibility.
- **Prettier** so nobody reviews formatting.
- **An error tracker** with source maps uploaded, so production stack traces
  point at your source.
- **Keep Strict Mode on.** The double-render in development surfaces impurity
  before it becomes a production bug.

---

## Do's and Don'ts

### Do

- Organise by feature and colocate tests and styles.
- Use TypeScript with `strict: true`.
- Fetch with Server Components or a server-cache library.
- Handle loading, error, empty and success states.
- Keep state low; use the URL for shareable state.
- Virtualise long lists and code-split routes.
- Use semantic HTML and query by role in tests.
- Sanitise anything passed to `dangerouslySetInnerHTML`.

### Don't

- Don't hand-write `useMemo`/`useCallback` when the compiler is enabled.
- Don't fetch in `useEffect` when a better mechanism exists.
- Don't store what you can derive.
- Don't put everything in one context.
- Don't use the array index as a key in a list that can change.
- Don't write new class components, HOCs or `forwardRef`.
- Don't use PropTypes — removed in React 19.
- Don't disable Strict Mode to silence double-render warnings.

---

## FAQ

**Is this different from what I learned for React 18?**
Mostly it is the same advice with two shifts: manual memoisation is obsolete
with the compiler, and data fetching has moved out of components into Server
Components and cache libraries.

**Do I need a state management library?**
Usually not. Server-cache library plus `useState` plus URL state covers most
applications. Add a small store (Zustand, Jotai) for genuinely global client
state.

**CSS-in-JS, Tailwind, or CSS Modules?**
CSS Modules or Tailwind for new work. Runtime CSS-in-JS has a real cost and
works poorly with Server Components; if you want the authoring style, use a
zero-runtime library.

**Server Components everywhere?**
Server-render by default and add `'use client'` at the leaves that need
interactivity. See
[Rendering & SSR](/knowledge-base/next-js/server-side-rendering).

**How do I keep bundle size down?**
Route-level code splitting, tree-shakeable imports, and checking what you added
before adding it. Measure with `rollup-plugin-visualizer` or the Next.js bundle
analyzer.

---

## Check your understanding

<Quiz
question="Your team enables React Compiler. A reviewer asks whether to keep the existing useMemo and useCallback calls. What is the right answer?"
options={[
{
text: 'Remove them as you touch the code, and focus review effort on Rules-of-React violations instead',
correct: true,
why: 'The compiler applies memoisation automatically, so hand-written memoisation is redundant. What matters now is purity, because the compiler silently skips components that break the rules.',
},
{
text: 'Keep them all — belt and braces is safer',
why: 'They are dead weight that obscures the code, and maintaining dependency arrays reintroduces exactly the bugs the compiler removes.',
},
{
text: 'Remove them all in one large refactor before enabling the compiler',
why: 'Unnecessary churn and risk. The compiler works fine alongside existing memoisation; clean up incrementally.',
},
{
text: 'Keep useCallback but remove useMemo',
why: 'No principled basis for the distinction — the compiler handles both.',
},
]}
explanation={<>Enable the compiler's ESLint rules first. Anything they flag is a component the compiler will not optimise, which makes those warnings genuinely actionable rather than stylistic.</>}
reference={{label: 'Performance', href: '/knowledge-base/react-js/best-practices#performance'}}
/>

<Quiz
question="A product list renders 8,000 rows and scrolling is janky. Each row is memoised and the render function is cheap. What is the highest-impact fix?"
options={[
{
text: 'Virtualise the list so only visible rows are in the DOM',
correct: true,
why: '8,000 rows means 8,000 DOM nodes for the browser to lay out, paint and composite. Memoisation prevents unnecessary React work but does nothing about the size of the DOM.',
},
{text: 'Wrap the list in a transition', why: 'Transitions help keep input responsive during an expensive update; they do not reduce the cost of rendering 8,000 nodes.'},
{text: 'Add React.memo to the list container', why: 'The rows are already memoised. The problem is not React re-rendering, it is the DOM size.'},
{text: 'Move the list into a Server Component', why: 'It would still produce 8,000 nodes in the browser. Server rendering moves the work, not the node count.'},
]}
explanation={<>A good diagnostic: if the DevTools Profiler shows short render times but the page still stutters, the bottleneck is in the browser, not in React.</>}
reference={{label: 'Performance', href: '/knowledge-base/react-js/best-practices#performance'}}
/>

<Quiz
question="Which of these are appropriate ways to handle data fetching in a React application in 2026?"
type="multiple"
options={[
{text: 'Fetch in a Server Component and pass the result down as props', correct: true, why: 'The request never reaches the browser, no loading state is needed, and no client JavaScript ships for it.'},
{text: 'Use TanStack Query or SWR in a client-side app', correct: true, why: 'Caching, deduplication, revalidation, retries and race handling solved once, in a library.'},
{text: 'useEffect with an AbortController for a genuinely one-off request', correct: true, why: 'Still legitimate when there is nothing to cache and no framework mechanism available.'},
{text: 'Fetch during render so the data is available immediately', why: 'Breaks purity and fires on every render. React may render a component several times or abandon a render entirely.'},
{text: 'Fetch in a useEffect with no cleanup, and let the last response win', why: 'Precisely the race condition that produces stale data when users click quickly.'},
]}
explanation={<>The trend is that fetching is moving <em>out</em> of components — up to the server, or sideways into a cache library — because doing it correctly per component is repetitive and easy to get wrong.</>}
reference={{label: 'Data fetching', href: '/knowledge-base/react-js/best-practices#data-fetching'}}
/>

<Quiz
question="A code review flags `<div onClick={handleDelete}>Delete</div>`. Why does it matter beyond style?"
options={[
{
text: 'A div is not focusable, is not announced as a control, and cannot be activated with the keyboard — so keyboard and screen-reader users cannot delete anything',
correct: true,
why: 'A button gets focusability, Enter/Space activation, a role and a focus ring for free. A div has none of them, so the feature is simply unavailable to some users.',
},
{
text: 'React handles onClick less efficiently on a div',
why: 'Event handling is identical. The difference is semantics and built-in behaviour.',
},
{
text: 'It only matters if the site must meet WCAG',
why: 'The users exist whether or not you are audited. WCAG describes the problem; it does not create it.',
},
{
text: 'Adding role="button" fully resolves it',
why: 'role fixes the announcement but not focusability or keyboard activation — you would also need tabIndex and an onKeyDown handler. Using a button is simpler and correct.',
},
]}
explanation={<>Almost all of accessibility at the component level is using the element that already has the behaviour. <code>eslint-plugin-jsx-a11y</code> catches this specific case automatically.</>}
reference={{label: 'Accessibility', href: '/knowledge-base/react-js/best-practices#accessibility'}}
/>

<Quiz
question="A component renders CMS content with dangerouslySetInnerHTML. Which mitigation actually prevents XSS?"
options={[
{
text: 'Sanitise the HTML with DOMPurify (or the native Sanitizer API) immediately before rendering it',
correct: true,
why: 'Sanitising at the point of output removes scripts and event-handler attributes. Sanitising on output rather than input also survives a second write path being added later.',
},
{
text: 'Trust it because the CMS is behind authentication',
why: 'That reduces who can inject, not whether injection executes. Compromised or malicious authors are a real threat model.',
},
{
text: 'Escape the string with encodeURIComponent first',
why: 'URI encoding is for URLs. It mangles the HTML and does not make it safe.',
},
{
text: 'Set a Content Security Policy and keep the raw HTML',
why: 'CSP is valuable defence in depth and can block inline scripts, but it is not a substitute for sanitising the input.',
},
]}
explanation={<>React escapes normal interpolation, so the only XSS sinks in a React app are the ones where you deliberately opt out — <code>dangerouslySetInnerHTML</code> and unvalidated URLs in <code>href</code>/<code>src</code>.</>}
reference={{label: 'Security', href: '/knowledge-base/react-js/best-practices#security'}}
/>

---

## References

- [Rules of React](https://react.dev/reference/rules) — the constraints the
  compiler and concurrent rendering depend on.
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
  — derived state and event handling.
- [React Compiler](https://react.dev/learn/react-compiler) — what it memoises,
  and when it bails out.
- [TanStack Query](https://tanstack.com/query/latest) — server state, done once.
- [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles)
  — why queries are ordered by accessibility.
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — correct
  patterns for widgets that HTML does not provide.
