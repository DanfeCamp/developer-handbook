---
title: 'SOLID Principles'
description: 'Five design principles, what they actually mean, and the ways each is routinely misapplied.'
---

# SOLID Principles

## Introduction

SOLID is five object-oriented design principles, collected by Robert C. Martin
from work in the 1990s. They are among the most cited ideas in software design
and among the most misunderstood — largely because the names are opaque and the
canonical examples are abstract.

All five serve one goal: **make code changeable.** Each identifies a way a
design becomes rigid, and prescribes a structure that keeps change local.

**Two honest caveats before the list.**

They are **guidelines, not laws**. Applied dogmatically, SOLID produces
codebases with an interface per class, a factory per interface and six files to
follow for any change. That is not better than the problem it solves.

They are **object-oriented**. In a functional or procedural codebase, some map
across (single responsibility, dependency inversion) and some barely apply
(Liskov substitution has no meaning without inheritance).

The useful reading of SOLID is as a **vocabulary for diagnosing rigidity** —
names for problems you already recognise.

---

## S — Single Responsibility

> A class should have one reason to change.

The name misleads. It is not "a class should do one thing" — it is about
**who asks for changes**. If the finance team and the marketing team can both
require a change to the same class, it has two responsibilities.

```ts
// ❌ Three reasons to change: report format, tax rules, delivery mechanism
class Report {
  calculateTax() {}
  formatAsPdf() {}
  emailToAccountant() {}
}
```

Finance changes tax rules. Design changes the PDF layout. Operations changes how
it is delivered. Three teams, one class, three sources of conflict.

```ts
// ✅ Each changes for one reason
class TaxCalculator {}
class ReportPdfRenderer {}
class ReportMailer {}
```

**How it is misapplied.** Taken as "one method per class", producing
`OrderCreator`, `OrderValidator`, `OrderNotifier`, `OrderPersister` for what is
one coherent operation. Cohesion matters too: things that change together
should live together. A class doing five closely related things that always
change together has one responsibility.

**The practical test:** who requests the change? If the answer is consistently
one group, leave it alone.

---

## O — Open/Closed

> Open for extension, closed for modification.

Adding a behaviour should not require editing existing, tested code.

```ts
// ❌ Every new payment method edits this switch
function processPayment(type: string, amount: number) {
  switch (type) {
    case 'card': return chargeCard(amount);
    case 'paypal': return chargePaypal(amount);
    // adding 'apple_pay' means touching tested code
  }
}
```

```ts
// ✅ A new method is a new file; nothing existing is edited
interface PaymentMethod {
  charge(amountPence: number): Promise<Receipt>;
}

class CardPayment implements PaymentMethod { /* … */ }
class ApplePayPayment implements PaymentMethod { /* … */ }

function processPayment(method: PaymentMethod, amountPence: number) {
  return method.charge(amountPence);
}
```

**How it is misapplied.** Building extension points for variation that never
arrives. A plugin architecture with one plugin is pure cost.

**The rule of three applies.** Write the `switch`. When a third case appears and
the shape is clear, extract the abstraction. Guessing the seam before you have
seen it vary usually produces the wrong seam.

---

## L — Liskov Substitution

> A subtype must be usable anywhere its base type is expected, without the
> caller noticing.

The most technical of the five, and the one with real teeth: it says inheritance
must preserve behaviour, not just satisfy the compiler.

```ts
// The classic violation
class Rectangle {
  setWidth(w: number) { this.width = w; }
  setHeight(h: number) { this.height = h; }
  area() { return this.width * this.height; }
}

class Square extends Rectangle {
  setWidth(w: number) { this.width = this.height = w; }  // also changes height
  setHeight(h: number) { this.width = this.height = h; }
}

function test(r: Rectangle) {
  r.setWidth(5);
  r.setHeight(4);
  assert(r.area() === 20);   // passes for Rectangle, fails for Square
}
```

`Square` compiles fine and breaks the contract. A square _is_ a rectangle
mathematically; a _mutable_ square is not a substitutable mutable rectangle.

A subtype violates LSP if it:

- **Throws where the parent does not** — `ReadOnlyList.add()` throwing is the
  everyday example.
- **Strengthens preconditions** — demands more of its inputs than the parent.
- **Weakens postconditions** — guarantees less than the parent promised.
- **Changes observable behaviour** callers depend on.

**The practical takeaway:** if you find yourself checking `instanceof` before
calling a method, the substitution has already failed. **Prefer composition to
inheritance** — most LSP violations are inheritance used where composition was
correct.

---

## I — Interface Segregation

> No client should depend on methods it does not use.

```ts
// ❌ Every implementer must provide all of it
interface Worker {
  work(): void;
  eat(): void;
  attendMeeting(): void;
}

class Robot implements Worker {
  work() {}
  eat() { throw new Error('Robots do not eat'); }        // LSP violation too
  attendMeeting() { throw new Error('Not applicable'); }
}
```

```ts
// ✅ Small interfaces, composed
interface Workable { work(): void; }
interface Feedable { eat(): void; }

class Robot implements Workable {}
class Employee implements Workable, Feedable {}
```

**Where it bites in practice:** a wide interface makes testing painful. Mocking
a twenty-method repository to test something that uses two of them is a signal
the interface is too broad.

**How it is misapplied.** One interface per method, so a class implements
fourteen of them. Group by _what a client needs_, not by what a class provides.

---

## D — Dependency Inversion

> Depend on abstractions, not concretions. High-level policy should not depend
> on low-level detail.

The most valuable of the five, and the most confused with dependency injection.

```ts
// ❌ The business rule is welded to a specific vendor
class OrderService {
  private stripe = new StripeClient(process.env.STRIPE_KEY);

  place(order: Order) {
    this.stripe.charge(order.total);   // cannot test, cannot change vendor
  }
}
```

```ts
// ✅ The service depends on an interface it defines
interface PaymentGateway {
  charge(amountPence: number, reference: string): Promise<Receipt>;
}

class OrderService {
  constructor(private readonly payments: PaymentGateway) {}

  place(order: Order) {
    return this.payments.charge(order.totalPence, order.reference);
  }
}

class StripeGateway implements PaymentGateway { /* … */ }
```

The subtle part is the word _inversion_. Normally high-level code depends on
low-level code. Here the **interface belongs to the high-level module** —
`OrderService` declares what it needs, and the Stripe adapter conforms. The
dependency arrow now points from the detail towards the policy, which is the
inversion.

**Dependency inversion is the principle. [Dependency
injection](/knowledge-base/architecture/dependency-injection) is one technique
for satisfying it.** You can inject concrete classes (no inversion) and you can
invert without a DI container.

**How it is misapplied.** An interface for every class, including ones with a
single implementation that will never change. `UserServiceInterface` implemented
only by `UserService` adds a file and no flexibility.

**Invert at boundaries you might cross:** payment providers, email senders,
storage, external APIs, the clock, randomness. Not at every internal seam.

---

## Where SOLID Is Weakest

Worth saying plainly, because the principles are often presented as beyond
question.

**They can produce more indirection than they remove.** Applied everywhere, you
get an interface, an implementation, a factory and a registration for each
concept — and following a single request through six files is genuinely harder
than reading one clear class.

**They predate modern language features.** First-class functions make many
single-method interfaces unnecessary; a function type _is_ the abstraction.
Discriminated unions handle much of what polymorphism was needed for.

**They say nothing about the things that most often go wrong**: data modelling,
concurrency, error handling, deployment, observability. A SOLID codebase with an
N+1 query on the checkout page is still slow.

**Cohesion is under-weighted.** SRP is easy to read as "split everything", when
keeping related things together is equally important.

Use SOLID when code is hard to change and you want vocabulary for why. Do not
use it as a checklist to apply to code that is working.

---

## Applying Them in Practice

A realistic sequence rather than a doctrine:

1. **Write the straightforward version.** A `switch`, a concrete dependency, one
   class.
2. **Notice the pain.** A test needs a network call. A change touches four
   files. A `switch` grows a third time.
3. **Name the problem** using SOLID — this is a dependency-inversion problem;
   that is a single-responsibility problem.
4. **Apply the minimum fix** for the pain you actually have.

The signals worth acting on:

| Signal                                  | Principle | Fix                                       |
| --------------------------------------- | --------- | ----------------------------------------- |
| Test needs a real network, DB or clock  | **D**     | Invert the dependency behind an interface |
| A `switch` grows with every feature     | **O**     | Extract a strategy                        |
| Two teams keep editing one class        | **S**     | Split by reason to change                 |
| Mocking needs twenty methods to use two | **I**     | Narrow the interface                      |
| `instanceof` before calling a method    | **L**     | Replace inheritance with composition      |

---

## Do's and Don'ts

### Do

- Use SOLID as a diagnostic vocabulary for code that resists change.
- Invert dependencies at external boundaries — payments, email, storage, clock.
- Split classes by _who requests changes_, not by counting methods.
- Prefer composition to inheritance.
- Keep interfaces narrow, shaped by what clients need.
- Extract an abstraction on the third variation, not the first.

### Don't

- Don't create an interface for a class with one implementation and no prospect
  of another.
- Don't split a cohesive class into single-method fragments.
- Don't use inheritance where a subtype cannot honour the parent's contract.
- Don't build extension points for variation you have not seen.
- Don't treat SOLID as a review checklist.
- Don't assume SOLID covers performance, data modelling or operability. It does
  not.

---

## FAQ

**Are SOLID principles still relevant?**
As diagnostics, yes. As a design methodology applied uniformly, they age poorly
against languages with first-class functions and rich type systems.

**Which matters most?**
Dependency inversion, by a distance. It is what makes code testable and
replaceable at its boundaries.

**Do they apply to functional programming?**
Partly. Single responsibility and dependency inversion translate directly —
pass the effect in as a function. Liskov substitution has no meaning without
subtyping.

**Is SOLID the same as Clean Architecture?**
No. SOLID is class-level design; Clean Architecture is application structure.
They share an author and a dependency-direction instinct. See
[Clean Architecture](/knowledge-base/architecture/clean-architecture).

**How do I stop over-applying them?**
Ask what breaks if you do not. If nothing does, you are adding indirection for a
problem you do not have.

**Should every dependency be injected?**
No. Inject what varies, what is slow, or what has side effects. Constructing a
value object inline is fine.

---

## Check your understanding

<Quiz
question="A Square subclass overrides setWidth to also set height, so that it stays square. It compiles and all its own tests pass. Which principle does it violate, and why does it matter?"
options={[
{
text: 'Liskov substitution — code written against Rectangle produces different results when handed a Square, so the subtype is not substitutable',
correct: true,
why: 'Setting width then height and expecting the area to be width × height holds for Rectangle and fails for Square. Type-checking cannot catch a behavioural contract break.',
},
{text: 'Open/closed, because Rectangle had to be modified', why: 'Rectangle was not modified — Square extends it. The failure is behavioural.'},
{text: 'Single responsibility, because Square does two things', why: 'Square has one responsibility. The problem is that it breaks the inherited contract.'},
{text: 'None — a square is a rectangle, so the model is correct', why: 'True in geometry. A _mutable_ square is not a substitutable mutable rectangle, which is the point of the example.'},
]}
explanation={<>The everyday version is a subclass that throws where the parent does not — <code>ReadOnlyList.add()</code>. If callers need <code>instanceof</code> checks before calling a method, substitution has already failed, and composition was probably the right tool.</>}
reference={{label: 'Liskov substitution', href: '/knowledge-base/architecture/solid#l--liskov-substitution'}}
/>

<Quiz
question="An OrderService constructs `new StripeClient(...)` internally. Tests cannot run without network access. Which principle addresses this, and what is the fix?"
options={[
{
text: 'Dependency inversion — define a PaymentGateway interface owned by OrderService, and pass an implementation in',
correct: true,
why: 'The high-level policy should not depend on a low-level vendor detail. With the interface owned by the service, the Stripe adapter conforms to it, and tests supply a fake.',
},
{text: 'Single responsibility — split payment handling into its own class', why: 'A separate class still constructed internally leaves the same coupling and the same untestability.'},
{text: 'Interface segregation — Stripe’s client has too many methods', why: 'Interface width is not the issue; the hard-coded concrete dependency is.'},
{text: 'Open/closed — OrderService must be modified to change vendor', why: 'A genuine consequence, but the naming of the underlying problem is dependency inversion.'},
]}
explanation={<>Note the distinction the page draws: dependency <em>inversion</em> is the principle, dependency <em>injection</em> is one technique for achieving it. Injecting a concrete class satisfies the technique and not the principle.</>}
reference={{label: 'Dependency inversion', href: '/knowledge-base/architecture/solid#d--dependency-inversion'}}
/>

<Quiz
question="Which of these are misapplications of SOLID rather than correct uses?"
type="multiple"
options={[
{text: 'Creating UserServiceInterface for the single UserService implementation, with no second implementation in prospect', correct: true, why: 'An interface with one implementation adds a file and indirection without adding flexibility.'},
{text: 'Splitting a cohesive Order class into OrderCreator, OrderValidator, OrderNotifier and OrderPersister', correct: true, why: 'Reads SRP as "one method per class" and ignores cohesion — things that change together should stay together.'},
{text: 'Building a plugin architecture before a second plugin exists', correct: true, why: 'Open/closed applied to variation that has not appeared. The rule of three is a better guide.'},
{text: 'Defining a PaymentGateway interface with three payment providers behind it', why: 'A genuine boundary with real variation — exactly what dependency inversion is for.'},
{text: 'Narrowing a twenty-method repository interface so a consumer using two of them depends on only those', why: 'Interface segregation used correctly, and it makes the consumer far easier to test.'},
]}
explanation={<>The recurring failure is applying the principles preemptively. Write the simple version, wait for the pain, then name it with SOLID and fix the specific problem.</>}
reference={{label: 'Where SOLID is weakest', href: '/knowledge-base/architecture/solid#where-solid-is-weakest'}}
/>

<Quiz
question="A Report class has calculateTax(), formatAsPdf() and emailToAccountant(). Why does this violate single responsibility?"
options={[
{
text: 'Three different groups — finance, design and operations — can each require a change to it, so it has three reasons to change',
correct: true,
why: 'SRP is about sources of change, not method count. Distinct stakeholders requesting changes to one class is the definition of multiple responsibilities.',
},
{text: 'Because a class should never have more than two public methods', why: 'There is no method-count rule. A cohesive class with ten related methods can have one responsibility.'},
{text: 'Because formatting and emailing are both I/O', why: 'The kind of operation is not the criterion; who requests the change is.'},
{text: 'It does not — all three concern reports, so it is cohesive', why: 'They share a subject but not a rate or reason for change, which is what SRP measures.'},
]}
explanation={<>The practical test is a question rather than a metric: who asks for this to change? If the answer is consistently one group, the class is fine however many methods it has.</>}
reference={{label: 'Single responsibility', href: '/knowledge-base/architecture/solid#s--single-responsibility'}}
/>

<Quiz
question="A payment function has a switch over 'card' and 'paypal'. A third method is being added. What is the right move?"
options={[
{
text: 'Now extract a PaymentMethod interface — the third case confirms the axis of variation and shows what the abstraction should be',
correct: true,
why: 'The rule of three: two cases may be coincidence, three reveal the pattern. Extracting at this point means the seam matches how the code actually varies.',
},
{text: 'It should have been an interface from the first case', why: 'Abstracting on one example usually produces the wrong seam, because you are guessing at what varies.'},
{text: 'Keep the switch — it is simpler and switches are fine', why: 'Fine at two cases; by the third, every new method means editing tested code, which is the open/closed problem.'},
{text: 'Split the function into three functions, one per payment type', why: 'Moves the branching to the caller without removing it.'},
]}
explanation={<>This sequence — write it simply, feel the pain, name it with SOLID, apply the minimum fix — is what keeps the principles useful rather than turning them into ceremony.</>}
reference={{label: 'Applying them in practice', href: '/knowledge-base/architecture/solid#applying-them-in-practice'}}
/>

---

## References

- [Robert C. Martin: The Principles of OOD](http://butunclebob.com/ArticleS.UncleBob.PrinciplesOfOod)
  — the original collection.
- [Martin Fowler: Bliki](https://martinfowler.com/bliki/) — measured writing on
  when these principles apply and when they do not.
- [Design Patterns](/knowledge-base/architecture/design-patterns) — the concrete
  structures SOLID often points towards.
- [Dependency Injection](/knowledge-base/architecture/dependency-injection) —
  the technique most associated with the D.
- [Clean Architecture](/knowledge-base/architecture/clean-architecture) — the
  same dependency-direction instinct at application scale.
