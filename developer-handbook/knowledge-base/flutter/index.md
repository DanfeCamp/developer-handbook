---
title: 'Flutter'
description: 'Building cross-platform apps from a single Dart codebase — widgets, state management, layout, navigation, performance and release.'
---

# Flutter

## Introduction

Flutter takes a different approach to cross-platform development from React
Native: instead of mapping to native widgets, it ships **its own rendering
engine** and draws every pixel itself.

**What that buys you.** Identical UI on every platform, complete control over
appearance, smooth animation, and no dependency on what widgets a platform
happens to provide. A Flutter app looks the same on iOS, Android, web, Windows,
macOS and Linux because it is the same code drawing the same pixels.

**What it costs.** A larger binary (an empty app starts around 5 MB), UI that
does **not** automatically inherit platform conventions unless you ask for them,
and a separate language — Dart — to learn.

**The framework's central idea:** everything is a widget. Layout, padding,
styling, gesture handling, even the app itself. You compose behaviour by
nesting widgets rather than by setting properties, which is why Flutter code
nests deeply and why the tooling works hard to make that readable.

:::note Versions
Written against **Flutter 3.44** with **Dart 3.12**, released at Google I/O 2026. Impeller is the rendering engine on iOS and is completing its Android
migration; Skia remains the fallback.
:::

---

## Core Concepts

### Everything is a widget

Widgets are immutable descriptions of part of the UI. Flutter builds a widget
tree, turns it into an element tree (which persists across rebuilds), and from
that a render tree that does layout and painting. Rebuilding a widget is cheap
because it is only a description — the same insight as React's virtual DOM.

```dart
class Greeting extends StatelessWidget {
  const Greeting({super.key, required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 12,
        children: [
          Text('Hello, $name', style: Theme.of(context).textTheme.headlineSmall),
          FilledButton(
            onPressed: () {},
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }
}
```

Note `Padding` as a _widget_ rather than a property. This composition style is
the biggest adjustment coming from CSS.

### Stateless and stateful

```dart
// No mutable state — rebuilt when its inputs change.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product});
  final Product product;

  @override
  Widget build(BuildContext context) => Text(product.name);
}

// Holds state across rebuilds.
class Counter extends StatefulWidget {
  const Counter({super.key});
  @override
  State<Counter> createState() => _CounterState();
}

class _CounterState extends State<Counter> {
  int _count = 0;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: () => setState(() => _count++), // marks it dirty; triggers rebuild
      child: Text('$_count'),
    );
  }
}
```

`setState` does not mutate anything by itself — it tells the framework this
element needs rebuilding. Mutating a field without `setState` changes the data
and never updates the screen, which is the Flutter equivalent of mutating React
state in place.

**Use `const` constructors wherever possible.** A `const` widget is not rebuilt
at all, which is the cheapest performance win in Flutter and why the linter
pushes it so hard.

### BuildContext

`BuildContext` is the widget's position in the tree, and it is how you reach
inherited data:

```dart
Theme.of(context).colorScheme.primary
MediaQuery.sizeOf(context).width
Navigator.of(context).push(...)
```

The classic error — _"No MaterialApp widget found"_ or a `Navigator` operation
that does nothing — is almost always using a context from **above** the widget
that provides what you asked for. Extracting the calling code into its own
widget, or using a `Builder`, gives you a context lower in the tree.

### Layout

Layout is a single pass: **constraints go down, sizes come up, the parent sets
the position.** A widget is told how big it may be, chooses a size within that,
and the parent places it.

Once that clicks, most layout errors become obvious:

| Widget                  | Role                                            |
| ----------------------- | ----------------------------------------------- |
| `Column` / `Row`        | Lay children out on an axis                     |
| `Expanded` / `Flexible` | Take a share of remaining space in a Column/Row |
| `Stack` / `Positioned`  | Overlap children                                |
| `Container`             | Padding, margin, decoration, sizing in one      |
| `SizedBox`              | Fixed size, or a gap                            |
| `ListView.builder`      | A lazily built, scrolling list                  |
| `SafeArea`              | Inset for notches and system bars               |

The most-hit error is **"unbounded constraints"** — putting a `ListView` inside
a `Column`, where the Column offers infinite height and the ListView wants all
of it. Wrap it in `Expanded`.

### Material and Cupertino

Flutter ships two design systems: `material` (Android/Material 3) and
`cupertino` (iOS). Using Material everywhere is a perfectly normal choice and
what most apps do — an app with its own brand does not need to look like stock
iOS.

```dart
MaterialApp(
  theme: ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
    useMaterial3: true,
  ),
  darkTheme: ThemeData.dark(useMaterial3: true),
  home: const HomePage(),
);
```

`ColorScheme.fromSeed` generates a full accessible palette from one colour,
which is the fastest route to a coherent theme.

---

## Setup

```bash
# Install the SDK, then verify the whole toolchain
flutter doctor -v

flutter create my_app
cd my_app
flutter run                 # pick a device; hot reload is on by default
flutter run -d chrome       # web
```

`flutter doctor` is the first thing to run whenever anything is wrong — it
checks Xcode, Android SDK, licences and device connections, and its output is
usually the answer.

**Hot reload** (`r`) injects changed code and preserves state — this is
Flutter's best-loved feature. **Hot restart** (`R`) rebuilds and discards state.
Changes to `main()`, global state or `initState` need a restart.

```yaml title="pubspec.yaml"
name: my_app
environment:
  sdk: ^3.12.0

dependencies:
  flutter:
    sdk: flutter
  go_router: ^16.0.0
  riverpod: ^3.0.0
  dio: ^5.7.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0
  build_runner: ^2.4.0
```

Dart uses caret constraints like npm, and `pubspec.lock` should be committed
for applications. Packages come from [pub.dev](https://pub.dev), where the
scores and "Dart 3 compatible" badges are genuinely useful for judging whether
something is maintained.

---

## State Management

Flutter's built-in tools cover more than people expect:

- **`setState`** — local, ephemeral state. Correct far more often than the
  ecosystem discourse suggests.
- **`InheritedWidget`** — passing data down the tree; the mechanism `Theme.of`
  and `MediaQuery.of` use.
- **`ValueNotifier` + `ValueListenableBuilder`** — a single observable value,
  no dependencies.

Beyond that, the mainstream choices:

| Package      | Character                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **Riverpod** | Compile-safe, testable, no `BuildContext` needed. The common recommendation for new projects.  |
| **Bloc**     | Explicit events and states. Verbose, and excellent for complex flows that need an audit trail. |
| **Provider** | Simpler, older, still widely used. Riverpod is effectively its successor.                      |
| **signals**  | Fine-grained reactivity, newer.                                                                |

```dart
// Riverpod: a provider is a testable, overridable unit.
final ordersProvider = FutureProvider<List<Order>>((ref) async {
  return ref.watch(apiClientProvider).fetchOrders();
});

class OrdersPage extends ConsumerWidget {
  const OrdersPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(ordersProvider);

    return orders.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => ErrorView(error: error),
      data: (items) => ListView.builder(
        itemCount: items.length,
        itemBuilder: (context, i) => OrderTile(order: items[i]),
      ),
    );
  }
}
```

The `when` pattern is worth noting: it forces you to handle loading and error
states, which is exactly the discipline web codebases usually lack.

**Separate ephemeral from app state.** Whether a dropdown is open is
`setState`. The current user is a provider. Reaching for a state management
library for the first is how Flutter code becomes unreadable.

---

## Navigation

**`go_router`** is the official recommendation for anything beyond a couple of
screens. It is declarative, URL-based, and handles deep links and web URLs
properly:

```dart
final router = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (context, state) => const HomePage()),
    GoRoute(
      path: '/product/:id',
      builder: (context, state) => ProductPage(id: state.pathParameters['id']!),
    ),
    ShellRoute(
      builder: (context, state, child) => AppScaffold(child: child),
      routes: [
        GoRoute(path: '/orders', builder: (context, state) => const OrdersPage()),
      ],
    ),
  ],
  redirect: (context, state) {
    final loggedIn = authService.isLoggedIn;
    if (!loggedIn && state.matchedLocation != '/login') return '/login';
    return null;
  },
);

MaterialApp.router(routerConfig: router);
```

The imperative `Navigator.push` API still works and is fine for a modal or a
one-off detail screen. Use a router for the application's actual structure —
deep linking and browser back on web are effectively free once you do.

---

## Performance

Flutter is fast by default; the standard problems are self-inflicted.

**Always profile in profile mode.** Debug builds are dramatically slower and
tell you nothing useful:

```bash
flutter run --profile
```

**Use `const` constructors.** A `const` widget subtree is skipped entirely
during rebuild. `flutter_lints` flags missing ones — do not ignore them.

**Keep rebuilds small.** Calling `setState` on a large widget rebuilds
everything below it. Extract the changing part into its own widget so only that
subtree rebuilds.

**Use `ListView.builder`, never a `ListView` with `children:`** for long lists —
the builder form constructs items lazily as they scroll into view.

**Avoid expensive work in `build`.** It runs on every frame during an
animation. Compute in `initState`, memoise, or move it to a provider.

**Watch for jank from images.** Decode large images at a display size with
`cacheWidth`/`cacheHeight`, and use `cached_network_image` for remote assets.

Use **DevTools** to see what is actually happening:

```bash
flutter pub global activate devtools
```

The Performance view shows frame timings with the 16 ms budget marked; the
Widget Rebuild Profiler shows exactly which widgets rebuilt and how often, which
is usually the fastest route to the cause.

---

## Testing

Flutter's testing story is unusually good, and it is built in.

```dart
// Unit test — plain Dart, no widgets.
test('applies a percentage discount', () {
  expect(applyDiscount(200, 10), 180);
});

// Widget test — renders in a headless environment, milliseconds per test.
testWidgets('shows a validation error when email is empty', (tester) async {
  await tester.pumpWidget(const MaterialApp(home: LoginForm()));

  await tester.tap(find.byKey(const Key('submit')));
  await tester.pumpAndSettle();

  expect(find.text('Email is required'), findsOneWidget);
});
```

```bash
flutter test                       # unit and widget tests
flutter test integration_test      # on a real device or emulator
flutter test --coverage
```

- **Widget tests are the sweet spot** — they render the real widget tree without
  a device, so they are fast enough to run constantly.
- **`pumpAndSettle()`** waits for animations to finish; `pump()` advances a
  single frame. Forgetting the difference causes most flaky widget tests.
- **Golden tests** compare rendered output against a stored image, which catches
  unintended visual changes. They need per-platform baselines to be reliable.
- **`integration_test`** drives a real app on a real device for full flows.

---

## Releasing

```bash
flutter build appbundle --release        # Android — .aab for Play
flutter build ipa --release              # iOS
flutter build web --wasm                 # web, WebAssembly output
```

- **Ship an app bundle**, not an APK, to Google Play — it generates
  device-specific downloads and cuts size substantially.
- **Obfuscate and split debug info** so stack traces stay symbolicable:
  `--obfuscate --split-debug-info=build/symbols`.
- **Binary size** starts around 5 MB and grows. `--analyze-size` shows what is
  responsible; unused fonts and uncompressed images are the usual culprits.
- **Flavours** (`--flavor`) give you separate dev, staging and production apps
  installable side by side.
- **Web** targets WebAssembly now, which is much faster than the JavaScript
  output — but Flutter web is still best suited to app-like experiences, not
  content sites. It is not competitive for SEO; see
  [Next.js SEO](/knowledge-base/next-js/seo).

---

## Do's and Don'ts

### Do

- Use `const` constructors everywhere the linter suggests.
- Use `ListView.builder` for lists of unknown or large length.
- Extract the changing part of a screen into its own widget.
- Handle loading, error and empty states explicitly.
- Use `go_router` for app structure and deep links.
- Profile in profile mode, on a real device.
- Write widget tests — they are fast and catch real regressions.
- Commit `pubspec.lock` for applications.

### Don't

- Don't mutate state without `setState` (or your state library's equivalent).
- Don't put a `ListView` directly in a `Column` — wrap it in `Expanded`.
- Don't do expensive work inside `build`.
- Don't reach for a state management package for a single screen's toggle.
- Don't judge performance from a debug build.
- Don't ignore `flutter_lints` warnings about missing `const`.
- Don't use Flutter web for a content site that needs to rank.

---

## Debugging

| Symptom                                          | Cause and fix                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `RenderFlex overflowed by N pixels`              | Children exceed the available space. Use `Expanded`, `Flexible` or make it scrollable.          |
| "Unbounded constraints" / "has unbounded height" | A `ListView` or `Column` inside another scrollable. Wrap in `Expanded` or give it a size.       |
| "No MaterialApp widget found"                    | Using a `BuildContext` from above the `MaterialApp`. Use a `Builder` or extract a child widget. |
| UI does not update                               | State changed without `setState`, or a mutable object was mutated in place.                     |
| `setState() called after dispose()`              | An async callback resolved after the widget was removed. Check `mounted` first.                 |
| Jank while scrolling                             | Expensive `build`, missing `const`, or full-size image decodes.                                 |
| Works in debug, breaks in release                | Usually a tree-shaken reflection-dependent package, or an assert-only code path.                |
| Build fails after changing dependencies          | `flutter clean && flutter pub get`.                                                             |
| Anything environment-related                     | `flutter doctor -v` first.                                                                      |

---

## FAQ

**Flutter or React Native?**
Flutter for pixel-identical UI across platforms, strong animation, and desktop
targets. [React Native](/knowledge-base/react-native) if your team knows React
and you share logic with a web app. Both ship excellent production apps.

**Do I have to learn Dart?**
Yes, and it takes about a week if you know TypeScript. Sound null safety, a
familiar class model, and `async`/`await` that works the way you expect.

**Does Flutter look native?**
It looks like whatever you design. Material by default; Cupertino widgets if
you want iOS conventions. It does not automatically adopt platform look and
feel — that is the trade for consistency.

**Is Flutter web production-ready?**
For app-like experiences behind a login, yes, and WebAssembly output improved it
substantially. For a marketing or content site it is the wrong tool — initial
payload and SEO are both poor.

**Which state management should I choose?**
Riverpod for a new project. `setState` for local state, always. Bloc when
explicit event/state modelling and traceability matter.

**Is Impeller ready?**
It is the default on iOS and completing its Android migration, which removed the
shader-compilation jank that Skia suffered from on first animation.

---

## Check your understanding

<Quiz
question="A ListView placed directly inside a Column throws 'Vertical viewport was given unbounded height'. Why?"
options={[
{
text: 'A Column gives its children unbounded height on the main axis, and a ListView wants to expand to fill the available height — so neither can resolve a size',
correct: true,
why: 'Flutter layout is constraints-down, sizes-up. The Column offers infinite height; the ListView asks for all available height. Wrapping it in Expanded gives it a bounded share.',
},
{text: 'ListView can only be used as the direct child of a Scaffold', why: 'It can appear anywhere it receives bounded constraints.'},
{text: 'The ListView needs shrinkWrap: true', why: 'That does resolve the error by sizing to its content, but it disables virtualisation — expensive for long lists. Expanded is usually correct.'},
{text: 'Columns cannot contain scrollable widgets', why: 'They can, provided the scrollable is given bounded constraints.'},
]}
explanation={<>Almost every Flutter layout error is a constraints problem. "Constraints go down, sizes go up, the parent sets position" resolves most of them without further debugging.</>}
reference={{label: 'Layout', href: '/knowledge-base/flutter#layout'}}
/>

<Quiz
question="A widget's field is updated in an event handler but the UI never changes. What is wrong?"
options={[
{
text: 'The change was made without setState, so the framework was never told the element is dirty',
correct: true,
why: 'Mutating a field changes the data but does not schedule a rebuild. setState marks the element dirty so it is rebuilt on the next frame.',
},
{text: 'The widget must be a StatelessWidget', why: 'A StatelessWidget cannot hold mutable state at all — the opposite of what is needed.'},
{text: 'Flutter requires immutable data structures', why: 'It does not enforce immutability; it requires you to signal that a rebuild is needed.'},
{text: 'The build method is being cached', why: 'Flutter does not cache build output. It simply had no reason to call build again.'},
]}
explanation={<>The direct analogue of mutating React state in place. The framework only rebuilds when told to — through <code>setState</code>, or a notifier/provider in a state management library.</>}
reference={{label: 'Stateless and stateful', href: '/knowledge-base/flutter#stateless-and-stateful'}}
/>

<Quiz
question="Which changes genuinely improve Flutter rendering performance?"
type="multiple"
options={[
{text: 'Adding const to widget constructors wherever possible', correct: true, why: 'A const widget subtree is skipped entirely during rebuild — the cheapest available win.'},
{text: 'Using ListView.builder instead of ListView with a children list', correct: true, why: 'The builder form constructs items lazily as they scroll into view rather than all at once.'},
{text: 'Extracting the frequently changing part of a screen into its own widget', correct: true, why: 'Narrows the rebuild to the subtree that actually changed instead of everything below the setState call.'},
{text: 'Decoding images at display size with cacheWidth/cacheHeight', correct: true, why: 'Full-resolution decodes of large images are a common source of jank and memory pressure.'},
{text: 'Measuring frame times in a debug build', why: 'Debug builds are dramatically slower and unrepresentative. Profile with flutter run --profile.'},
]}
explanation={<>The DevTools Widget Rebuild Profiler shows which widgets rebuild and how often, which usually identifies the missing <code>const</code> or the over-broad <code>setState</code> immediately.</>}
reference={{label: 'Performance', href: '/knowledge-base/flutter#performance'}}
/>

<Quiz
question="Calling Navigator.of(context) in the build method of the widget that also creates the MaterialApp throws 'No MaterialApp widget found'. Why?"
options={[
{
text: 'That BuildContext is above the MaterialApp in the tree, so it cannot see the Navigator the MaterialApp provides',
correct: true,
why: 'of(context) walks _up_ the tree. A context from the widget creating MaterialApp sits above it, so the Navigator is not an ancestor. Use a Builder or extract a child widget.',
},
{text: 'Navigator can only be used inside a StatefulWidget', why: 'It works in either, given a context below the MaterialApp.'},
{text: 'MaterialApp.router does not provide a Navigator', why: 'It does; the problem here is the position of the context.'},
{text: 'The route must be registered before Navigator is available', why: 'The error is about not finding the widget at all, not about an unknown route.'},
]}
explanation={<>The same reasoning explains failures with <code>Theme.of</code>, <code>MediaQuery.of</code> and <code>ScaffoldMessenger.of</code>. When any <code>.of(context)</code> fails, the question is always whether the provider is genuinely an ancestor of <em>that</em> context.</>}
reference={{label: 'BuildContext', href: '/knowledge-base/flutter#buildcontext'}}
/>

<Quiz
question="A team is choosing between Flutter and React Native for an app that must look identical on iOS and Android and includes heavy custom animation. Which argument favours Flutter?"
options={[
{
text: 'Flutter draws every pixel with its own engine, so rendering is identical across platforms and animation does not depend on platform widget behaviour',
correct: true,
why: 'Owning the rendering pipeline is exactly what delivers consistency and predictable animation. React Native maps to platform widgets, which differ in subtle ways.',
},
{
text: 'Flutter produces smaller binaries',
why: 'The opposite — shipping a rendering engine means an empty Flutter app starts around 5 MB.',
},
{
text: 'Flutter shares UI code with an existing React web app',
why: 'That is a React Native argument, and even there only logic transfers cleanly, not UI.',
},
{
text: 'Flutter apps automatically follow each platform’s design conventions',
why: 'They do not, by design. You opt into Material or Cupertino; nothing is inherited automatically.',
},
]}
explanation={<>The trade is explicit: consistency and control in exchange for binary size and no automatic platform conventions. For a strongly branded, animation-heavy app that is usually a good deal.</>}
reference={{label: 'Introduction', href: '/knowledge-base/flutter#introduction'}}
/>

---

## References

- [Flutter documentation](https://docs.flutter.dev/) — the official guide;
  unusually good.
- [Flutter release notes](https://docs.flutter.dev/release/release-notes) —
  what changed in 3.44 and earlier.
- [Dart language tour](https://dart.dev/language) — the fastest route in if you
  know TypeScript.
- [Understanding constraints](https://docs.flutter.dev/ui/layout/constraints) —
  the layout model, explained properly.
- [Flutter performance best practices](https://docs.flutter.dev/perf/best-practices)
  — `const`, rebuild scope, profiling.
- [Riverpod](https://riverpod.dev/) and [go_router](https://pub.dev/packages/go_router)
  — the mainstream state and routing choices.
- [pub.dev](https://pub.dev) — the package registry, with maintenance scores.
