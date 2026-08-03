---
title: 'MVC'
description: 'Separating data, presentation and coordination — what each layer owns, why controllers bloat, service layers, and the MVVM/MVP variants.'
---

# MVC

## Introduction

Model-View-Controller separates business data from its presentation and from the
code that coordinates the two.

**The problem it solves.** Without a separation, the code that queries the
database, the code that decides what happens on submit, and the HTML all live
together. Change the markup and you risk the business rules; test the pricing
logic and you have to render a page to do it.

**The three roles:**

- **Model** — the data and the rules that govern it. Knows nothing about HTTP or
  HTML.
- **View** — the presentation. Knows nothing about where the data came from.
- **Controller** — receives input, asks the model to do something, chooses a
  view.

**A necessary caveat.** MVC originated in Smalltalk-80 in 1979 for desktop
interfaces, where the view _observed_ the model directly and updated itself.
Almost nothing on the web works that way. What server frameworks call MVC is
really "Model 2", a request/response variant, and every framework deviates
somewhat.

**So treat MVC as a vocabulary, not a specification.** The value is in the
separation, and the argument about whether a given framework is "really" MVC is
not worth having.

---

## What Each Layer Owns

### Model

The domain: data, relationships, validation and the rules that must hold
regardless of how the data is reached.

```php
class Order extends Model
{
    protected $fillable = ['product_id', 'quantity'];

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function scopePending(Builder $query): void
    {
        $query->where('status', 'pending');
    }

    public function isCancellable(): bool
    {
        return $this->status === 'pending' && $this->placed_at->diffInHours() < 24;
    }
}
```

`isCancellable()` belongs here: it is a fact about an order, true whether asked
by a web request, an API call, a queue worker or a CLI command.

**The model layer is not the same as the ORM.** Many frameworks conflate them,
which is why "fat model" advice leads to 2,000-line classes. An ORM entity maps
rows to objects; the domain model expresses rules. They can be the same class in
a small application and should separate as it grows.

### View

Presentation only. Given data, produce output.

```blade
@foreach ($orders as $order)
  <article>
    <h2>{{ $order->reference }}</h2>
    <p>{{ $order->formattedTotal() }}</p>
    @can('cancel', $order)
      <button>Cancel</button>
    @endcan
  </article>
@endforeach
```

Views should contain loops, conditionals and formatting — nothing else. **A
query in a template is always a mistake**: it is untestable, invisible to
review, and guarantees an
[N+1](/knowledge-base/databases/data-modelling#the-n1-problem).

In a JavaScript application the "view" is your React or Vue component tree. The
same rule applies — see
[Component Design](/knowledge-base/react-js/component-design).

### Controller

Translate a request into an action, and an action into a response. That is all.

```php
class OrderController extends Controller
{
    public function __construct(private readonly OrderService $orders) {}

    public function store(StoreOrderRequest $request)
    {
        $order = $this->orders->create($request->validated(), $request->user());

        return redirect()->route('orders.show', $order);
    }
}
```

A controller should be boring. It knows about HTTP; nothing below it should.

---

## Why Controllers Bloat

The commonest failure in MVC codebases. A controller starts small and
accumulates, because "just add it to the controller" is always the shortest
path.

```php
// ❌ 200 lines: validation, business rules, payment, email, logging
public function store(Request $request)
{
    $validated = $request->validate([...]);

    if ($product->stock < $validated['quantity']) {
        return back()->withErrors(['quantity' => 'Not enough stock']);
    }

    $order = Order::create([...]);
    foreach ($validated['items'] as $item) { /* … */ }

    $charge = $this->stripe->charges()->create([...]);
    Mail::to($request->user())->send(new OrderConfirmation($order));
    Log::info('Order placed', ['id' => $order->id]);

    return redirect()->route('orders.show', $order);
}
```

Everything in there is a reason to change the controller, and none of it can be
tested without an HTTP request.

**What to extract, in order:**

1. **Validation** → a form request or schema object.
2. **Authorisation** → a policy.
3. **Business logic** → a service or action class.
4. **Data access** → the model, or a repository.
5. **Side effects** → queued jobs and events.

```php
// ✅ The controller after extraction
public function store(StoreOrderRequest $request)
{
    $order = $this->orders->place($request->validated(), $request->user());

    return redirect()->route('orders.show', $order);
}
```

The rule to enforce in review: **a controller method should be short enough to
read in one glance, and should contain no `if` statements about business rules.**

---

## The Service Layer

MVC has three layers and most applications need four. The missing one holds
business operations that span several models and do not belong to any of them.

```php
class OrderService
{
    public function __construct(
        private readonly PaymentGateway $payments,
        private readonly OrderRepository $orders,
    ) {}

    public function place(array $input, User $user): Order
    {
        return DB::transaction(function () use ($input, $user) {
            $product = $this->orders->lockProduct($input['product_id']);

            if ($product->stock < $input['quantity']) {
                throw new InsufficientStock($product->sku);
            }

            $order = $this->orders->create($input, $user);
            $product->decrementStock($input['quantity']);

            // Side effects AFTER the transaction commits, via events
            OrderPlaced::dispatch($order);

            return $order;
        });
    }
}
```

The property that makes this worth doing: **the service knows nothing about
HTTP.** No `Request`, no `Response`, no redirects. That means the same operation
can be called from a controller, a queue worker, an Artisan command or a test —
and the test needs no HTTP at all.

**Actions** are the same idea at a finer grain: one class, one public method,
one operation (`PlaceOrder`, `CancelOrder`). They keep classes small at the cost
of more files, and suit codebases where services would otherwise grow to
thirty methods.

---

## Repositories

A repository puts an interface between the domain and data access.

```php
interface OrderRepository
{
    public function findById(string $id): ?Order;
    public function pendingForUser(string $userId): Collection;
    public function save(Order $order): void;
}
```

**Worth it when** you need to swap the data source, you are testing domain logic
without a database, or your ORM's API is leaking through the whole codebase.

**Not worth it when** your ORM already provides a good repository-like API. With
Eloquent or Django's ORM, a repository is often a thin wrapper adding
indirection and nothing else — and `OrderRepository::findById` calling
`Order::find` is ceremony.

Be honest about which situation you are in. A repository over an active-record
ORM, "for testability", usually ends up being mocked in tests that then prove
nothing about the real query.

---

## MVC in Real Frameworks

| Framework   | Model           | View            | Controller              |
| ----------- | --------------- | --------------- | ----------------------- |
| **Laravel** | Eloquent models | Blade templates | Controllers             |
| **Rails**   | Active Record   | ERB views       | Controllers             |
| **Django**  | Models          | Templates       | **Views** (confusingly) |
| **ASP.NET** | POCO classes    | Razor           | Controllers             |
| **Express** | Yours to choose | Yours to choose | Route handlers          |

**Django calls its controllers "views"** and describes itself as MTV
(Model-Template-View). Same separation, different names — a reliable source of
confusion when moving between ecosystems.

**Express supplies none of it.** You get routing and middleware; the structure
is yours to impose. See [Express](/knowledge-base/express#structure).

---

## MVVM, MVP and the Client-Side Variants

| Pattern        | Coordinator     | Characteristic                                              |
| -------------- | --------------- | ----------------------------------------------------------- |
| **MVC**        | Controller      | Controller selects the view; the view may observe the model |
| **MVP**        | Presenter       | The presenter drives a passive view through an interface    |
| **MVVM**       | ViewModel       | The view binds declaratively to observable state            |
| **Flux/Redux** | Reducer + store | Unidirectional: action → reducer → store → view             |

**MVVM** underpins WPF, Android's Jetpack, SwiftUI and Vue: the view binds to
observable properties and updates itself when they change. It is closer to the
original Smalltalk MVC than server-side MVC is.

**React is not MVC**, and forcing the vocabulary onto it causes confusion.
Components are closer to a view plus a view-model; state management is a
separate concern. The useful part that carries over is the separation itself:
presentational components (view), hooks and stores (view-model), API and domain
modules (model).

---

## Testing

The point of the separation is that each layer is testable in isolation.

```php
// Model: pure logic, no database needed
it('is not cancellable after 24 hours', function () {
    $order = new Order(['status' => 'pending', 'placed_at' => now()->subDays(2)]);
    expect($order->isCancellable())->toBeFalse();
});

// Service: business logic, no HTTP
it('rejects an order exceeding available stock', function () {
    $product = Product::factory()->create(['stock' => 1]);

    expect(fn () => app(OrderService::class)->place(['product_id' => $product->id, 'quantity' => 5], $user))
        ->toThrow(InsufficientStock::class);
});

// Controller: the HTTP contract only
it('redirects to the order after creating it', function () {
    actingAs($user)->post('/orders', $valid)->assertRedirect();
});
```

If testing your business logic requires an HTTP request, the logic is in the
wrong layer. That is the single most useful diagnostic MVC gives you.

---

## Do's and Don'ts

### Do

- Keep controllers thin — translate HTTP in, HTTP out.
- Put business operations in services or actions that never import HTTP types.
- Keep views free of queries and business decisions.
- Extract validation into form requests or schema objects.
- Extract authorisation into policies.
- Dispatch side effects as events or queued jobs.
- Test each layer at its own level.

### Don't

- Don't put business logic in controllers.
- Don't query the database from a template.
- Don't let the model layer know about HTTP.
- Don't add a repository over an ORM that already has one, without a reason.
- Don't argue about whether your framework is "really" MVC.
- Don't create a service class that is only a pass-through to a model.
- Don't force MVC vocabulary onto React.

---

## Common Mistakes

**Fat controller.** Everything ends up there because it is the path of least
resistance. Extract in the order above.

**Fat model.** Overcorrecting: a 2,000-line `User` class holding billing,
notifications and reporting. Cross-cutting operations belong in services.

**Anaemic model.** The opposite — models are bare data bags and every rule lives
in services. `isCancellable()` belongs on the order.

**Logic in views.** Untestable, invisible in review, and reliably an N+1.

**Services that only forward.** A class whose every method calls one model
method adds a file and no value.

**Leaking HTTP downwards.** A service taking a `Request` cannot be called from a
queue worker. This is the boundary that matters most.

---

## FAQ

**Where does business logic go — model or service?**
On the model if it is a fact about one entity. In a service if it coordinates
several entities, external systems or transactions.

**Do I need a service layer in a small app?**
No. Controller plus model is fine until controllers start growing. Add the layer
when you feel the need, not before.

**Is MVC outdated?**
The separation is not. The 1979 formulation with observing views does not
describe how the web works, but the underlying idea is in every framework.

**How does this relate to Clean Architecture?**
Clean Architecture takes the same instinct further: dependencies point inwards,
and the framework itself becomes a detail. MVC separates three concerns; Clean
Architecture separates policy from mechanism. See
[Clean Architecture](/knowledge-base/architecture/clean-architecture).

**What about MVC in a React or Vue app?**
The vocabulary maps badly. Use the separation — presentation, state, domain —
without the labels.

---

## Check your understanding

<Quiz
question="A controller action is 180 lines: validation, a stock check, order creation, a Stripe charge, an email and logging. What should be extracted first, and where?"
options={[
{
text: 'Validation into a form request, authorisation into a policy, then the business operation into a service that knows nothing about HTTP',
correct: true,
why: 'Each has a natural home, and the ordering matters: validation and authorisation are framework-supported, and extracting them shrinks the method enough to see the actual operation.',
},
{
text: 'Move it all onto the Order model so the controller stays thin',
why: 'Trades a fat controller for a fat model. A payment charge and an email are not facts about an order entity.',
},
{
text: 'Split it into several controller methods called in sequence',
why: 'The logic is still in the HTTP layer and still untestable without a request.',
},
{
text: 'Leave it — extraction is premature until there is a second caller',
why: 'The second caller is not the trigger. Untestable business logic is already the cost.',
},
]}
explanation={<>The test that tells you it worked: can a queue worker or an Artisan command perform the same operation? If the service takes a <code>Request</code>, it cannot.</>}
reference={{label: 'Why controllers bloat', href: '/knowledge-base/architecture/mvc#why-controllers-bloat'}}
/>

<Quiz
question="Which of these belong on the model rather than in a service?"
type="multiple"
options={[
{text: 'isCancellable() — whether this order may still be cancelled', correct: true, why: 'A fact about one entity, true regardless of who asks. Putting it in a service produces an anaemic model.'},
{text: 'A pending() query scope', correct: true, why: 'A named query over the entity itself.'},
{text: 'formattedTotal() for display', correct: true, why: 'Derived from the entity’s own data — though a presenter or view helper is also reasonable.'},
{text: 'Charging a card and sending a confirmation email', why: 'Coordinates external systems and several entities. That is a service operation.'},
{text: 'Deciding which view template to render', why: 'An HTTP-layer concern. The model must not know views exist.'},
]}
explanation={<>The dividing line: facts about one entity go on the model; operations spanning entities, transactions or external systems go in a service.</>}
reference={{label: 'What each layer owns', href: '/knowledge-base/architecture/mvc#what-each-layer-owns'}}
/>

<Quiz
question="A developer moving from Laravel to Django is confused that Django's 'views' contain controller logic. What is going on?"
options={[
{
text: 'Django uses MTV naming — its "view" is what other frameworks call a controller, and its "template" is the view',
correct: true,
why: 'Same separation, different vocabulary. Django describes itself as Model-Template-View, which trips up almost everyone arriving from another framework.',
},
{text: 'Django genuinely has no controller layer', why: 'It has one; it is simply named differently.'},
{text: 'Django views are presentational and the URL router is the controller', why: 'The router maps URLs to views; the view holds the request-handling logic.'},
{text: 'Django abandoned MVC in favour of a different architecture', why: 'The architecture is the same separation of concerns.'},
]}
explanation={<>This is why the label is worth less than the intent. Frameworks disagree about names and about whether the view observes the model; they agree that data, presentation and coordination should be separate.</>}
reference={{label: 'MVC in real frameworks', href: '/knowledge-base/architecture/mvc#mvc-in-real-frameworks'}}
/>

<Quiz
question="A team adds a repository interface over Eloquent so they can mock it in tests. What is the risk?"
options={[
{
text: 'Tests mock the repository and stop exercising real queries, so query bugs pass tests and fail in production — while the repository adds indirection over an ORM that already provides the same API',
correct: true,
why: 'A repository over an active-record ORM is often a thin pass-through. Mocking it removes the database from tests, which is exactly where query mistakes live.',
},
{text: 'Repositories are always the wrong choice with an ORM', why: 'Too strong. They earn their place when you must swap the data source, or when domain logic should be testable without any persistence.'},
{text: 'It will slow down queries at runtime', why: 'The indirection cost is negligible. The problem is design and test fidelity.'},
{text: 'Eloquent models cannot be returned from an interface', why: 'They can. This is not a technical constraint.'},
]}
explanation={<>Prefer testing against a real database in a container. If a repository exists to enable mocking rather than to abstract a genuine choice of data source, it is usually buying less than it costs.</>}
reference={{label: 'Repositories', href: '/knowledge-base/architecture/mvc#repositories'}}
/>

<Quiz
question="What is the most reliable signal that business logic is in the wrong layer?"
options={[
{
text: 'Testing it requires making an HTTP request',
correct: true,
why: 'If the only way to exercise a rule is through a controller, the rule lives in the HTTP layer — so it cannot be reused by a worker, a CLI command or another entry point.',
},
{text: 'The file is longer than 200 lines', why: 'Length is a weak proxy. A long, cohesive class can be perfectly well placed.'},
{text: 'The class has more than five dependencies', why: 'A useful smell for over-coupling, but it says nothing about which layer the logic belongs in.'},
{text: 'The framework does not provide a service layer by convention', why: 'Most do not. That is a gap to fill, not evidence of misplacement.'},
]}
explanation={<>Turn it into a review question: "could a queue worker call this?" If not, HTTP has leaked into the domain.</>}
reference={{label: 'Testing', href: '/knowledge-base/architecture/mvc#testing'}}
/>

---

## References

- [MDN: MVC](https://developer.mozilla.org/en-US/docs/Glossary/MVC) — a concise
  definition.
- [Martin Fowler: GUI Architectures](https://martinfowler.com/eaaDev/uiArchs.html)
  — the definitive account of MVC, MVP, MVVM and how they differ.
- [Laravel: Controllers](https://laravel.com/docs/controllers) — a mainstream
  server-side implementation.
- [Django: FAQ on MTV](https://docs.djangoproject.com/en/stable/faq/general/#django-appears-to-be-a-mvc-framework-but-you-call-the-controller-the-view-and-the-view-the-template-how-come)
  — the naming, explained by its authors.
- [Patterns of Enterprise Application Architecture](https://martinfowler.com/books/eaa.html)
  — Service Layer, Repository, Domain Model and Active Record.
