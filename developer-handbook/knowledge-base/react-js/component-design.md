---
id: component-design
title: Component Design
description: When to split a component, composition over configuration, controlled vs uncontrolled, and the patterns that keep a React codebase changeable.
---

# Component Design

## Introduction

Every React codebase eventually has a `UserCard` with nineteen props, four of
them booleans that must not be combined. It got there one reasonable change at a
time.

Component design is the set of decisions that prevent that: where to draw
boundaries, what goes through props versus composition, and which patterns
express variation without accumulating flags.

The test to hold everything against: **can someone use this component correctly
without reading its implementation?**

---

## When to Split a Component

Splitting is not free — each boundary adds a file, a name and a prop contract.
Split when there is a reason:

**The component does two unrelated things.** A component that fetches data _and_
renders a complex table has two reasons to change and two things to test.

**A piece is reused.** The second usage is the signal. The first is not.

**A piece has its own state that the parent does not care about.** A collapsible
panel's open state belongs to the panel. Lifting it into a 400-line parent makes
the parent re-render for something it does not use.

**You cannot name what it does.** If a section of JSX resists a name, it is
usually doing several things.

**It is too long to hold in your head.** Not a hard line count — a `switch` over
twenty icon names is fine at 200 lines, while 80 lines of nested conditionals is
not.

**Do not split** merely because a file passed some length threshold. Splitting a
cohesive component into `Header`, `HeaderInner` and `HeaderInnerContent`, each
used exactly once, makes the code harder to follow, not easier. Prop-drilling
through three layers that exist only because of a size rule is worse than one
readable file.

---

## Composition Over Configuration

The most valuable single principle here. When a component needs to vary, the
instinct is to add a prop. Do it a few times and the component becomes a
configuration language.

```jsx
// ❌ Configuration: every new requirement adds a prop.
<Card
  title="Revenue"
  subtitle="Last 30 days"
  showIcon
  iconName="chart"
  footerText="Updated 5m ago"
  headerAlign="left"
  variant="bordered"
  onFooterClick={...}
/>
```

```jsx
// ✅ Composition: the caller supplies the content.
<Card variant="bordered">
  <Card.Header>
    <ChartIcon />
    <div>
      <h3>Revenue</h3>
      <p>Last 30 days</p>
    </div>
  </Card.Header>
  <Card.Body>{children}</Card.Body>
  <Card.Footer>
    <button onClick={refresh}>Updated 5m ago</button>
  </Card.Footer>
</Card>
```

The second version needs no change when someone wants two buttons in the footer,
or an image in the header, or no header at all. `children` and element-typed
props are how you leave room without predicting requirements.

### Slots

For several independent regions, accept elements as props:

```jsx
function PageLayout({sidebar, header, children}) {
  return (
    <div className="layout">
      <header>{header}</header>
      {sidebar && <aside>{sidebar}</aside>}
      <main>{children}</main>
    </div>
  );
}

<PageLayout header={<SearchBar />} sidebar={<Nav />}>
  <Results />
</PageLayout>;
```

### Composition also solves prop drilling

Passing a prop through four components that do not use it is often a symptom of
the wrong shape rather than a case for context:

```jsx
// ❌ user threaded through every layer
<Page user={user}>
  <Sidebar user={user}>
    <Nav user={user}>
      <Avatar user={user} />

// ✅ Build the element where the data lives, pass it as content.
<Page>
  <Sidebar nav={<Nav avatar={<Avatar user={user} />} />} />
</Page>
```

Reach for context when a value is genuinely needed at many unrelated depths —
theme, locale, current user — not to avoid two levels of props.

---

## Designing the Props API

### Make invalid states unrepresentable

```tsx
// ❌ Sixteen combinations, most meaningless. What is loading + error?
type Props = {
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  isSuccess?: boolean;
};

// ✅ Four states, exactly one at a time, and the data is tied to success.
type Props =
  | {status: 'loading'}
  | {status: 'error'; error: Error}
  | {status: 'empty'}
  | {status: 'success'; items: Item[]};
```

A discriminated union lets TypeScript enforce that `items` exists only when the
status is `success`, which removes a whole class of runtime check.

### Prefer one enum to several booleans

```tsx
// ❌ primary + danger + ghost — what does that render?
<Button primary danger ghost />

// ✅
<Button variant="danger" size="sm" />
```

Booleans that are mutually exclusive should be one union-typed prop.

### Other habits worth having

- **Name props for meaning, not implementation.** `isDisabled`, not
  `greyedOut`.
- **Handlers are `onSomething`,** and receive the meaningful value:
  `onSelect(item)` beats `onSelect(event)`.
- **Spread the rest onto the DOM node** so callers can pass `aria-*`,
  `data-*` and `ref` without you enumerating them:

  ```jsx
  function Button({variant = 'primary', ...rest}) {
    return <button className={styles[variant]} {...rest} />;
  }
  ```

- **Give sensible defaults** so the common case needs no props.
- **Avoid a `style` prop that overrides internals.** It becomes an API you did
  not intend to publish and cannot change.

---

## Controlled and Uncontrolled

An **uncontrolled** component owns its own state. A **controlled** one takes the
value and a change handler from its parent.

```jsx
<Input defaultValue="hello" />                    {/* uncontrolled */}
<Input value={value} onChange={setValue} />       {/* controlled */}
```

Default to **uncontrolled**. It is less code and fewer re-renders. Make it
controlled when the parent needs to read the value as it changes, reset it,
validate live, or keep two inputs in sync.

Supporting both is a common library pattern:

```jsx
function Toggle({checked: controlledChecked, defaultChecked = false, onChange}) {
  const [internal, setInternal] = useState(defaultChecked);
  const isControlled = controlledChecked !== undefined;
  const checked = isControlled ? controlledChecked : internal;

  function handleChange(next) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  return <input type="checkbox" checked={checked} onChange={(e) => handleChange(e.target.checked)} />;
}
```

The one rule: **do not switch modes at runtime.** Going from `value={undefined}`
to `value="x"` produces React's "changing an uncontrolled input to be
controlled" warning, and the input misbehaves. Use `value={value ?? ''}`.

---

## Patterns

### Custom hooks for logic reuse

The primary reuse mechanism in modern React. A custom hook is any function
calling other hooks — it shares _behaviour_, not markup.

```jsx
function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
```

Extract a hook when the same stateful logic appears twice, or when a component's
logic is obscuring its markup. Note that **hooks share logic, not state** — two
components calling `useDebouncedValue` get separate state.

### Compound components

Several components cooperating through context, presenting one coherent API:

```jsx
const TabsContext = createContext(null);

function Tabs({defaultTab, children}) {
  const [active, setActive] = useState(defaultTab);
  const value = useMemo(() => ({active, setActive}), [active]);
  return <TabsContext value={value}>{children}</TabsContext>;
}

Tabs.List = function TabsList({children}) {
  return <div role="tablist">{children}</div>;
};

Tabs.Tab = function Tab({id, children}) {
  const {active, setActive} = useContext(TabsContext);
  return (
    <button role="tab" aria-selected={active === id} onClick={() => setActive(id)}>
      {children}
    </button>
  );
};

Tabs.Panel = function Panel({id, children}) {
  const {active} = useContext(TabsContext);
  return active === id ? <div role="tabpanel">{children}</div> : null;
};
```

```jsx
<Tabs defaultTab="overview">
  <Tabs.List>
    <Tabs.Tab id="overview">Overview</Tabs.Tab>
    <Tabs.Tab id="billing">Billing</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel id="overview">…</Tabs.Panel>
</Tabs>
```

The caller controls layout and ordering; the components share state invisibly.
Note React 19 lets you render `<TabsContext value={…}>` directly rather than
`<TabsContext.Provider>`.

### Presentational and container components

Separating "what it looks like" from "where the data comes from" remains useful,
though the old naming has faded:

- A **presentational** component takes props and renders. No fetching. Trivially
  testable, trivially reusable, works in Storybook.
- A **container** fetches or subscribes and renders a presentational component.

The practical benefit is testing: you can test a table's rendering with a fixed
array, and test the data logic without rendering anything.

### Error boundaries

The one thing that still requires a class component (or a library):

```jsx
class ErrorBoundary extends React.Component {
  state = {error: null};
  static getDerivedStateFromError(error) {
    return {error};
  }
  componentDidCatch(error, info) {
    reportError(error, info);
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
```

Place boundaries at meaningful seams — per route, per widget — so one failing
chart does not blank the page. `react-error-boundary` provides a hooks-friendly
wrapper with reset support.

### Patterns that have aged out

- **Higher-order components** — custom hooks do the same job without wrapper
  nesting or prop collisions.
- **Render props** — mostly superseded by hooks, though still useful when the
  shared thing genuinely is markup.
- **`forwardRef`** — legacy in React 19; `ref` is a normal prop.
- **PropTypes** — removed from React in 19. Use TypeScript.

---

## File and Folder Organisation

Group by **feature**, not by technical type:

```text
src/
├── features/
│   ├── checkout/
│   │   ├── components/
│   │   │   ├── CartSummary.tsx
│   │   │   └── PaymentForm.tsx
│   │   ├── hooks/useCart.ts
│   │   ├── api.ts
│   │   └── index.ts        ← the feature's public surface
│   └── orders/
├── components/ui/          ← shared, generic: Button, Input, Modal
├── hooks/                  ← shared hooks
└── lib/                    ← non-React utilities
```

A `components/` folder holding 200 files sorted alphabetically tells you nothing
about the application. A feature folder means a change to checkout touches one
directory, and deleting a feature is deleting a folder.

Move something into `components/ui/` when a _second_ feature needs it — not in
anticipation.

Keep tests and styles beside the component they belong to.

---

## Do's and Don'ts

### Do

- Split when a component has two responsibilities, not when it hits a line
  count.
- Reach for `children` and element props before adding another configuration
  prop.
- Model mutually exclusive states as a discriminated union.
- Default to uncontrolled; add control when the parent genuinely needs it.
- Extract custom hooks for repeated stateful logic.
- Spread the rest of the props onto the underlying DOM node.
- Organise by feature.
- Put error boundaries at route and widget seams.

### Don't

- Don't add a boolean prop for every visual variant.
- Don't switch a component between controlled and uncontrolled at runtime.
- Don't use the array index as a key in a list that can change.
- Don't create a wrapper component used exactly once to satisfy a size rule.
- Don't reach for context to avoid two levels of prop passing.
- Don't write new higher-order components.
- Don't use PropTypes — React 19 removed them.

---

## Common Mistakes

**The god component.** Fetching, transforming, rendering and handling forms in
one file. Split by responsibility: a hook for the data, presentational
components for the markup.

**Boolean prop explosion.** Four booleans is sixteen combinations, most of which
are meaningless and untested. One `variant` union instead.

**Premature abstraction.** A `<GenericTable>` built for two call sites, which
then needs a `renderCellOverride` prop for the third. Duplicate until the shape
is clear.

**Context for everything.** Every consumer re-renders when any part of the value
changes. Split contexts by update frequency, or use a store with selectors.

**Deriving state into `useState`.** If it can be computed from props, compute
it. State that mirrors a prop goes stale.

**Unstable keys.** `key={Math.random()}` remounts every row on every render,
destroying state, focus and any animation.

**Leaking implementation through `className`.** Once callers override your
internals, your internals are your API.

---

## FAQ

**How large is too large?**
Ask what the component is responsible for, not how many lines it has. Two
responsibilities is the signal.

**Atomic Design — atoms, molecules, organisms?**
The vocabulary helps some teams and causes long arguments in others about
whether something is a molecule. `ui/` for generic pieces and feature folders
for the rest captures most of the benefit.

**One component per file?**
For anything exported, yes. Small helper components used only in that file are
fine alongside it.

**Where do TypeScript types live?**
Next to the component for props; in a shared `types.ts` for domain models used
across features.

**Should everything be memoised?**
No — and with React Compiler enabled, almost nothing should be memoised by hand.
See [the compiler section](/knowledge-base/react-js#the-react-compiler).

---

## Check your understanding

<Quiz
question="A Card component has grown to 14 props, including showHeader, showFooter, headerTitle, footerText and iconName. What is the best redesign?"
options={[
{
text: 'Expose composable subcomponents (Card.Header, Card.Body, Card.Footer) and let callers pass content as children',
correct: true,
why: 'Composition removes the need to predict every requirement. New layouts become caller concerns rather than new props on Card.',
},
{
text: 'Group the props into a single config object prop',
why: 'The same configuration surface with one more layer of indirection. Fourteen keys in an object is still fourteen decisions Card has to support.',
},
{
text: 'Split Card into CardWithHeader, CardWithFooter and CardWithBoth',
why: 'Combinatorial explosion — the next requirement needs a fourth and fifth variant.',
},
{
text: 'Keep the props but give them all defaults',
why: 'Improves ergonomics slightly and does nothing about the underlying problem: Card must know about every possible arrangement.',
},
]}
explanation={<>The general rule: when a component keeps growing configuration props, the thing that varies is <em>content</em>, and content belongs to the caller.</>}
reference={{label: 'Composition over configuration', href: '/knowledge-base/react-js/component-design#composition-over-configuration'}}
/>

<Quiz
question="Which props API best prevents invalid states at compile time?"
options={[
{
text: 'A discriminated union: { status: "loading" } | { status: "error", error: Error } | { status: "success", items: Item[] }',
correct: true,
why: 'Exactly one state can be active, and items exists only when status is success — so the component cannot be handed a nonsensical combination.',
},
{text: 'Four optional boolean props: isLoading, isError, isEmpty, isSuccess', why: 'Sixteen combinations, most meaningless. Nothing stops isLoading and isError both being true.'},
{text: 'A single status string plus optional items and error props', why: 'Better than booleans, but nothing ties items to the success status, so the component still needs runtime checks.'},
{text: 'One props object typed as Record<string, unknown>', why: 'Removes type safety entirely.'},
]}
explanation={<>"Make invalid states unrepresentable" moves a class of bug from runtime to compile time, and removes the defensive checks that would otherwise be needed.</>}
reference={{label: 'Make invalid states unrepresentable', href: '/knowledge-base/react-js/component-design#make-invalid-states-unrepresentable'}}
/>

<Quiz
question="React warns: 'A component is changing an uncontrolled input to be controlled.' What causes this?"
options={[
{
text: 'The value prop started as undefined and later became a string, switching the input between modes',
correct: true,
why: 'React decides control mode from whether value is undefined on first render. Supply value={value ?? ""} so it is always defined.',
},
{text: 'The onChange handler is missing', why: 'A controlled input with no onChange produces a different warning about a read-only field.'},
{text: 'defaultValue and value are both set', why: 'Also a warning, but a distinct one about specifying both.'},
{text: 'The input is inside a form without an action', why: 'Unrelated to control mode.'},
]}
explanation={<>The usual cause is async data: the value is <code>undefined</code> while loading, then arrives. Coalescing to an empty string fixes it.</>}
reference={{label: 'Controlled and uncontrolled', href: '/knowledge-base/react-js/component-design#controlled-and-uncontrolled'}}
/>

<Quiz
question="Two components need the same debounced-search logic but render completely different markup. What is the right way to share it?"
options={[
{
text: 'Extract a custom hook — it shares stateful behaviour without imposing any markup',
correct: true,
why: 'Custom hooks are the modern mechanism for logic reuse. Each caller gets its own independent state and renders whatever it likes.',
},
{
text: 'A higher-order component that injects the debounced value',
why: 'Works, but adds wrapper nesting, obscures the component tree and risks prop-name collisions. Hooks superseded HOCs for this.',
},
{
text: 'A render prop component',
why: 'Also workable and now largely superseded. Render props still earn their place when the shared thing is markup — here it is logic.',
},
{
text: 'Put the logic in a shared context provider',
why: 'Context distributes one shared value. These components need independent state each, which is the opposite.',
},
]}
explanation={<>Remember that hooks share <em>logic</em>, not state: two components calling the same hook get separate state, which is exactly what is wanted here.</>}
reference={{label: 'Custom hooks for logic reuse', href: '/knowledge-base/react-js/component-design#custom-hooks-for-logic-reuse'}}
/>

<Quiz
question="Which of these are good reasons to split a component?"
type="multiple"
options={[
{text: 'It both fetches data and renders a complex table', correct: true, why: 'Two responsibilities, two reasons to change, and two things that are easier to test separately.'},
{text: 'A section of it is now needed in a second place', correct: true, why: 'The second usage is the signal for extraction. The first is not.'},
{text: 'Part of it has state the parent does not care about', correct: true, why: 'Pushing state down keeps it local and stops the parent re-rendering for something it does not use.'},
{text: 'The file has passed 150 lines', why: 'An arbitrary threshold. A long but cohesive component is easier to read than four single-use fragments with prop drilling between them.'},
{text: 'You cannot think of a name for a block of JSX', correct: true, why: 'Resisting a name usually means it is doing several things — the naming difficulty is the diagnostic.'},
]}
explanation={<>Splitting has a cost: a file, a name and a prop contract. Pay it for a reason, not for a line count.</>}
reference={{label: 'When to split a component', href: '/knowledge-base/react-js/component-design#when-to-split-a-component'}}
/>

---

## References

- [Thinking in React](https://react.dev/learn/thinking-in-react) — the official
  walkthrough of decomposing a UI.
- [Passing props to a component](https://react.dev/learn/passing-props-to-a-component)
  — including `children` and element props.
- [Reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
  — when to extract, and when not to.
- [Sharing state between components](https://react.dev/learn/sharing-state-between-components)
  — lifting state, and controlled vs uncontrolled.
- [react-error-boundary](https://github.com/bvaughn/react-error-boundary) — the
  practical error-boundary wrapper.
