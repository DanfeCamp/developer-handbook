---
title: 'Laravel'
description: 'A batteries-included PHP framework — Eloquent, routing, validation, queues, testing and the practices that keep a Laravel application fast and maintainable.'
---

# Laravel

## Introduction

Laravel is PHP's dominant application framework: routing, ORM, validation,
authentication, queues, scheduling, mail, caching, templating and a test suite,
all supplied and all designed to work together.

**The problem it solves.** Express gives you a router and expects you to choose
everything else. Laravel takes the opposite position — it makes those decisions
for you, consistently, so that any Laravel developer can open any Laravel
project and know where things are. For a team shipping a product rather than an
architecture, that is worth a great deal.

**Where it fits.** SaaS applications, admin panels, e-commerce, APIs, and
anything with substantial CRUD and business logic. It scales down to a
side-project and up to a large team.

The cost is that Laravel is opinionated and large. Fighting its conventions is
consistently more expensive than adopting them.

:::note Versions
Written against **Laravel 13**, released 17 March 2026, which requires **PHP
8.3+**. Laravel 13 continues the annual release cadence and adds first-party AI
primitives, JSON:API resources, vector/semantic search support, and
improvements to queues, cache and security.
:::

---

## Core Concepts

### The request lifecycle

```text
public/index.php
  → bootstrap the application container
  → global middleware (trim strings, CORS, maintenance mode)
  → route matching
  → route middleware (auth, throttle, verified)
  → controller / closure
  → response
  → terminable middleware (logging, session write)
```

Almost everything you customise is a middleware, a service provider, or an
event listener. Knowing that ordering is the fastest route to diagnosing "why
did my change not take effect?".

### The service container

Laravel resolves dependencies automatically from type hints:

```php
class OrderController extends Controller
{
    public function __construct(
        private readonly OrderService $orders,
    ) {}

    public function store(StoreOrderRequest $request)
    {
        $order = $this->orders->create($request->validated(), $request->user());
        return new OrderResource($order);
    }
}
```

You never call `new OrderService(...)`. The container inspects the constructor,
builds what is needed, and injects it — which is what makes services swappable
in tests.

Bind interfaces to implementations in a service provider:

```php
public function register(): void
{
    $this->app->bind(PaymentGateway::class, StripeGateway::class);
}
```

### Routing

```php
// routes/web.php — session, cookies, CSRF protection
Route::get('/dashboard', [DashboardController::class, 'index'])
    ->middleware(['auth', 'verified'])
    ->name('dashboard');

// routes/api.php — stateless, token-authenticated, no CSRF
Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('orders', OrderController::class);
});
```

`apiResource` generates the five REST routes in one line. **Named routes
matter**: `route('dashboard')` keeps URLs in one place, so changing a path does
not require finding every hard-coded string.

**Route model binding** turns an id in the URL into a model, with an automatic
404 if it does not exist:

```php
Route::get('/orders/{order}', function (Order $order) {
    return new OrderResource($order); // already loaded, or 404
});
```

---

## Eloquent

Laravel's ORM, and the source of both its best ergonomics and its worst
performance problems.

```php
class Order extends Model
{
    protected $fillable = ['product_id', 'quantity', 'status'];

    protected function casts(): array
    {
        return [
            'placed_at' => 'datetime',
            'metadata' => 'array',
            'total' => 'decimal:2',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function scopePending(Builder $query): void
    {
        $query->where('status', 'pending');
    }
}
```

```php
Order::pending()->latest()->paginate(20);
$order->items()->create(['sku' => 'ABC', 'quantity' => 2]);
```

### The N+1 problem

The single most important thing to know about Eloquent. This looks innocent:

```php
$orders = Order::all();                  // 1 query
foreach ($orders as $order) {
    echo $order->user->name;             // 1 query per order
}
```

At 100 orders that is 101 queries. Eager load instead:

```php
$orders = Order::with('user')->get();              // 2 queries total
$orders = Order::with(['user', 'items.product'])->get();  // nested
$orders = Order::withCount('items')->get();        // count without loading
```

Make it impossible to miss by turning lazy loading into an exception in
development:

```php title="app/Providers/AppServiceProvider.php"
public function boot(): void
{
    Model::preventLazyLoading(! app()->isProduction());
    Model::preventSilentlyDiscardingAttributes(! app()->isProduction());
}
```

Every Laravel application that has ever been slow was slow because of N+1. This
one setting catches it during development instead of in production.

### Other Eloquent habits

- **Use `chunk` or `lazy` for large sets.** `User::all()` on a million rows
  exhausts memory; `User::lazy()->each(...)` streams.
- **`select()` the columns you need** when the table is wide.
- **Mass assignment**: `$fillable` is an allowlist. Without it, a crafted
  request could set `is_admin`.
- **Prefer database-level constraints** — foreign keys, unique indexes — over
  application checks alone. A race condition will defeat the application check.
- **Reach for the query builder or raw SQL** for reporting queries. Eloquent is
  for domain objects, not for aggregation across a million rows.

---

## Validation

Never validate inline in a controller. Use a Form Request, which validates,
authorises, and gives you a typed result:

```php
class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Order::class);
    }

    public function rules(): array
    {
        return [
            'product_id' => ['required', 'uuid', 'exists:products,id'],
            'quantity' => ['required', 'integer', 'min:1', 'max:100'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return ['quantity.max' => 'You cannot order more than 100 units at once.'];
    }
}
```

The controller then receives a request that is already valid and already
authorised. If it fails, Laravel returns a 422 with structured errors for an API
request, or redirects back with errors for a web request — no code required.

`exists:products,id` performs a database check as part of validation, which
removes an entire class of "record not found" branch from your controller.

---

## Authorisation

Two mechanisms, and the distinction matters:

```php
// A Gate — a standalone ability.
Gate::define('view-admin-panel', fn (User $user) => $user->is_admin);

// A Policy — abilities for a model. Auto-discovered by naming convention.
class OrderPolicy
{
    public function view(User $user, Order $order): bool
    {
        return $user->id === $order->user_id;
    }

    public function delete(User $user, Order $order): bool
    {
        return $user->id === $order->user_id && $order->status === 'pending';
    }
}
```

```php
$this->authorize('view', $order);   // throws 403 if denied
@can('delete', $order) ... @endcan  // in Blade
```

**Authorise on the object, not just the route.** A route protected by `auth`
tells you someone is logged in; it says nothing about whether this user may see
_that_ order. See [Authorization](/knowledge-base/security/authorization).

---

## Queues and Scheduling

Anything slow or unreliable belongs outside the request cycle.

```php
class SendOrderConfirmation implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;
    public int $backoff = 60;

    public function __construct(public Order $order) {}

    public function handle(Mailer $mailer): void
    {
        $mailer->to($this->order->user)->send(new OrderConfirmation($this->order));
    }
}

SendOrderConfirmation::dispatch($order);
SendOrderConfirmation::dispatch($order)->delay(now()->addMinutes(5));
```

```bash
php artisan queue:work --tries=3 --max-time=3600
php artisan horizon        # Redis queues with a dashboard
```

**Jobs must be idempotent.** A worker can crash after doing the work but before
marking the job complete, so the job runs again. Design for that.

**Serialise ids, not objects with state.** `ShouldQueue` serialises the model
reference and re-fetches it, which is usually what you want — but a job holding
a large object graph is a slow, fragile job.

```php title="routes/console.php"
Schedule::command('orders:expire')->hourly()->withoutOverlapping();
Schedule::job(new GenerateDailyReport)->dailyAt('02:00');
```

One cron entry runs Laravel's scheduler every minute; everything else is defined
in code. See [Queues](/knowledge-base/operations/queues) and
[Background Workers](/knowledge-base/operations/background-workers).

---

## Setup

```bash
composer create-project laravel/laravel my-app
cd my-app
php artisan key:generate
php artisan migrate

composer run dev     # server, queue worker, logs and Vite together
```

```bash
php artisan make:model Order -mfsc   # migration, factory, seeder, controller
php artisan make:request StoreOrderRequest
php artisan make:policy OrderPolicy --model=Order
php artisan make:job SendOrderConfirmation
php artisan make:test OrderTest --pest

php artisan route:list --path=api
php artisan tinker                   # a REPL with the app booted
```

`php artisan tinker` is genuinely one of Laravel's best features — a REPL with
the full application container available for exploring data and testing logic.

Static analysis is worth adding on day one:

```bash
composer require --dev larastan/larastan phpstan/phpstan
composer require --dev laravel/pint          # opinionated formatter
```

---

## Testing

Laravel's testing story is a large part of why teams choose it.

```php
use function Pest\Laravel\{actingAs, postJson};

it('creates an order for the authenticated user', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();

    actingAs($user)
        ->postJson('/api/orders', [
            'product_id' => $product->id,
            'quantity' => 2,
        ])
        ->assertCreated()
        ->assertJsonPath('data.quantity', 2);

    expect($user->orders()->count())->toBe(1);
});

it('rejects a quantity above the maximum', function () {
    actingAs(User::factory()->create())
        ->postJson('/api/orders', ['product_id' => $id, 'quantity' => 1000])
        ->assertStatus(422)
        ->assertJsonValidationErrors('quantity');
});

it('forbids viewing another user’s order', function () {
    $order = Order::factory()->create();

    actingAs(User::factory()->create())
        ->getJson("/api/orders/{$order->id}")
        ->assertForbidden();
});
```

- **Feature tests against a real database** are the sweet spot. `RefreshDatabase`
  wraps each test in a transaction and rolls back.
- **Factories** generate valid models with one line, so tests state only what
  they care about.
- **Pest** is the modern default; PHPUnit remains fully supported and Pest is
  built on it.
- **Test authorisation explicitly.** A test that another user gets a 403 is
  worth more than most happy-path tests.

---

## Performance

The order in which to look:

1. **N+1 queries.** Enable `preventLazyLoading` and install Telescope or
   Debugbar to see the query count per request. This is nearly always the
   answer.
2. **Missing indexes.** Any column used in a `where`, `join` or `order by`.
   `EXPLAIN` the slow query.
3. **Cache expensive reads.**

   ```php
   $stats = Cache::remember('dashboard:stats', now()->addMinutes(10), fn () =>
       Order::selectRaw('status, count(*) as total')->groupBy('status')->get()
   );
   ```

4. **Move work to queues.** Email, PDF generation, third-party API calls and
   image processing should never block a response.
5. **Cache the framework's own boot work in production:**

   ```bash
   php artisan config:cache
   php artisan route:cache
   php artisan view:cache
   php artisan event:cache
   composer install --no-dev --optimize-autoloader
   ```

   These are **production-only** — `config:cache` in development means `.env`
   changes are silently ignored, which wastes an afternoon at least once per
   career.

6. **Consider Octane** (Swoole/FrankenPHP/RoadRunner) to keep the application
   booted between requests. It is a substantial win and requires care with
   static state and memory leaks.

---

## Do's and Don'ts

### Do

- Enable `preventLazyLoading` outside production.
- Eager load with `with()` whenever you iterate a relationship.
- Use Form Requests for validation and authorisation.
- Use Policies, and authorise the object rather than the route.
- Put slow or unreliable work in queued jobs, and make them idempotent.
- Use factories and feature tests with `RefreshDatabase`.
- Cache config, routes and views in production only.
- Keep controllers thin; put business logic in services or actions.

### Don't

- Don't call `Model::all()` on a large table.
- Don't validate inline in controllers.
- Don't put business logic in Blade templates.
- Don't run `config:cache` in development.
- Don't disable `$fillable` — mass assignment is a real vulnerability.
- Don't use `env()` outside config files; it returns `null` once config is
  cached.
- Don't fight the conventions. Renaming things Laravel expects to find costs
  more than it returns.

---

## Debugging

| Symptom                            | Cause and fix                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Page is slow, database is idle-ish | N+1 queries. Enable `preventLazyLoading`; check Telescope.                                 |
| `env()` returns null in production | Config is cached. Read from `config()`, never `env()`, outside config files.               |
| Changes to `.env` have no effect   | `config:cache` was run. `php artisan config:clear`.                                        |
| 419 Page Expired                   | Missing CSRF token, or an expired session.                                                 |
| "Add [field] to fillable property" | Mass-assignment protection working as intended. Add it, deliberately.                      |
| Queued jobs never run              | No worker running, or it is on a different queue/connection. `queue:work --queue=…`.       |
| Job runs but changes vanish        | Worker holds stale code. Restart workers on every deploy: `queue:restart`.                 |
| Route not found after deploy       | `route:cache` is stale. Re-run it as part of the deploy.                                   |
| 500 with no detail                 | Check `storage/logs/laravel.log`; `APP_DEBUG=false` hides it from the response, correctly. |

```bash
php artisan about            # environment, cache and driver summary
php artisan route:list
php artisan queue:failed
php artisan optimize:clear   # clear every cache at once
```

---

## FAQ

**Laravel or Symfony?**
Laravel optimises for developer speed and convention; Symfony for
configurability and explicitness. Laravel is built on Symfony components, so
this is a question of style rather than capability.

**Blade, Livewire, Inertia or an API plus React?**
Blade for server-rendered pages. **Livewire** for interactivity without leaving
PHP. **Inertia** to write React or Vue components against Laravel routing
without building an API. A separate API plus a JavaScript frontend when the
frontend is a genuinely separate application or you have mobile clients.

**Where does business logic go?**
Not in controllers or models. Service classes or single-purpose Action classes,
called from thin controllers. Models hold relationships, scopes and casts.

**Sanctum or Passport?**
Sanctum for SPA sessions and simple API tokens — nearly always the right answer.
Passport only when you genuinely need a full OAuth2 server.

**Should I upgrade every year?**
Yes, incrementally. Laravel's upgrades are usually a few hours' work with
`laravel-shift` doing the mechanical parts. Skipping three versions is much
harder than doing three annual upgrades.

---

## Check your understanding

<Quiz
question="A dashboard listing 200 orders with their customer names takes 4 seconds. Each individual query is fast. What is almost certainly happening?"
options={[
{
text: 'N+1: one query for the orders and one more per order to load its user, because the relationship was lazy-loaded',
correct: true,
why: 'The signature is many fast queries rather than one slow one. Eager loading with Order::with("user") collapses 201 queries into 2.',
},
{text: 'A missing index on the orders table', why: 'That would make individual queries slow. The premise says each one is fast.'},
{text: 'Blade rendering is slow with 200 rows', why: 'Rendering 200 rows is single-digit milliseconds.'},
{text: 'The database connection is being re-established per query', why: 'Laravel reuses one connection per request.'},
]}
explanation={<>Set <code>Model::preventLazyLoading(! app()-&gt;isProduction())</code> in a service provider so this throws during development rather than shipping.</>}
reference={{label: 'The N+1 problem', href: '/knowledge-base/laravel#the-n1-problem'}}
/>

<Quiz
question="After deploying, `env('STRIPE_KEY')` returns null in a service class, though the variable is set on the server. Why?"
options={[
{
text: 'php artisan config:cache was run — once config is cached, env() returns null everywhere except config files',
correct: true,
why: 'Config caching compiles all config into one file and stops loading .env at runtime. Values must be read via config(), which resolves from the compiled cache.',
},
{text: 'The .env file has the wrong permissions', why: 'That would produce a startup failure rather than a single null value.'},
{text: 'Environment variables must be prefixed APP_ to be readable', why: 'No such requirement exists.'},
{text: 'env() only works in controllers', why: 'It works anywhere — until config is cached, which is exactly the point.'},
]}
explanation={<>The rule: <code>env()</code> belongs only in <code>config/*.php</code>. Everywhere else, read <code>config('services.stripe.key')</code>. This bites almost everyone once.</>}
reference={{label: 'Debugging', href: '/knowledge-base/laravel#debugging'}}
/>

<Quiz
question="Which of these are correct places for logic in a Laravel application?"
type="multiple"
options={[
{text: 'Validation rules in a Form Request', correct: true, why: 'Form Requests validate and authorise before the controller runs, and return a 422 or a redirect automatically.'},
{text: 'Per-model permission checks in a Policy', correct: true, why: 'Policies answer "may this user act on this record?" — which a route middleware cannot.'},
{text: 'Business logic in a service or action class called from a thin controller', correct: true, why: 'Keeps logic reusable from queue jobs and Artisan commands, and unit-testable without HTTP.'},
{text: 'Database queries inside Blade templates', why: 'Guarantees N+1 queries and makes the logic untestable. Pass prepared data to the view.'},
{text: 'Authorisation checks only in route middleware', why: 'Middleware confirms someone is logged in. It cannot know whether this user owns that order.'},
]}
explanation={<>Laravel supplies a place for each concern. Most Laravel codebases that become unmaintainable did so by putting all of it in controllers.</>}
reference={{label: 'Validation', href: '/knowledge-base/laravel#validation'}}
/>

<Quiz
question="A queued job sends a confirmation email. Occasionally customers receive it twice. What is the most likely cause and correct fix?"
options={[
{
text: 'The worker crashed or timed out after sending but before marking the job complete, so it was retried — the job must be made idempotent',
correct: true,
why: 'Queues guarantee at-least-once delivery. Any job with an external side effect must record that it did the work and check before repeating it.',
},
{text: 'The job was dispatched twice from the controller', why: 'Possible, but the recurring-under-load pattern points at retry semantics rather than a duplicated dispatch.'},
{text: 'tries should be set to 1 so it never retries', why: 'That trades duplicates for lost emails when a transient failure occurs. Idempotency lets you keep retries.'},
{text: 'The queue driver should be changed to sync', why: 'Running jobs synchronously defeats the purpose of queueing and does not remove the failure mode.'},
]}
explanation={<>The same reasoning applies to webhooks and payment calls: at-least-once delivery is the norm, so the receiver must be safe to run twice.</>}
reference={{label: 'Queues and scheduling', href: '/knowledge-base/laravel#queues-and-scheduling'}}
/>

<Quiz
question="A route is protected by the `auth` middleware, and the controller loads an order by id from the URL. What is still missing?"
options={[
{
text: 'Authorisation — auth proves who the user is, but nothing checks that this order belongs to them',
correct: true,
why: 'This is a broken-object-level-authorisation vulnerability: any authenticated user can read any order by changing the id. A Policy plus $this->authorize("view", $order) fixes it.',
},
{text: 'Nothing — the auth middleware covers it', why: 'Authentication and authorisation are different questions. auth answers only the first.'},
{text: 'Route model binding, which would validate ownership automatically', why: 'Binding loads the model or 404s. It knows nothing about ownership.'},
{text: 'CSRF protection', why: 'Relevant to state-changing web requests, not to whether a user may read this record.'},
]}
explanation={<>Broken object-level authorisation is consistently the top entry in the OWASP API Security Top 10. Policies exist precisely for this, and returning 404 rather than 403 additionally avoids confirming that the record exists.</>}
reference={{label: 'Authorisation', href: '/knowledge-base/laravel#authorisation'}}
/>

---

## References

- [Laravel documentation](https://laravel.com/docs) — comprehensive and
  genuinely well written.
- [Laravel 13 release notes](https://laravel.com/docs/13.x/releases) — what
  changed, and the upgrade guide.
- [Eloquent relationships](https://laravel.com/docs/eloquent-relationships) —
  eager loading and the N+1 fix.
- [Authorization](https://laravel.com/docs/authorization) — gates and policies.
- [Queues](https://laravel.com/docs/queues) — workers, retries, failed jobs.
- [Pest](https://pestphp.com/) — the modern testing syntax.
- [Larastan](https://github.com/larastan/larastan) — static analysis that
  understands Laravel's magic.
