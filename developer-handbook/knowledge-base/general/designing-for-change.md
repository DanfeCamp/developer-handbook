---
title: 'Designing for Change'
description: 'What keeps a codebase changeable as it grows — coupling and cohesion, when not to abstract, error handling strategies, and naming as design work.'
---

# Designing for Change

## Introduction

Almost all the cost of software is incurred after it is first written. Code is
read far more often than written, and changed far more often than replaced.

**So the question that matters is not "is this elegant?" but "what happens when
this needs to change?"** A design that is hard to modify is a design that will
be worked around, and the workarounds compound.

**Four things account for most of the difference:**

- **Coupling and cohesion** — how change propagates between modules.
- **Abstraction discipline** — knowing when _not_ to.
- **Error handling** — whether failures are visible or mysterious.
- **Naming** — whether the next reader has to reconstruct your intent.

None of these are framework decisions. They apply identically in TypeScript, Go,
PHP and Python, and they are what separates a codebase that stays workable at
five years from one that is rewritten at two.

For the structural patterns built on these ideas, see
[Architecture](/knowledge-base/architecture).

---

## Coupling and Cohesion

- **Coupling** — how much one module depends on another's internals. Lower is
  better.
- **Cohesion** — how strongly the things inside a module belong together. Higher
  is better.

The target is **loose coupling, high cohesion**: modules with a small, stable
surface that hides a lot of related detail.

**A useful test:** _if I change this module's internals, how many other files
must change?_ If the answer is more than zero, the abstraction is leaking.

**Where coupling hides:**

| Form             | Example                                                  |
| ---------------- | -------------------------------------------------------- |
| **Data**         | Passing an entire object where two fields are needed     |
| **Structural**   | Reaching through `order.customer.address.postcode`       |
| **Temporal**     | `init()` must be called before `start()`, undocumented   |
| **Shared state** | Two modules coordinating through a module-level variable |
| **Control**      | A boolean flag that changes what the function does       |

**A boolean parameter is usually two functions.** `save(user, true)` tells the
reader nothing; `saveDraft(user)` and `publish(user)` tell them everything.

**Low cohesion looks like a `utils.js` with forty unrelated functions.** Nothing
in it belongs together, so nobody can predict what is in it, and it becomes a
dependency of everything — which is exactly the coupling you were avoiding.

**Depend on interfaces, not implementations**, at boundaries you expect to
change. Not everywhere — an interface with one implementation and no prospect of
a second is ceremony. See
[Dependency Injection](/knowledge-base/architecture/dependency-injection).

---

## Abstraction, and When Not To

An abstraction hides detail behind a simpler interface. **Good abstractions
remove a decision permanently.** Bad ones remove it temporarily, then reappear
as configuration options, escape hatches and a `raw` parameter.

**Guidance that survives contact with real code:**

**Rule of three.** Duplicate twice; extract on the third occurrence. Two similar
pieces of code are often not the same piece of code — they merely look alike
today.

**DRY is about knowledge, not characters.** Two functions that happen to look
identical but change for different reasons should stay separate. Coupling them
means every future change to one must consider the other:

```js
// These look identical. They are not the same rule.
function validateSignupAge(age) { return age >= 18; }
function validateDrinkingAge(age) { return age >= 18; }
```

Merge them and the day the drinking age changes, you break signups.

**YAGNI.** Build for the requirement you have. Speculative generality is the
most expensive kind of code, because it must be understood and maintained long
before it is ever useful — and usually the eventual requirement differs from the
one you guessed.

**Prefer deleting to abstracting.** The cheapest code to maintain is the code
that is not there.

**The wrong abstraction is more expensive than duplication.** Duplication is
visible and cheap to fix. A wrong abstraction is invisible, and every future
change fights it — usually by adding a flag, which makes it worse.

**The signals that an abstraction has gone wrong:** a growing options object,
boolean parameters that switch behaviour, `if (type === …)` inside the shared
code, and a name containing "Manager", "Helper" or "Base" that nobody can define
precisely.

---

## Errors

Two philosophies, both valid:

| Approach          | Strength                               | Weakness                                          |
| ----------------- | -------------------------------------- | ------------------------------------------------- |
| **Exceptions**    | Concise happy path                     | The type system usually cannot say what is thrown |
| **Result values** | Every failure visible in the signature | Verbose; requires discipline                      |

Rust's `Result`, Go's second return value and TypeScript union returns are the
second style. Both work; consistency within a codebase matters more than the
choice.

**Whichever you use:**

**Distinguish the two kinds of failure.** A programmer error — invalid argument,
impossible state — should **fail fast and loudly**, crashing in development
rather than continuing with corrupt data. An expected failure — a network
timeout, a validation error, a missing record — is a normal operating condition
and should be handled explicitly, not thrown to a global handler.

**Never swallow an error.** An empty `catch` block converts a bug into a
mystery, and the symptom appears somewhere unrelated:

```js
// ❌ The failure is now invisible. Debugging this later is archaeology.
try {
  await syncProfile(user);
} catch {}

// ✅ Handled deliberately, with the decision recorded.
try {
  await syncProfile(user);
} catch (err) {
  logger.warn({err, userId: user.id}, 'profile sync failed; continuing');
}
```

**Preserve the cause.** `throw new Error('Could not load profile', {cause: err})`
keeps the original stack, so the trace shows both the context and the root
failure.

**Do not leak internals to users.** Log the stack trace with a correlation ID
and show the user the ID. A stack trace in a browser response reveals file
paths, library versions and sometimes credentials. See
[Logging](/knowledge-base/operations/logging).

**Fail at the boundary.** Validate input where it enters and construct values
that are valid by definition, so the interior of the system does not need
defensive checks everywhere.

---

## Naming

Naming is design work, not decoration. A name that describes _what_ something is
for survives refactoring; a name that describes _how_ it works does not.

- **Say what it is, not what type it is:** `expiresAt`, not `dateVal`.
- **Include the unit:** `timeoutMs`, `sizeBytes`, `priceInPence`. Unit
  confusion is a real source of production bugs, and the name is free
  documentation that cannot go stale.
- **Booleans read as assertions:** `isActive`, `hasPermission`, `canRetry`.
- **Avoid negatives:** `isDisabled` beats `isNotEnabled`, because `!isNotEnabled`
  is unreadable.
- **Be consistent:** one concept, one word. If it is a `customer` in one module
  and a `client` in another, every reader must maintain a translation table.
- **Length should scale with scope.** `i` in a three-line loop is fine; a
  module-level `d` is not.

**Names that signal a design problem:** `data`, `info`, `manager`, `helper`,
`util`, `process`, `handle`. They are placeholders for a concept nobody has
identified yet — and the difficulty of naming something is usually telling you
it does more than one thing.

**Comments should explain why, not what.** The code says what it does. A comment
earns its place by recording the reason: a workaround for a specific bug, a
non-obvious business rule, a deliberate trade-off. Comments that restate the
code go stale and then actively mislead.

---

## Do's and Don'ts

### Do

- Aim for loose coupling and high cohesion.
- Duplicate until the third occurrence, then extract.
- Split a boolean-parameter function into two named functions.
- Distinguish programmer errors from expected failures.
- Preserve the original error as `cause`.
- Log failures with a correlation ID and show the user the ID.
- Name things after their purpose, and include units.
- Delete code rather than generalising it.
- Comment the reason, not the mechanism.

### Don't

- Don't abstract on the second occurrence.
- Don't merge code that merely looks alike.
- Don't build for requirements you do not have.
- Don't catch an error and continue as if nothing happened.
- Don't leak stack traces to users.
- Don't add a flag to a shared function to make it fit a new case.
- Don't create a `utils` module for things with nothing in common.
- Don't use negated boolean names.
- Don't let one concept have two names.

---

## Common Mistakes

**Premature abstraction.** A base class introduced for two subclasses that later
diverge is harder to remove than the duplication it replaced.

**DRY applied to appearance.** Two identical validations merged, and a change to
one silently changes the other.

**The options object that keeps growing.** Each new caller adds a flag, until
the shared function is a switch statement with a misleading name.

**Empty catch blocks.** A bug becomes a mystery, surfacing far from its cause.

**Losing the cause.** Re-throwing a new error without `cause` discards the stack
that would have identified the problem.

**Stack traces in HTTP responses.** File paths, library versions and sometimes
connection strings, handed to anyone who triggers an error.

**A `utils.js` that everything imports.** Low cohesion, maximum coupling, and it
becomes impossible to change.

**Boolean parameters.** `save(user, true, false)` at the call site, and nobody
can read it without opening the definition.

**Units in comments instead of names.** `// milliseconds` above `timeout` goes
stale; `timeoutMs` cannot.

---

## Debugging

| Symptom                              | What it usually indicates               |
| ------------------------------------ | --------------------------------------- |
| One change breaks unrelated tests    | High coupling — hidden shared state     |
| Every feature touches the same file  | Low cohesion, or a god object           |
| A failure appears far from its cause | A swallowed or re-thrown error          |
| Nobody can explain what a class does | It does more than one thing             |
| A shared function has five flags     | A wrong abstraction accreting cases     |
| Merge conflicts always in one file   | That file has too many responsibilities |
| Tests need extensive mocking         | Effects are too deep in the logic       |

**When a change is hard, ask what would have made it easy.** That answer is
usually the refactor worth doing — and it is far more reliable than applying
principles speculatively before you know where change actually lands.

---

## FAQ

**DRY or duplication?**
Duplicate until you understand the shape of the abstraction. Wrong abstractions
are more expensive than repetition, because every future change must fight them.

**How do I know if something is over-abstracted?**
Count the indirections between a request arriving and the work happening. If you
cannot follow it without a debugger, and each layer adds no decision, it is too
many.

**Exceptions or result types?**
Either. Be consistent within a codebase, and make sure expected failures are
handled explicitly rather than thrown to a global handler.

**Should I use interfaces everywhere?**
No. Use them where you expect a second implementation or need a test seam. An
interface with one implementation forever is ceremony.

**When should I refactor?**
When you are about to change code and the current shape makes it hard. Refactor
to make the change easy, then make it. Refactoring on a schedule, with no change
pending, optimises for a future you cannot see.

**How much should I comment?**
Enough that the _why_ is recoverable. Non-obvious business rules, workarounds
with an issue link, and deliberate trade-offs. Not a restatement of the code.

---

## Check your understanding

<Quiz
question="Two validation functions have identical bodies — both check `age >= 18`. One is for signup eligibility, the other for a drinking-age check. Should they be merged?"
options={[
{
text: 'No — they encode different rules that happen to share a value today, and merging couples two things that change for different reasons',
correct: true,
why: 'DRY is about knowledge, not characters. If the drinking age changes in one jurisdiction, a merged function would silently change signup eligibility too.',
},
{text: 'Yes — duplicated logic is always a maintenance risk', width: false, why: 'Duplication is a risk when it represents one piece of knowledge. Coincidental similarity is not that.'},
{text: 'Yes, but only if they are in the same module', why: 'Location does not change whether they represent the same rule.'},
{text: 'No — but only because the function names differ', why: 'The names are a symptom; the reason is that the two rules have independent reasons to change.'},
]}
explanation={<>The test is not "does this look the same?" but "will these change together?" A wrong abstraction is more expensive than duplication, because duplication is visible and cheap to fix while a wrong abstraction is fought by every future change — usually by adding a flag, which compounds it.</>}
reference={{label: 'Abstraction, and when not to', href: '/knowledge-base/general/designing-for-change#abstraction-and-when-not-to'}}
/>

<Quiz
question="What is wrong with `try { await syncProfile(user); } catch {}`?"
options={[
{
text: 'It swallows the error entirely — the failure becomes invisible, and any resulting problem surfaces far from its cause',
correct: true,
why: 'An empty catch converts a bug into a mystery. Nothing is logged, no metric moves, and the next symptom appears somewhere unrelated with no trail back.',
},
{text: 'catch without a binding is invalid syntax', width: false, why: 'Optional catch binding is valid modern JavaScript — the problem is what the block does, which is nothing.'},
{text: 'The await should be outside the try block', why: 'Awaiting inside try is exactly right; that is how the rejection is caught.'},
{text: 'It should rethrow so the global handler can log it', width: false, why: 'Sometimes appropriate, and if continuing is genuinely correct here, rethrowing would change the behaviour rather than fix the visibility.'},
]}
explanation={<>If continuing is the right behaviour, record the decision: <code>logger.warn({'{err, userId}'}, 'profile sync failed; continuing')</code>. And when re-throwing, pass <code>{'{cause: err}'}</code> so the original stack survives.</>}
reference={{label: 'Errors', href: '/knowledge-base/general/designing-for-change#errors'}}
/>

<Quiz
question="A shared `save(entity, isDraft, skipValidation, notify)` function is called from twelve places. What does this signature indicate?"
options={[
{
text: 'A wrong abstraction accreting cases — the boolean flags mean it is really several distinct operations sharing a name',
correct: true,
why: 'Control coupling: each flag changes what the function does, so callers must understand its internals, and the name describes none of the actual behaviours.',
},
{text: 'Good reuse — one function serving twelve call sites', width: false, why: 'Reuse of a function that behaves four different ways is not reuse of one idea.'},
{text: 'The parameters should be an options object instead', width: false, why: 'That improves readability at the call site and leaves the underlying design problem intact.'},
{text: 'The function needs better documentation', why: 'Documentation would describe the problem rather than remove it.'},
]}
explanation={<>Split it into named operations — <code>saveDraft</code>, <code>publish</code>, <code>importWithoutValidation</code> — sharing whatever genuinely common helper remains. A boolean parameter is usually two functions, and <code>save(user, true, false, true)</code> is unreadable at the call site.</>}
reference={{label: 'Coupling and cohesion', href: '/knowledge-base/general/designing-for-change#coupling-and-cohesion'}}
/>

<Quiz
question="Which naming choices are sound?"
type="multiple"
options={[
{text: '`timeoutMs` rather than `timeout`', correct: true, why: 'The unit in the name is free documentation that cannot go stale, and unit confusion is a real source of production bugs.'},
{text: '`isActive` rather than `active` for a boolean', correct: true, why: 'Booleans reading as assertions make conditionals self-explanatory at the call site.'},
{text: '`isDisabled` rather than `isNotEnabled`', correct: true, why: 'Negated names produce double negatives — `!isNotEnabled` is unreadable.'},
{text: 'Using `customer` consistently rather than `client` in some modules', correct: true, why: 'One concept, one word. Two names for one thing forces every reader to maintain a translation table.'},
{text: '`processData` for a function that validates and stores an order', why: 'Both words are placeholders. A name you struggle to make specific usually means the function does more than one thing.'},
]}
explanation={<>Names like <code>data</code>, <code>info</code>, <code>manager</code>, <code>helper</code> and <code>process</code> stand in for a concept nobody has identified yet. The difficulty of naming something is diagnostic information about the design.</>}
reference={{label: 'Naming', href: '/knowledge-base/general/designing-for-change#naming'}}
/>

<Quiz
question="A team wants to refactor a module 'because it is messy', with no change currently planned for it. What is the stronger approach?"
options={[
{
text: 'Wait until a change is needed, then refactor to make that specific change easy — the pending change tells you which shape is actually right',
correct: true,
why: 'Refactoring with no change in hand optimises for a guessed future. The requirement that eventually arrives usually differs from the one anticipated.',
},
{text: 'Refactor immediately — technical debt compounds', width: false, why: 'Some debt genuinely compounds, and code that is never touched costs nothing to leave alone.'},
{text: 'Rewrite the module from scratch with a cleaner design', why: 'A rewrite discards accumulated bug fixes and edge-case handling that nobody remembers the reason for.'},
{text: 'Add abstraction layers now so future changes are easier', why: 'Speculative generality is the most expensive kind of code — maintained long before it is useful, and usually aimed at the wrong requirement.'},
]}
explanation={<>The productive question when a change turns out to be hard is "what would have made this easy?" That answer identifies the refactor worth doing, and it is far more reliable than applying principles before you know where change actually lands.</>}
reference={{label: 'FAQ', href: '/knowledge-base/general/designing-for-change#faq'}}
/>

---

## References

- [Sandi Metz: The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)
  — why duplication is cheaper than a bad abstraction.
- [Martin Fowler: Refactoring](https://refactoring.com/) — the catalogue, and
  when to apply it.
- [MDN: `Error` cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
  — preserving the original failure.
- [Go blog: Error handling](https://go.dev/blog/error-handling-and-go) — the
  result-value philosophy, argued.
- [Architecture](/knowledge-base/architecture) — the structural patterns built
  on these principles.
- [SOLID Principles](/knowledge-base/architecture/solid) — coupling and cohesion
  formalised, with the misreadings that make them harmful.
