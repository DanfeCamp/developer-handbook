---
title: 'Dependency Injection'
description: 'Supplying collaborators instead of constructing them — the composition root, containers, lifetimes, and when a plain function argument is enough.'
---

# Dependency Injection

## Introduction

Dependency injection means a class or function **receives what it needs** rather
than creating it.

```ts
// ❌ Constructs its own dependencies
class OrderService {
  private payments = new StripeGateway(process.env.STRIPE_KEY);
  private mailer = new SmtpMailer(process.env.SMTP_URL);
}

// ✅ Receives them
class OrderService {
  constructor(
    private readonly payments: PaymentGateway,
    private readonly mailer: Mailer,
  ) {}
}
```

That is the entire idea. Everything else — containers, decorators, lifetimes,
autowiring — is machinery for doing it at scale.

**The problem it solves.** A class that constructs its own collaborators is
welded to them. You cannot test it without a network, cannot swap the
implementation, and cannot see what it depends on without reading the body. The
second version declares its requirements in its signature, and any caller can
supply whatever satisfies them.

**Two things people conflate:**

- **Dependency injection** — the technique of passing dependencies in.
- **[Dependency inversion](/knowledge-base/architecture/solid#d--dependency-inversion)**
  — the principle that high-level code should depend on abstractions.

You can inject a concrete class and satisfy neither inversion nor much benefit.
Injecting an interface the consumer defines is what makes it inversion.

---

## The Three Forms

**Constructor injection** — the default. Dependencies are required, available
for the object's whole life, and visible in one place.

```ts
class OrderService {
  constructor(private readonly payments: PaymentGateway) {}
}
```

**Method injection** — for a dependency needed by one operation, or one that
varies per call.

```ts
class ReportGenerator {
  generate(orders: Order[], formatter: Formatter): string {
    return formatter.format(orders);
  }
}
```

**Property injection** — a mutable field set after construction. Avoid it: the
object can exist in an invalid state, and nothing enforces that the dependency
was ever supplied. It exists mainly for frameworks that cannot control
construction.

---

## The Composition Root

The single most useful concept here. **One place in the application assembles
the object graph**, and it is as close to the entry point as possible.

```ts title="main.ts"
// Everything is constructed here — and only here.
const db = new Database(config.databaseUrl);
const clock = new SystemClock();

const orderRepository = new PostgresOrderRepository(db);
const payments = new StripeGateway(config.stripeKey);
const mailer = new SesMailer(config.awsRegion);

const orderService = new OrderService(orderRepository, payments, mailer, clock);

const app = createApp({orderService});
app.listen(config.port);
```

Everything downstream receives what it needs and constructs nothing. The
benefits are concrete: one file shows the entire dependency structure, swapping
an implementation is a one-line change, and there is no hidden global state.

**The anti-pattern to avoid** is the service locator — passing the container
around and asking it for things:

```ts
// ❌ Service locator: the dependency is hidden inside the method body
class OrderService {
  place(order: Order) {
    const payments = container.get<PaymentGateway>('payments');
  }
}
```

This looks like DI and inverts nothing. The class's requirements are invisible
in its signature, it now depends on the container itself, and a missing
registration fails at runtime rather than at construction. **If you can only
discover a class's dependencies by reading its body, you have a service
locator.**

---

## Do You Need a Container?

Manual wiring is a real option and often the right one.

```ts
// Perfectly good for a few dozen services
const app = new OrderService(new PostgresOrderRepository(db), new StripeGateway(key));
```

It is explicit, has no magic, needs no library, and fails at compile time.
The cost is verbosity: with two hundred services the composition root becomes
long, and inserting a dependency deep in the graph means threading it through
several constructors.

**A container automates the graph.** You register how to build each thing; it
resolves the rest.

```ts
// tsyringe — decorator-based
@injectable()
class OrderService {
  constructor(
    @inject('PaymentGateway') private payments: PaymentGateway,
    @inject('OrderRepository') private orders: OrderRepository,
  ) {}
}

container.register('PaymentGateway', {useClass: StripeGateway});
const service = container.resolve(OrderService); // graph resolved automatically
```

|               | Manual wiring         | Container                                   |
| ------------- | --------------------- | ------------------------------------------- |
| Explicit      | Fully                 | Registration is explicit; resolution is not |
| Failure mode  | Compile time          | Often runtime                               |
| Boilerplate   | Grows with size       | Constant                                    |
| Debuggability | Trivial               | Requires understanding the container        |
| Good for      | Small and medium apps | Large apps, or frameworks that provide one  |

**Use what your framework provides.** Spring, .NET, NestJS, Laravel and Symfony
all ship containers, and fighting them is pointless. In Node or Go without a
framework container, start with manual wiring and add one when the composition
root becomes genuinely unmanageable.

---

## Lifetimes

Containers let you choose how long an instance lives, and getting this wrong
causes some of the nastiest bugs in server applications.

| Lifetime      | Instances                  | Use for                                 |
| ------------- | -------------------------- | --------------------------------------- |
| **Transient** | A new one every resolution | Stateless, cheap objects                |
| **Scoped**    | One per request            | Anything holding request state          |
| **Singleton** | One per process            | Connection pools, configuration, caches |

**The dangerous mistake is a request-scoped dependency captured by a
singleton.** The singleton is constructed once, holding the first request's
instance forever — so every subsequent request sees the first user's data.

```ts
// ❌ A singleton capturing per-request state
@singleton()
class AuditLogger {
  constructor(private readonly currentUser: CurrentUser) {} // scoped!
}
```

This is exactly the
[DataLoader-shared-across-requests](/knowledge-base/apis/graphql#the-n1-problem)
bug in another form, and it is a genuine data-leak class of defect.

**Database connections are the other trap.** A singleton connection serialises
every request through it; a transient connection opens one per resolution and
exhausts the server. The right answer is a **singleton pool** handing out
connections per request. See
[Data Modelling](/knowledge-base/databases/data-modelling#connection-pooling).

---

## What to Inject

Not everything. Injecting value objects and pure helpers adds ceremony and buys
nothing.

**Inject** what is slow, non-deterministic, or has side effects:

- Databases, HTTP clients, message queues
- Payment gateways, email senders, storage
- **The clock** — `new Date()` inside a class makes it untestable at a
  boundary
- **Randomness and id generation** — same reason
- Configuration
- Loggers

**Do not inject** things that are deterministic and cheap:

```ts
// ✅ Fine to construct inline
const total = new Money(2500, 'GBP');
const slug = slugify(title);
```

The clock is the one people most often miss:

```ts
// ❌ Untestable: the behaviour depends on when the test runs
class Subscription {
  isExpired(): boolean {
    return this.expiresAt < new Date();
  }
}

// ✅ Deterministic
class Subscription {
  isExpired(now: Date): boolean {
    return this.expiresAt < now;
  }
}
```

---

## Functional Dependency Injection

DI is not an object-oriented technique. In a functional codebase, a dependency
is a **function argument** — and this is often the whole solution.

```ts
// The dependency is just a parameter
type SendEmail = (to: string, subject: string, body: string) => Promise<void>;

export function makePlaceOrder(deps: {
  save: (order: Order) => Promise<void>;
  charge: (pence: number) => Promise<Receipt>;
  now: () => Date;
}) {
  return async function placeOrder(input: PlaceOrderInput) {
    const order = createOrder(input, deps.now());
    await deps.charge(order.totalPence);
    await deps.save(order);
    return order;
  };
}

// Composition root
const placeOrder = makePlaceOrder({save: saveToPostgres, charge: chargeStripe, now: () => new Date()});

// Test
const placeOrder = makePlaceOrder({save: fake.save, charge: fake.charge, now: () => fixedDate});
```

No container, no decorators, no interfaces — a closure over its dependencies.
For most TypeScript, Go and Python codebases this is enough, and it is
considerably easier to follow than a container.

**A single-method interface is a function type.** If you find yourself writing
`interface Formatter { format(x: T): string }`, consider
`type Format = (x: T) => string`.

---

## Testing

The main practical payoff.

```ts
it('does not charge when the order is empty', async () => {
  const payments = new FakePaymentGateway();
  const service = new OrderService(new InMemoryOrderRepository(), payments, fixedClock);

  await expect(service.place({items: []})).rejects.toThrow(EmptyOrder);
  expect(payments.charges).toHaveLength(0);
});
```

No network, no database, no framework boot.

**Prefer fakes to mocks.** An `InMemoryOrderRepository` that genuinely stores
and retrieves lets you assert the order can be read back. A mock asserting
`save()` was called stays green when `save()` is broken. See
[Testing](/knowledge-base/testing#test-doubles).

Most frameworks with containers let you override registrations in tests, which
is the cleanest seam available:

```python
# FastAPI: swap a dependency without patching anything
app.dependency_overrides[get_db] = lambda: test_session
```

---

## Do's and Don'ts

### Do

- Prefer constructor injection; make dependencies required and visible.
- Assemble the graph in one composition root at the entry point.
- Inject the clock, randomness and id generation.
- Depend on interfaces at genuine external boundaries.
- Use your framework's container rather than fighting it.
- Prefer fakes to mocks in tests.
- Consider plain function arguments before reaching for a container.

### Don't

- Don't pass the container around — that is a service locator.
- Don't inject value objects and pure helpers.
- Don't capture a request-scoped dependency inside a singleton.
- Don't create an interface for a class with one implementation and no prospect
  of another.
- Don't use property injection where constructor injection works.
- Don't hide dependencies behind global imports or static access.
- Don't add a container to a small application because larger ones use them.

---

## Common Mistakes

**Service locator disguised as DI.** The container is injected, so it looks
right; dependencies are still hidden and still resolved at runtime.

**Constructor over-injection.** Eight or more constructor parameters is a
legitimate smell — usually the class has several responsibilities. Split it
before reaching for a facade that hides the count.

**Singleton capturing scoped state.** The data-leak bug described above, and the
one worth watching for in review.

**Interfaces everywhere.** `IUserService` implemented by `UserService`, forever.
A file and an indirection for no flexibility.

**Injecting the clock inconsistently.** Half the codebase takes a `Clock`, the
other half calls `new Date()`. The tests then pass or fail depending on where
the logic happens to sit.

**Circular dependencies.** A needs B, B needs A. Containers usually detect it
and fail; the fix is not lazy resolution but extracting the shared concern into
C.

---

## FAQ

**Do I need a DI container?**
Not for a small or medium application. Manual wiring in a composition root is
explicit and fails at compile time. Add a container when threading dependencies
becomes genuinely painful, or when your framework provides one.

**Is `new` always wrong?**
No. Constructing value objects, DTOs and pure helpers inline is correct.
`new StripeClient()` inside a service is the problem, not `new` itself.

**How does this relate to inversion of control?**
IoC is the general idea of the framework calling you rather than the reverse. DI
is one form of it.

**Does DI apply to functional programming?**
Yes, and more simply — dependencies are function parameters, and partial
application is the composition root.

**Should everything be behind an interface?**
No. Interfaces earn their place at boundaries you might cross or need to fake.
Internal collaborators can be concrete.

**How many constructor parameters is too many?**
Five or six is worth a look; eight is a strong signal the class does too much.

---

## Check your understanding

<Quiz
question="A class receives the DI container in its constructor and calls container.get('PaymentGateway') inside a method. Why is this not dependency injection?"
options={[
{
text: 'It is a service locator — the real dependency is hidden inside the method body rather than declared in the signature, and the class now depends on the container itself',
correct: true,
why: 'You cannot see what the class needs without reading its implementation, a missing registration fails at runtime rather than construction, and tests must build a container instead of passing a fake.',
},
{text: 'It is DI, just resolved lazily', why: 'Laziness is not the issue. The problem is that requirements are invisible and the container has become a dependency.'},
{text: 'It is fine as long as the container is configured in one place', why: 'Central configuration does not restore visibility of what each class requires.'},
{text: 'It only becomes a problem with more than one container', why: 'The design problem exists with a single container.'},
]}
explanation={<>The diagnostic: if you can only discover a class's dependencies by reading its body rather than its constructor, it is a service locator regardless of what the container is called.</>}
reference={{label: 'The composition root', href: '/knowledge-base/architecture/dependency-injection#the-composition-root'}}
/>

<Quiz
question="A singleton AuditLogger takes a request-scoped CurrentUser in its constructor. What happens in production?"
options={[
{
text: 'The singleton is built once with the first request\'s user and keeps it forever, so every later request is attributed to that user',
correct: true,
why: 'A singleton captures whatever it was constructed with. Holding request-scoped state makes it a cross-request data leak — and the audit log becomes actively misleading.',
},
{text: 'The container throws on the second request', why: 'Some containers detect captive dependencies; many resolve it silently, which is what makes this dangerous.'},
{text: 'CurrentUser is re-resolved on each call automatically', why: 'It is captured at construction. Re-resolution would require injecting a provider or factory instead.'},
{text: 'Nothing, provided AuditLogger is stateless', why: 'It is not stateless — it holds a reference to per-request state.'},
]}
explanation={<>The same shape as sharing a DataLoader across requests, or caching a per-user value in a module-level variable. Where a singleton genuinely needs request state, inject a factory or accessor rather than the value.</>}
reference={{label: 'Lifetimes', href: '/knowledge-base/architecture/dependency-injection#lifetimes'}}
/>

<Quiz
question="Which of these are worth injecting?"
type="multiple"
options={[
{text: 'A payment gateway client', correct: true, why: 'Slow, has real side effects, and must be faked in tests.'},
{text: 'The current time', correct: true, why: 'Ambient and non-deterministic. Reading new Date() inside a class makes its behaviour untestable at boundaries.'},
{text: 'A UUID generator', correct: true, why: 'Non-deterministic, and injecting it lets tests assert on known ids.'},
{text: 'A Money value object constructed from an amount and currency', why: 'Deterministic, cheap and side-effect free. Construct it inline.'},
{text: 'A pure slugify() helper', why: 'A pure function with no I/O. Injecting it adds ceremony with no testability gain.'},
]}
explanation={<>The rule of thumb: inject what is slow, non-deterministic or has side effects. The clock and randomness are the two most commonly missed.</>}
reference={{label: 'What to inject', href: '/knowledge-base/architecture/dependency-injection#what-to-inject'}}
/>

<Quiz
question="A TypeScript service needs one collaborator: something that formats a report as a string. What is the lightest sound approach?"
options={[
{
text: 'Take a function parameter typed as (report: Report) => string — a single-method interface is just a function type',
correct: true,
why: 'It gives the same substitutability with no interface, no class and no container. Tests pass a plain arrow function.',
},
{text: 'Define a Formatter interface, a class implementing it, and register it in a container', why: 'Three artefacts to express one function. Reasonable in a language without first-class functions; unnecessary in TypeScript.'},
{text: 'Import the formatter module directly and call it', why: 'That is a hidden dependency — no seam for tests, and no way to substitute an alternative.'},
{text: 'Use property injection so the formatter can be swapped at runtime', why: 'Allows the object to exist in an invalid state, and nothing enforces that it was ever set.'},
]}
explanation={<>Functional DI — closures over dependencies passed as a plain object of functions — covers most TypeScript, Go and Python codebases without any container at all.</>}
reference={{label: 'Functional dependency injection', href: '/knowledge-base/architecture/dependency-injection#functional-dependency-injection'}}
/>

<Quiz
question="A class has grown to nine constructor parameters. A colleague proposes bundling them into a single `Dependencies` object. Is that the right fix?"
options={[
{
text: 'No — it hides the count without addressing the cause. Nine collaborators usually means the class has several responsibilities and should be split',
correct: true,
why: 'Constructor over-injection is a cohesion signal. Bundling parameters makes the smell invisible while leaving the class doing too much.',
},
{text: 'Yes — fewer parameters is always cleaner', why: 'Parameter count is the symptom being measured; concealing it removes the signal, not the problem.'},
{text: 'Yes, provided the object is typed', why: 'Typing does not change how many things the class coordinates.'},
{text: 'No — it should use a service locator instead', why: 'That hides dependencies entirely, which is strictly worse.'},
]}
explanation={<>A dependencies object is reasonable in functional DI, where the function is genuinely one operation. As a way to make a nine-collaborator class look acceptable, it is avoidance.</>}
reference={{label: 'Common mistakes', href: '/knowledge-base/architecture/dependency-injection#common-mistakes'}}
/>

---

## References

- [Martin Fowler: Inversion of Control Containers and the Dependency Injection Pattern](https://martinfowler.com/articles/injection.html)
  — the article that named the pattern.
- [Mark Seemann: Service Locator is an Anti-Pattern](https://blog.ploeh.dk/2010/02/03/ServiceLocatorisanAnti-Pattern/)
  — the clearest statement of why.
- [Dependency Injection Principles, Practices, and Patterns](https://www.manning.com/books/dependency-injection-principles-practices-patterns)
  — Seemann & van Deursen; the definitive treatment, including lifetimes.
- [FastAPI: Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/) —
  a particularly clean implementation, with test overrides.
- [Laravel: Service Container](https://laravel.com/docs/container) — a
  mainstream framework container.
- [SOLID: Dependency Inversion](/knowledge-base/architecture/solid#d--dependency-inversion)
  — the principle this technique serves.
