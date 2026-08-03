---
title: React
description: Component design, state management, best practices and the mistakes teams make most often — current as of React 19.2 and React Compiler 1.0.
---

# React

## Introduction

React is a library for building user interfaces from **components**: functions
that take data and return a description of what should be on screen. React keeps
the real DOM in step with those descriptions as the data changes.

**The problem it solves** is synchronising state and UI. Before React, updating
an interface meant finding the affected DOM nodes and mutating them by hand,
which is where the bugs lived — a piece of state changed in one place and three
views forgot to update. React inverts it: you describe what the UI _should_ look
like for the current state, and the library works out the minimum set of DOM
operations to get there.

That single idea — **UI as a function of state** — is what makes React
predictable. To change the screen, change the state.

**React is not a framework.** It renders components and manages state. Routing,
data fetching, forms and builds are chosen separately, or handed to a framework
like [Next.js](/knowledge-base/next-js) that packages those decisions.

:::note Versions
Written against **React 19.2.8** (July 2026) and **React Compiler 1.0** (stable
since October 2025). There is no React 20.

**Security:** React 19.0.0 through 19.2.0 were affected by the _React2Shell_
vulnerability, fixed in 19.2.1. If you are on 19.2.0 or earlier, upgrade before
reading anything else on this page.
:::

---

## The Mental Model

### Components and props

A component is a function returning JSX. Props are its arguments — read-only,
flowing one way, from parent to child.

```jsx
function Greeting({name, children}) {
  return (
    <section>
      <h2>Hello, {name}</h2>
      {children}
    </section>
  );
}

<Greeting name="Ada">
  <p>Welcome back.</p>
</Greeting>;
```

**Never mutate props.** They belong to the caller. If a child needs to change
something, the parent passes a callback.

### Rendering is not painting

Three distinct things happen, and conflating them makes performance discussions
incoherent:

1. **Render** — React calls your component function to get a description of the
   UI. Cheap, pure, happens often.
2. **Reconcile** — React compares that description with the previous one.
3. **Commit** — React applies the differences to the real DOM. This is the only
   step the user can see.

A component re-rendering does **not** mean the DOM changed. If the output is
identical, the commit does nothing. This is why "reduce re-renders" is usually
the wrong optimisation target — expensive _work inside_ a render is the real
cost.

### State and the update model

```jsx
const [count, setCount] = useState(0);
```

Two rules explain nearly every state bug:

**State updates are asynchronous and batched.** Calling `setCount` does not
change `count` immediately; it schedules a re-render. Reading `count` on the
next line gives the old value.

```jsx
// ❌ Both calls read the same stale value; increments by 1.
setCount(count + 1);
setCount(count + 1);

// ✅ The updater form receives the latest pending value; increments by 2.
setCount((c) => c + 1);
setCount((c) => c + 1);
```

**State is compared by identity.** Mutating an object or array in place gives
React the same reference, so it concludes nothing changed and skips the
re-render:

```jsx
// ❌ Same array reference — no re-render.
items.push(newItem);
setItems(items);

// ✅ New reference.
setItems([...items, newItem]);
```

For where state should _live_ — local, lifted, context, URL, server cache or a
store — see [State Management](/knowledge-base/react-js/state-management).

### Purity

A component must return the same output for the same props and state, and must
not change anything outside itself while rendering. No mutating props, no
writing to variables declared outside, no DOM access, no fetching.

This is not a style preference. React relies on it: Strict Mode deliberately
double-invokes your components in development to surface impurity, and
concurrent rendering may start a render, abandon it, and start again.

Side effects belong in event handlers (for things caused by a user) or in
`useEffect` (for synchronising with something outside React).

### Keys

When rendering a list, `key` tells React which item is which across renders.

```jsx
{
  todos.map((todo) => <TodoItem key={todo.id} todo={todo} />);
}
```

**Use a stable id from the data.** Using the array index means that inserting or
reordering makes React match up the wrong elements — state, focus and input
values attach to the wrong rows. It is safe only for a list that never reorders,
never filters and never has items inserted, which in practice means "not this
list".

---

## Hooks

The rules, which the linter enforces: **call hooks at the top level of a
component or another hook, never inside a condition, loop or nested function.**
React identifies hooks by call order.

| Hook                      | Use for                                                |
| ------------------------- | ------------------------------------------------------ |
| `useState`                | Local component state                                  |
| `useReducer`              | State with several related transitions                 |
| `useEffect`               | Synchronising with something outside React             |
| `useRef`                  | A mutable value that does not re-render; DOM access    |
| `useContext`              | Reading a context value                                |
| `useMemo` / `useCallback` | Manual memoisation (see the Compiler note below)       |
| `useTransition`           | Marking an update non-urgent so input stays responsive |
| `useDeferredValue`        | Letting an expensive view lag behind a fast input      |
| `useOptimistic`           | Showing a result before the server confirms it         |
| `useActionState`          | Form state driven by an async action                   |
| `useId`                   | Stable ids for accessibility attributes                |
| `useSyncExternalStore`    | Subscribing to a store outside React                   |

### useEffect is not "run on change"

The most misused hook in React. An Effect exists to **synchronise with an
external system** — a subscription, a browser API, a non-React widget. It is not
a lifecycle hook, and it is not where derived data belongs.

```jsx
// ❌ Derived state in an Effect: an extra render, and a chance to go stale.
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${first} ${last}`);
}, [first, last]);

// ✅ Just compute it.
const fullName = `${first} ${last}`;
```

```jsx
// ✅ A real Effect: synchronising with something outside React.
useEffect(() => {
  const controller = new AbortController();
  window.addEventListener('resize', onResize, {signal: controller.signal});
  return () => controller.abort(); // cleanup runs on unmount and before re-runs
}, []);
```

Before writing an Effect, ask: can this be computed during render, or handled in
an event handler? Usually yes.

### React 19 additions worth knowing

**`ref` is a regular prop.** `forwardRef` is legacy — a function component can
accept `ref` directly.

```jsx
function Input({ref, ...props}) {
  return <input ref={ref} {...props} />;
}
```

**Actions** connect forms to async functions, with pending state handled for
you:

```jsx
function UpdateName() {
  const [state, submitAction, isPending] = useActionState(
    async (previous, formData) => {
      const error = await updateName(formData.get('name'));
      return error ? {error} : {error: null};
    },
    {error: null},
  );

  return (
    <form action={submitAction}>
      <input name="name" />
      <button disabled={isPending}>Save</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

**`use()`** reads a promise or context, and can be called conditionally — the one
exception to the hook rules, because it is not a hook.

**Document metadata** (`<title>`, `<meta>`, `<link>`) rendered anywhere in the
tree is hoisted to `<head>` automatically.

### The React Compiler

React Compiler 1.0 shipped in October 2025 and is production-ready. It
automatically memoises components and hook results, which means **you should
stop writing `useMemo`, `useCallback` and `React.memo` by hand** in a compiled
codebase.

```bash
npm install -D babel-plugin-react-compiler
```

It only works on code that follows the Rules of React — which is the real
argument for purity. Run `eslint-plugin-react-hooks` with the compiler rules
enabled; anything it flags is code the compiler will skip.

New projects on Next.js, Vite and Expo can enable it at setup. Note that with
Vite 8 and `@vitejs/plugin-react` v6, Babel is no longer bundled, so you also
need `@rolldown/plugin-babel`.

---

## Setup

React is a library, so you choose a build setup:

```bash
# Vite — the default for a client-rendered single-page app
npm create vite@latest my-app -- --template react-ts

# Next.js — a framework: routing, server rendering, data fetching included
npx create-next-app@latest my-app
```

**Create React App is deprecated** and should not be used for anything new. If
you meet it in an existing project, migrating to Vite is usually a day's work.

Choose **Next.js** when you need server rendering, SEO, or a backend in the same
project. Choose **Vite** for a dashboard, an internal tool, or anything behind a
login where SEO is irrelevant.

```jsx title="src/main.tsx"
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Keep **Strict Mode** on. The double-rendering in development is deliberate: it
surfaces impure components and missing Effect cleanup before they become
production bugs.

---

## What is in this section

```mdx-code-block
import DocCardList from '@theme/DocCardList';
import {useCurrentSidebarCategory} from '@docusaurus/theme-common';

<DocCardList items={useCurrentSidebarCategory().items} />
```

- **[Component Design](/knowledge-base/react-js/component-design)** — splitting
  components, composition over configuration, and the patterns worth knowing.
- **[State Management](/knowledge-base/react-js/state-management)** — a decision
  tree for where state belongs.
- **[Best Practices](/knowledge-base/react-js/best-practices)** — production
  practices for React 19.
- **[Common Mistakes](/knowledge-base/react-js/common-mistakes)** — what goes
  wrong most often, and why.

---

## Check your understanding

<Quiz
question="What does this log, and why?"
options={[
{
text: '0 — setCount schedules a re-render; it does not reassign the current count variable',
correct: true,
why: 'count is a const captured by this render. The state update is asynchronous and only takes effect in the next render, so the log sees the value from the render it was created in.',
},
{text: '1 — setCount updates the variable synchronously', why: 'State setters never reassign the variable. React re-renders the component with a new value.'},
{text: 'undefined', why: 'count is initialised to 0 and is always a number.'},
{text: 'It throws, because you cannot read state after setting it', why: 'Reading it is perfectly legal — it simply returns the value for the current render.'},
]}
explanation={<>This is why the updater form exists: <code>setCount(c =&gt; c + 1)</code> receives the latest pending value rather than the one captured when the render began.</>}
reference={{label: 'State and the update model', href: '/knowledge-base/react-js#state-and-the-update-model'}}>

```jsx
const [count, setCount] = useState(0);

function handleClick() {
  setCount(count + 1);
  console.log(count);
}
```

</Quiz>

<Quiz
question="Which of these are legitimate uses of useEffect?"
type="multiple"
options={[
{text: 'Subscribing to a WebSocket and unsubscribing on unmount', correct: true, why: 'Synchronising with an external system, with cleanup — exactly what Effects are for.'},
{text: 'Computing a full name from first and last name props', why: 'Derived data. Compute it during render; putting it in state costs an extra render and can go stale.'},
{text: 'Adding a window resize listener', correct: true, why: 'A browser API outside React, and it needs cleanup.'},
{text: 'Sending an analytics event when a button is clicked', why: 'Caused by a user interaction, so it belongs in the event handler, not an Effect.'},
{text: 'Integrating a non-React charting library with a DOM node', correct: true, why: 'Synchronising React state with a third-party widget is a textbook Effect.'},
]}
explanation={<>The test: is this synchronising with something <em>outside</em> React? If it is caused by an interaction, it belongs in a handler. If it can be computed from props and state, compute it during render.</>}
reference={{label: 'useEffect is not run on change', href: '/knowledge-base/react-js#useeffect-is-not-run-on-change'}}
/>

<Quiz
question="A sortable table uses the array index as its key. Users report that after sorting, the checkbox selections attach to the wrong rows. Why?"
options={[
{
text: 'Keys identify elements across renders; with index keys the same key now refers to a different row, so React reuses the wrong component instance and its state',
correct: true,
why: 'React matches old and new elements by key. Index 0 is still index 0 after sorting, so React treats it as the same element and keeps its state — including the checkbox — while the data underneath has changed.',
},
{
text: 'Index keys are slower, so the update is racing',
why: 'This is a correctness problem, not a timing one. It reproduces every time.',
},
{
text: 'Checkbox state should always be controlled',
why: 'A controlled checkbox driven by row id would avoid the symptom, but the underlying mismatch of component identity is still the bug.',
},
{
text: 'The list needs a stable sort algorithm',
why: 'Sort stability affects ordering of equal items, not which component instance React reuses.',
},
]}
explanation={<>Use a stable id from the data. Index keys are safe only in a list that never reorders, filters or inserts — which is rarely the list you are worried about.</>}
reference={{label: 'Keys', href: '/knowledge-base/react-js#keys'}}
/>

<Quiz
question="Your team enables React Compiler 1.0. What should change in how you write components?"
options={[
{
text: 'Stop adding useMemo, useCallback and React.memo by hand, and make sure components follow the Rules of React so the compiler can optimise them',
correct: true,
why: 'The compiler applies memoisation automatically, but only to code it can prove is pure. Manual memoisation becomes redundant noise; rule violations make the compiler skip the component entirely.',
},
{
text: 'Nothing — the compiler is purely a build-time optimisation with no authoring implications',
why: 'It bails out of components that break the Rules of React, so those rules stop being advisory and start determining whether you get the optimisation.',
},
{
text: 'Replace useState with useReducer everywhere',
why: 'Unrelated. The compiler optimises memoisation, not the choice of state hook.',
},
{
text: 'Remove Strict Mode, since the compiler already checks purity',
why: 'The opposite — Strict Mode surfaces exactly the impurity that makes the compiler bail out.',
},
]}
explanation={<>Run <code>eslint-plugin-react-hooks</code> with the compiler rules enabled: anything it flags is a component the compiler will silently skip.</>}
reference={{label: 'The React Compiler', href: '/knowledge-base/react-js#the-react-compiler'}}
/>

---

## FAQ

**Is the virtual DOM slow?**
It is not the bottleneck in most applications. Diffing is cheap; expensive
render work and oversized component trees are what cost. See
[the DOM page](/knowledge-base/dom#where-the-virtual-dom-fits).

**Do I still need `useMemo` and `useCallback`?**
Not in a codebase with React Compiler enabled. Without it, use them for
genuinely expensive computations and for values passed to memoised children —
not reflexively.

**Class components?**
Legacy. They still work and are not being removed, but everything new is
function components with hooks, and new APIs are hooks-only.

**React or a framework?**
If the page needs to be indexed, or you want data fetching and routing decided
for you, use a framework. React alone is right for applications behind a login.

**When should I reach for Redux?**
Rarely, now. A server-cache library for server data plus `useState` and a small
store for the remainder covers most applications. See
[State Management](/knowledge-base/react-js/state-management).

---

## References

- [react.dev](https://react.dev/) — the official documentation; the _Learn_
  section is genuinely excellent.
- [Rules of React](https://react.dev/reference/rules) — purity and the hook
  rules the compiler depends on.
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19) —
  Actions, `use()`, `ref` as a prop, metadata hoisting.
- [React Compiler](https://react.dev/learn/react-compiler) — installation and
  what it does.
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
  — the single most useful page on the site.
