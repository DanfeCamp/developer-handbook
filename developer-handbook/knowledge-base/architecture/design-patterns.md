---
title: 'Design Patterns'
description: 'Named solutions to recurring design problems — the ones worth knowing, the ones languages have absorbed, and how to avoid pattern-driven over-engineering.'
---

# Design Patterns

## Introduction

A design pattern is a named, reusable solution to a problem that keeps
recurring. The term comes from _Design Patterns_ (1994) by the "Gang of Four",
which catalogued twenty-three of them from C++ and Smalltalk practice.

**What they are genuinely for.** Two things:

1. **Vocabulary.** "Wrap it in an adapter" communicates a whole design in three
   words. That is most of the value.
2. **Recognition.** When you meet a problem you have seen before, you know what
   worked.

**What they are not.** A checklist, a quality metric, or a goal. Code is not
better for containing patterns, and a codebase where every class is a Factory,
Strategy or Visitor is usually harder to read than one written plainly.

:::note Many patterns are workarounds for missing language features
Several Gang of Four patterns exist because C++ in 1994 lacked first-class
functions, closures and reflection. In a language with them, **Strategy is a
function**, **Command is a closure**, and **Iterator is a `for…of` loop**.
Recognising which patterns your language has absorbed prevents a great deal of
unnecessary ceremony.
:::

---

## The Patterns Worth Knowing

Ordered by how often they earn their place in modern application code.

### Strategy

Encapsulate interchangeable algorithms so the caller picks one.

```ts
// In a language with first-class functions, this is a function type.
type PricingRule = (basePence: number, customer: Customer) => number;

const standard: PricingRule = (base) => base;
const loyaltyDiscount: PricingRule = (base) => Math.round(base * 0.9);
const bulk: PricingRule = (base, c) => (c.orderCount > 100 ? base * 0.8 : base);

function quote(base: number, customer: Customer, rule: PricingRule) {
  return rule(base, customer);
}
```

The classic object-oriented form — an interface plus a class per algorithm —
is still right when a strategy needs several methods or its own state. For one
operation, a function is the same pattern with less code.

**Use it when** a `switch` over behaviour keeps growing. See
[Open/Closed](/knowledge-base/architecture/solid#o--openclosed).

### Adapter

Make an incompatible interface fit the one you need.

```ts
// Your application defines what it wants…
interface PaymentGateway {
  charge(pence: number, reference: string): Promise<Receipt>;
}

// …and the adapter makes a third-party SDK conform.
class StripeAdapter implements PaymentGateway {
  constructor(private readonly stripe: Stripe) {}

  async charge(pence: number, reference: string): Promise<Receipt> {
    const intent = await this.stripe.paymentIntents.create({
      amount: pence,
      currency: 'gbp',
      metadata: {reference},
    });
    return {id: intent.id, status: intent.status === 'succeeded' ? 'ok' : 'failed'};
  }
}
```

The most consistently useful pattern in application code. Every external
dependency — payments, email, storage, search — should sit behind one, which is
what makes vendors replaceable and code testable.

### Repository

Put an interface between the domain and data access. Covered in
[MVC](/knowledge-base/architecture/mvc#repositories), including when it is not
worth it over an active-record ORM.

### Factory

Encapsulate construction when it is non-trivial or when the concrete type is
chosen at runtime.

```ts
function createStorage(config: Config): Storage {
  switch (config.driver) {
    case 's3': return new S3Storage(config.bucket);
    case 'local': return new LocalStorage(config.path);
    case 'memory': return new InMemoryStorage();
  }
}
```

**Do not add a factory for `new Thing()`.** A factory that only calls a
constructor is a file and an indirection with nothing in between.

### Decorator

Add behaviour by wrapping, without modifying the wrapped object.

```ts
class LoggingGateway implements PaymentGateway {
  constructor(
    private readonly inner: PaymentGateway,
    private readonly log: Logger,
  ) {}

  async charge(pence: number, reference: string) {
    this.log.info({pence, reference}, 'charging');
    const receipt = await this.inner.charge(pence, reference);
    this.log.info({receiptId: receipt.id}, 'charged');
    return receipt;
  }
}

// Compose: logging around retries around the real thing
const payments = new LoggingGateway(new RetryingGateway(new StripeAdapter(stripe)), logger);
```

Excellent for cross-cutting concerns — logging, retries, caching, metrics,
circuit breaking — because each concern stays in its own class and they compose
in any order.

### Observer

Notify interested parties when something happens, without the publisher knowing
who they are.

```ts
emitter.on('order.placed', sendConfirmationEmail);
emitter.on('order.placed', updateInventory);
emitter.on('order.placed', notifyWarehouse);

emitter.emit('order.placed', order);
```

Built into most platforms — DOM events, Node's `EventEmitter`, framework event
systems. It decouples effectively and makes control flow harder to follow, so
keep the event set small and named clearly. See
[Event-Driven Architecture](/knowledge-base/architecture/event-driven).

### Builder

Construct an object step by step when there are many optional parameters.

```ts
const query = new QueryBuilder('orders')
  .where('status', 'pending')
  .whereBetween('placed_at', from, to)
  .orderBy('placed_at', 'desc')
  .limit(20)
  .build();
```

Query builders and HTTP client builders are the everyday examples. In languages
with named or default arguments, an options object usually replaces it.

### Facade

One simple interface over a complicated subsystem.

```ts
class Checkout {
  // Hides inventory, pricing, tax, payment and fulfilment behind one call.
  async complete(cart: Cart, customer: Customer): Promise<Order> { /* … */ }
}
```

Useful for giving callers a small surface. It becomes a problem when the facade
grows into a god object that does everything.

### Singleton — with a warning

One instance, globally accessible.

```ts
// ❌ The classic implementation
class Config {
  private static instance: Config;
  static getInstance() {
    return (Config.instance ??= new Config());
  }
}
```

**This is the most over-used and most regretted pattern.** It is global mutable
state with a design-pattern name: dependencies become invisible, tests leak into
each other, and parallel tests interfere.

The legitimate need — one database pool, one configuration object — is better
met by **constructing it once in the composition root and injecting it**. You
get single-instance behaviour without global access. See
[Dependency Injection](/knowledge-base/architecture/dependency-injection#the-composition-root).

---

## Patterns Your Language May Have Absorbed

| Pattern              | Modern equivalent                                    |
| -------------------- | ---------------------------------------------------- |
| **Strategy**         | A function passed as an argument                     |
| **Command**          | A closure, or a plain object dispatched to a queue   |
| **Iterator**         | `for…of`, generators, `IEnumerable`                  |
| **Observer**         | Built-in events, signals, reactive streams           |
| **Template Method**  | A higher-order function taking the varying step      |
| **Prototype**        | `structuredClone`, spread syntax                     |
| **Visitor**          | Pattern matching over a discriminated union          |
| **Singleton**        | A module-level constant, or a container registration |
| **Abstract Factory** | Often just a function returning an interface         |

Writing a `Strategy` interface with one method in TypeScript, when
`type Strategy = (x: T) => U` says the same thing, is the most common example of
applying a pattern past its usefulness.

---

## Architectural Patterns

Larger-scale patterns that come up constantly in application design, and are not
from the Gang of Four:

- **Service Layer** — business operations above the domain, free of HTTP. See
  [MVC](/knowledge-base/architecture/mvc#the-service-layer).
- **Unit of Work** — track changes and commit them as one transaction; what an
  ORM session does.
- **Data Mapper vs Active Record** — is persistence a separate concern
  (Doctrine, SQLAlchemy) or a method on the entity (Eloquent, Rails)?
- **CQRS** — separate the write model from the read model. Powerful for
  complex reporting, and considerable overhead otherwise.
- **Event Sourcing** — store events rather than current state, and derive state
  by replaying. Excellent audit properties, genuinely hard to operate.
- **Saga** — coordinate a transaction across services with compensating actions.
  See [Microservices](/knowledge-base/architecture/microservices).
- **Circuit Breaker** — stop calling a failing dependency so it can recover, and
  so you fail fast instead of hanging.
- **Outbox** — write the event to your database in the same transaction as the
  state change, then publish from there. The standard fix for "the database
  committed but the message was lost".

---

## Using Patterns Well

**Recognise, do not impose.** Patterns describe solutions that emerged from real
problems. Starting from "which pattern should I use?" produces designs that fit
the pattern rather than the problem.

**The rule of three.** Write it directly. Duplicate. On the third occurrence,
the shape is clear enough to abstract — and the abstraction will be the right
one, because you have seen three real examples rather than imagined them.

**Name things after the domain, not the pattern.** `PricingRule` is better than
`PricingStrategyImpl`. The pattern is how it works; the name should say what it
is for.

**Prefer the simplest thing that expresses the intent.** A function beats a
class implementing a one-method interface. A `switch` with two cases beats a
strategy hierarchy.

**Pattern-driven over-engineering has a recognisable smell**: an interface per
class, a factory per interface, an abstract base with one subclass, and six
files to follow for a change that should have been three lines.

---

## Do's and Don'ts

### Do

- Use patterns as vocabulary for communicating a design.
- Put an adapter in front of every external dependency.
- Use decorators for cross-cutting concerns like retries and logging.
- Extract an abstraction on the third occurrence.
- Name classes after their domain role.
- Prefer a function where your language supports it.

### Don't

- Don't set out to use a pattern.
- Don't use Singleton — inject a single instance instead.
- Don't add a factory that only calls a constructor.
- Don't build a Strategy interface for one implementation.
- Don't suffix everything with `Impl`, `Manager` or `Helper`.
- Don't reach for CQRS or Event Sourcing without a specific reason.
- Don't use inheritance where composition works — most patterns favour
  composition.

---

## FAQ

**Are design patterns outdated?**
The catalogue is dated; the vocabulary is not. Several patterns have been
absorbed into languages, and Adapter, Decorator, Strategy and Repository remain
in daily use.

**Which should I learn first?**
Adapter, Strategy, Decorator, Repository and Factory cover most application
code. Learn Singleton so you can recognise and avoid it.

**Is MVC a design pattern?**
An architectural pattern rather than a Gang of Four one. Different scale, same
idea of a named recurring solution. See [MVC](/knowledge-base/architecture/mvc).

**How do I know I am over-using them?**
Count the files you must open to follow one request. If the answer is six and
the logic is simple, the indirection is not paying.

**Are patterns a substitute for good modelling?**
No. A well-named, badly modelled domain is still badly modelled. Patterns
organise a design; they do not supply one.

**Do functional languages use patterns?**
Yes, with different names — higher-order functions, partial application,
functors, monads. The Gang of Four catalogue is specifically object-oriented.

---

## Check your understanding

<Quiz
question="A TypeScript codebase defines `interface Formatter { format(x: Report): string }` with three implementing classes. What is the lighter equivalent?"
options={[
{
text: 'A function type — `type Format = (x: Report) => string` — with three functions. This is Strategy, expressed with the language feature the pattern originally worked around',
correct: true,
why: 'Strategy exists because C++ lacked first-class functions. Where they exist, a single-method interface and its implementing classes are three extra artefacts for the same substitutability.',
},
{text: 'An abstract base class with three subclasses', why: 'More coupling, not less — and inheritance where composition already works.'},
{text: 'A single class with a switch over a format enum', why: 'That reintroduces the open/closed problem the strategy was solving.'},
{text: 'Nothing lighter exists; the interface is required for polymorphism', why: 'A function type provides exactly the same substitutability in TypeScript.'},
]}
explanation={<>The object-oriented form still earns its place when a strategy needs several methods or holds state. For one operation, the function is the pattern.</>}
reference={{label: 'Patterns your language may have absorbed', href: '/knowledge-base/architecture/design-patterns#patterns-your-language-may-have-absorbed'}}
/>

<Quiz
question="Why is Singleton generally regarded as the pattern to avoid?"
options={[
{
text: 'It is global mutable state with a respectable name — dependencies become invisible, and state leaks between tests',
correct: true,
why: 'A class calling Config.getInstance() does not declare that dependency anywhere, and the shared instance persists across tests, making them order-dependent and parallel-hostile.',
},
{text: 'Creating one instance is a performance problem', why: 'A single instance is usually the performance-conscious choice. The objection is to global access, not to singularity.'},
{text: 'It cannot be implemented safely in most languages', why: 'It is easy to implement. The problem is what it does to the rest of the design.'},
{text: 'It violates the single responsibility principle', why: 'It arguably does — managing its own lifecycle — but the practical harm is hidden dependencies and test pollution.'},
]}
explanation={<>The legitimate requirement (one connection pool, one config object) is met by constructing it once in the composition root and injecting it. Single instance, no global access.</>}
reference={{label: 'Singleton', href: '/knowledge-base/architecture/design-patterns#singleton--with-a-warning'}}
/>

<Quiz
question="Which of these are appropriate uses of the Decorator pattern?"
type="multiple"
options={[
{text: 'Adding retry behaviour around a payment gateway', correct: true, why: 'A cross-cutting concern kept in its own class, composable with others in any order.'},
{text: 'Adding structured logging around an external client', correct: true, why: 'Keeps logging out of the business implementation while preserving the interface.'},
{text: 'Adding a caching layer in front of a repository', correct: true, why: 'The consumer sees the same interface; caching becomes an independently testable wrapper.'},
{text: 'Adding a new field to a domain entity', why: 'That is just changing a class. Decorator wraps behaviour behind an interface.'},
{text: 'Combining three unrelated services into one class for convenience', why: 'That is a facade at best, and a god object at worst.'},
]}
explanation={<>The composability is the point: <code>new Logging(new Retrying(new Real()))</code> lets each concern be written, tested and reordered independently.</>}
reference={{label: 'Decorator', href: '/knowledge-base/architecture/design-patterns#decorator'}}
/>

<Quiz
question="A reviewer sees a codebase where every class has an interface, every interface has a factory, and every abstract base has exactly one subclass. What is the diagnosis?"
options={[
{
text: 'Pattern-driven over-engineering — indirection added ahead of any variation that would justify it',
correct: true,
why: 'Patterns solve problems that have appeared. Applied preemptively they multiply files and make a simple change require opening six of them.',
},
{text: 'A correctly SOLID codebase', why: 'SOLID is a diagnostic vocabulary, not a mandate to abstract everything — its own guidance warns against exactly this.'},
{text: 'Good preparation for future requirements', why: 'Speculative abstractions usually guess the wrong seam, and then must be dismantled before the real variation can be added.'},
{text: 'Normal for any large codebase', why: 'Large codebases need abstraction where things vary, not uniformly.'},
]}
explanation={<>A practical measure: count the files you must open to follow one request. Six files for simple logic means the indirection is costing more than it returns.</>}
reference={{label: 'Using patterns well', href: '/knowledge-base/architecture/design-patterns#using-patterns-well'}}
/>

<Quiz
question="A service writes an order to the database and then publishes an 'order.placed' message to a queue. Occasionally the row exists but no message was published. Which pattern addresses this?"
options={[
{
text: 'Outbox — write the event into a table in the same transaction as the state change, then publish from that table',
correct: true,
why: 'The database commit and the message publish are two separate systems; a crash between them loses the message. Writing both atomically to one database, then relaying, removes the gap.',
},
{text: 'Circuit Breaker', why: 'That stops calling a failing dependency. It does not make a write and a publish atomic.'},
{text: 'Saga', why: 'Coordinates a multi-service transaction with compensating actions — a different problem, though often used alongside an outbox.'},
{text: 'Retry the publish in a finally block', why: 'The process can die before the finally runs, and a retry loop after commit still has an unprotected window.'},
]}
explanation={<>This is the dual-write problem, and it appears whenever a state change must be accompanied by a message. The outbox is the standard answer, and it pairs with idempotent consumers.</>}
reference={{label: 'Architectural patterns', href: '/knowledge-base/architecture/design-patterns#architectural-patterns'}}
/>

---

## References

- [Refactoring Guru: Design Patterns](https://refactoring.guru/design-patterns)
  — clear explanations with examples in several languages.
- [Design Patterns](https://en.wikipedia.org/wiki/Design_Patterns) — the Gang of
  Four catalogue, for historical context.
- [Martin Fowler: Patterns of Enterprise Application Architecture](https://martinfowler.com/eaaCatalog/)
  — Service Layer, Unit of Work, Data Mapper, Active Record.
- [microservices.io patterns](https://microservices.io/patterns/) — Saga,
  Outbox, Circuit Breaker, CQRS.
- [SOLID Principles](/knowledge-base/architecture/solid) — the principles these
  patterns often express.
