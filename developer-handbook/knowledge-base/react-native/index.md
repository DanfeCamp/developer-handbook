---
title: 'React Native'
description: 'Building native iOS and Android apps with React — the New Architecture, Expo, navigation, styling, native modules, performance and release.'
---

# React Native

## Introduction

React Native renders **real native platform views** from React components,
rather than drawing into a web view. You write components in TypeScript, and the
framework maps them onto the platform's own UI widgets — which is why a React
Native app feels native while sharing most of its logic across iOS and Android.

**The problem it solves.** Native development means two codebases, two
languages, two teams and two release cycles for one product. Cordova-style
web-view apps solved the duplication and felt wrong — scroll physics, keyboard
behaviour and navigation transitions were all subtly off. React Native shares
the logic while rendering genuine platform components.

**What you keep from React:** components, props, state, hooks, context and the
whole mental model. **What changes:** there is no DOM. `<div>` becomes `<View>`,
`<p>` becomes `<Text>`, CSS becomes a JavaScript style object, and anything
touching the browser — `localStorage`, `window`, `document` — does not exist.

:::note Versions
Written against **React Native 0.86** (Expo SDK 57, June 2026) and React 19.

**The New Architecture is now the only architecture.** React Native 0.82 was the
first release to run entirely on it, and Expo SDK 55+ enables it with no opt-out.
Any tutorial discussing "enabling the New Architecture" or the legacy bridge
predates this.
:::

---

## Core Concepts

### How it renders

Your JavaScript runs in **Hermes**, a JavaScript engine built for mobile with
ahead-of-time bytecode compilation and fast startup. The React tree is
reconciled as usual, and the resulting view operations are applied to real
native views.

Under the New Architecture that happens through three pieces:

- **JSI** (JavaScript Interface) — lets JavaScript hold direct references to C++
  objects and call them synchronously. The old asynchronous JSON bridge is gone.
- **Fabric** — the renderer. It builds an immutable C++ shadow tree, computes
  layout, and commits to native views. Because layout can run synchronously, the
  visual glitches the old architecture produced during fast updates are gone.
- **TurboModules** — native modules loaded lazily and typed through Codegen,
  rather than all initialised at startup.

The practical consequences: faster startup, no bridge serialisation bottleneck,
and synchronous native calls where they matter.

### Core components

| Web               | React Native                 | Notes                                         |
| ----------------- | ---------------------------- | --------------------------------------------- |
| `<div>`           | `<View>`                     | Flexbox container; cannot contain raw text    |
| `<p>`, `<span>`   | `<Text>`                     | **All** text must be inside a `Text`          |
| `<img>`           | `<Image>`                    | Requires explicit dimensions or a flex parent |
| `<input>`         | `<TextInput>`                |                                               |
| `<button>`        | `<Pressable>`                | Prefer `Pressable` over the legacy `Button`   |
| scrolling `<div>` | `<ScrollView>`               | Renders **everything** — short lists only     |
| a long list       | `<FlatList>` / `<FlashList>` | Virtualised                                   |

```tsx
import {View, Text, Pressable, StyleSheet} from 'react-native';

export function Greeting({name, onPress}: {name: string; onPress: () => void}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Hello, {name}</Text>
      <Pressable
        onPress={onPress}
        style={({pressed}) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {padding: 16, gap: 12, backgroundColor: '#fff', borderRadius: 12},
  title: {fontSize: 20, fontWeight: '600'},
  button: {paddingVertical: 12, alignItems: 'center', backgroundColor: '#0b57d0', borderRadius: 8},
  pressed: {opacity: 0.8},
  buttonText: {color: '#fff', fontWeight: '600'},
});
```

**Raw text outside a `<Text>` throws.** It is the first error every React
developer hits.

### Styling

Styles are JavaScript objects using a subset of CSS, in camelCase, with no
cascade and no inheritance — except that `<Text>` inherits some typography from
a parent `<Text>`.

Differences that catch people out:

- **`flexDirection` defaults to `column`**, not `row`.
- **`display: flex` is implicit.** Everything is already flex.
- **No units.** Numbers are density-independent pixels; percentages are strings.
- **No `gap` on older versions**, though modern React Native supports it.
- **Shadows differ per platform** — `shadowColor`/`shadowOffset` on iOS,
  `elevation` on Android. `boxShadow` is now supported and smooths this over.

```tsx
import {Platform} from 'react-native';

const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === 'ios' ? 44 : 0,
    ...Platform.select({ios: {shadowOpacity: 0.1}, android: {elevation: 4}}),
  },
});
```

Use `useSafeAreaInsets()` rather than hard-coding notch and home-indicator
padding.

**NativeWind** brings Tailwind syntax to React Native and is a popular choice;
`StyleSheet.create` remains the zero-dependency default.

---

## Setup

### Expo, or bare React Native?

**Use Expo.** This used to be a real debate; it is now the default recommendation
in React Native's own documentation. Expo is not a walled garden — with config
plugins and prebuild you can use any native library and write your own native
code.

```bash
npx create-expo-app@latest my-app
cd my-app
npx expo start        # scan the QR code with Expo Go, or run a dev build
```

What Expo provides that you would otherwise assemble yourself:

- **EAS Build** — cloud builds, so you can ship an iOS app without a Mac.
- **EAS Update** — over-the-air JavaScript updates without an app-store review.
- **Expo Router** — file-based routing.
- **Config plugins** — declarative native configuration, so `ios/` and
  `android/` stay generated rather than hand-edited.
- **A maintained module set** — camera, notifications, secure storage, all
  version-matched to the SDK.

Choose bare React Native only when you have substantial existing native code, or
a constraint Expo genuinely cannot express.

### Development builds vs Expo Go

**Expo Go** is a prebuilt sandbox app for trying things out. It only contains
the native modules Expo bundled, so the moment you add a library with native
code, it stops working.

**A development build** is your own app, with your own native dependencies,
plus the Expo dev tooling. It is what real projects use.

```bash
npx expo run:ios        # local build; needs Xcode
npx expo run:android    # needs Android Studio
eas build --profile development --platform ios   # cloud build
```

### Navigation

**Expo Router** is file-based, built on React Navigation:

```text
app/
├── _layout.tsx           → root stack
├── index.tsx             → /
├── (tabs)/
│   ├── _layout.tsx       → tab bar
│   ├── index.tsx         → /
│   └── settings.tsx      → /settings
└── product/[id].tsx      → /product/:id
```

```tsx title="app/product/[id].tsx"
import {useLocalSearchParams, Stack} from 'expo-router';
import {View, Text} from 'react-native';

export default function Product() {
  const {id} = useLocalSearchParams<{id: string}>();
  return (
    <View>
      <Stack.Screen options={{title: `Product ${id}`}} />
      <Text>Product {id}</Text>
    </View>
  );
}
```

Because routes are URLs, deep linking and universal links come almost free —
which is otherwise a genuinely fiddly piece of mobile work.

---

## Data and State

Everything from [React](/knowledge-base/react-js) applies. The mobile-specific
parts:

```tsx
// Server state — same libraries as the web.
const {data, isPending} = useQuery({queryKey: ['orders'], queryFn: fetchOrders});
```

**Storage has three tiers, and choosing wrongly is a security bug:**

| Use                    | For                                              |
| ---------------------- | ------------------------------------------------ |
| `expo-secure-store`    | Tokens, credentials — Keychain / Keystore backed |
| `AsyncStorage` / MMKV  | Preferences, cache. **Not encrypted**            |
| SQLite (`expo-sqlite`) | Structured offline data                          |

Never put an auth token in `AsyncStorage`. On a rooted or jailbroken device it
is a plain file.

**Assume the network is unreliable.** Mobile apps lose connectivity constantly.
Cache reads, queue writes, and show what you have rather than a spinner.
TanStack Query's persistence plugin plus `@react-native-community/netinfo`
covers most of it.

---

## Native Modules

When JavaScript cannot reach a platform API, you write a native module. Under
the New Architecture, **Expo Modules API** is by far the easiest route:

```swift title="modules/battery/ios/BatteryModule.swift"
import ExpoModulesCore

public class BatteryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Battery")

    Function("getLevel") { () -> Float in
      UIDevice.current.isBatteryMonitoringEnabled = true
      return UIDevice.current.batteryLevel
    }
  }
}
```

```ts
import {requireNativeModule} from 'expo-modules-core';
const Battery = requireNativeModule('Battery');
export const getLevel = (): number => Battery.getLevel();
```

Before writing one, check whether an Expo module or a maintained community
package already exists — a native module is a permanent maintenance commitment
across two platforms and every SDK upgrade.

---

## Performance

Mobile devices are slower and more varied than laptops. **Always profile on a
real low-end Android device**, never on a simulator on an M-series Mac.

**Use `FlashList` or `FlatList`, never `ScrollView`, for long lists.**
`ScrollView` renders every child immediately; a 500-item `ScrollView` will hitch
on scroll and can crash on low-memory devices.

```tsx
import {FlashList} from '@shopify/flash-list';

<FlashList
  data={products}
  renderItem={({item}) => <ProductRow product={item} />}
  estimatedItemSize={80}
  keyExtractor={(item) => item.id}
/>;
```

**Run animations on the UI thread.** An animation driven by React state
re-renders on every frame and stutters as soon as JavaScript is busy.
`react-native-reanimated` runs the animation natively:

```tsx
import Animated, {useSharedValue, useAnimatedStyle, withSpring} from 'react-native-reanimated';

const offset = useSharedValue(0);
const style = useAnimatedStyle(() => ({transform: [{translateX: offset.value}]}));

<Animated.View style={style} />;
// offset.value = withSpring(100) — runs on the UI thread, unaffected by JS work
```

Other things that matter:

- **Enable the React Compiler** so memoisation is handled for you.
- **Resize images before shipping them.** A 4000 px asset displayed at 100 px
  wastes memory and decode time. `expo-image` handles caching and transitions.
- **Measure startup.** Hermes helps, but a large JavaScript bundle and eager
  module initialisation still cost seconds on a low-end device.
- **Watch for bridge chatter** in gesture handlers — use
  `react-native-gesture-handler`, which runs natively.

---

## Testing and Debugging

```bash
npx expo start        # then press `j` to open React Native DevTools
```

- **React Native DevTools** (Chrome DevTools-based) for the component tree,
  network and profiler. The old Flipper integration is gone.
- **Unit and component tests** with Jest and
  `@testing-library/react-native`, using the same query-by-role approach as the
  web.
- **End-to-end** with **Maestro** — YAML flows, far simpler than Detox, and now
  the common recommendation.

```yaml title="maestro/login.yaml"
appId: com.acme.app
---
- launchApp
- tapOn: 'Email'
- inputText: 'user@example.com'
- tapOn: 'Sign in'
- assertVisible: 'Dashboard'
```

| Symptom                                           | Cause and fix                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| "Text strings must be rendered within a `<Text>`" | Raw text in a `<View>`. Wrap it.                                                         |
| Works in Expo Go, fails in a build                | A native module Expo Go does not contain. Use a development build.                       |
| Blank white screen on launch                      | A JavaScript error before first render. Check native logs (`adb logcat`, Xcode console). |
| Flexbox layout looks wrong                        | `flexDirection` defaults to `column`, not `row`.                                         |
| Content under the notch                           | Missing safe-area insets.                                                                |
| Animation stutters                                | Driven by React state. Move it to Reanimated.                                            |
| Works on iOS, broken on Android                   | Shadow/elevation, keyboard avoidance, or back-button handling. Test both.                |
| Build fails after adding a library                | Native dependencies changed. `npx expo prebuild --clean`, rebuild.                       |

---

## Releasing

```bash
eas build --platform all --profile production
eas submit --platform ios
eas update --branch production    # OTA JavaScript-only update
```

**EAS Update ships JavaScript and assets over the air**, bypassing store review
— excellent for fixes, and **not** permitted for anything that changes native
code or materially alters the app's purpose. Native changes always require a new
build and a review.

Practical release notes:

- Apple review takes hours to days; Google Play is usually faster. Budget for a
  rejection.
- Every permission needs a usage description string, and vague ones get
  rejected.
- Test on the oldest OS version you claim to support.
- Ship a crash reporter (Sentry, Crashlytics) with source maps uploaded, or
  production stack traces are minified noise.

---

## Do's and Don'ts

### Do

- Start with Expo and a development build.
- Use `FlashList`/`FlatList` for anything scrollable and long.
- Run animations through Reanimated on the UI thread.
- Store credentials in `expo-secure-store`.
- Test on a real low-end Android device.
- Use safe-area insets rather than hard-coded padding.
- Handle offline and slow networks explicitly.
- Use Expo Router so deep links work.

### Don't

- Don't put a long list in a `ScrollView`.
- Don't keep tokens in `AsyncStorage`.
- Don't assume browser APIs exist — there is no `window` or `localStorage`.
- Don't hand-edit `ios/` and `android/` in an Expo project; use config plugins.
- Don't animate with `setState` on every frame.
- Don't ship a native change as an OTA update.
- Don't judge performance from a simulator.
- Don't follow tutorials about enabling the New Architecture — it is mandatory
  now.

---

## FAQ

**React Native or Flutter?**
React Native if your team knows React and you share code with a web app.
[Flutter](/knowledge-base/flutter) if you want maximum rendering consistency
across platforms and do not mind Dart. Both produce good apps.

**Can I share code with my web app?**
Business logic, API clients, validation and types — yes, and that is where the
value is. UI components largely no, because the primitives differ. React Native
Web bridges some of it at a cost.

**Do I need a Mac?**
Not with EAS Build, which compiles iOS in the cloud. A Mac is still convenient
for local iOS debugging.

**Is it fast enough?**
For the overwhelming majority of applications, yes — and the New Architecture
removed the bridge bottleneck. Heavy real-time graphics remain a case for
native.

**What about the New Architecture migration?**
There is nothing to migrate to. React Native 0.82+ and Expo SDK 55+ run on it
exclusively. The work now is checking that third-party libraries have been
updated.

---

## Check your understanding

<Quiz
question="A screen renders 800 products inside a ScrollView. Scrolling stutters and the app crashes on older Android devices. What is the fix?"
options={[
{
text: 'Replace the ScrollView with FlatList or FlashList so only visible rows are rendered',
correct: true,
why: 'ScrollView mounts every child immediately — 800 rows means 800 native view hierarchies in memory. Virtualised lists render a window and recycle.',
},
{text: 'Wrap each row in React.memo', why: 'Prevents unnecessary re-renders but does nothing about 800 rows being mounted in the first place.'},
{text: 'Move the data fetch to a Server Component', why: 'There are no Server Components in React Native, and the problem is view count, not data loading.'},
{text: 'Enable Hermes', why: 'Hermes is already the default engine and improves startup, not list virtualisation.'},
]}
explanation={<>The same reasoning as web virtualisation, with a lower ceiling: mobile devices have far less memory, so the crash threshold arrives much sooner.</>}
reference={{label: 'Performance', href: '/knowledge-base/react-native#performance'}}
/>

<Quiz
question="An app stores its JWT auth token in AsyncStorage. Why is that a problem?"
options={[
{
text: 'AsyncStorage is unencrypted — on a rooted or jailbroken device it is a readable file, and it may be included in device backups',
correct: true,
why: 'It is a simple key-value store with no platform-backed protection. Credentials belong in expo-secure-store, which uses the iOS Keychain and Android Keystore.',
},
{text: 'AsyncStorage has a size limit that tokens exceed', why: 'A JWT is well within any limit.'},
{text: 'AsyncStorage is synchronous and blocks the UI thread', why: 'It is asynchronous, and performance is not the issue here.'},
{text: 'AsyncStorage is cleared on every app update', why: 'It persists across updates — which in this case makes the exposure longer-lived.'},
]}
explanation={<>Three tiers, chosen by sensitivity: SecureStore for credentials, AsyncStorage or MMKV for preferences and cache, SQLite for structured offline data.</>}
reference={{label: 'Data and state', href: '/knowledge-base/react-native#data-and-state'}}
/>

<Quiz
question="Which of these require a new native build rather than an EAS Update?"
type="multiple"
options={[
{text: 'Adding a library with native code, such as a camera module', correct: true, why: 'New native code must be compiled into the binary. OTA updates carry JavaScript and assets only.'},
{text: 'Requesting a new device permission', correct: true, why: 'Permissions and their usage descriptions live in native manifests and Info.plist.'},
{text: 'Changing the app icon or splash screen', correct: true, why: 'Both are native resources baked into the build.'},
{text: 'Fixing a validation bug in a form component', why: 'Pure JavaScript — exactly what OTA updates are for.'},
{text: 'Updating copy and translations', why: 'JavaScript and assets, so an OTA update is appropriate.'},
]}
explanation={<>The dividing line is the native binary. Also note that store policies prohibit using OTA updates to materially change what the app does — they are for fixes and iteration, not for bypassing review.</>}
reference={{label: 'Releasing', href: '/knowledge-base/react-native#releasing'}}
/>

<Quiz
question="A drag animation is implemented by calling setState with a new position on every gesture event. It stutters whenever the app is doing other work. Why, and what fixes it?"
options={[
{
text: 'The animation runs on the JavaScript thread, so any JS work blocks frames — move it to react-native-reanimated, which drives it on the UI thread',
correct: true,
why: 'State-driven animation re-renders React on every frame. Reanimated runs the animation natively, so it keeps 60fps even when JavaScript is busy.',
},
{text: 'setState is too slow; useRef would fix it', why: 'A ref does not trigger re-renders, so the view would not move at all.'},
{text: 'The device needs a higher refresh rate', why: 'The stutter is caused by dropped frames from a blocked thread, not by the display.'},
{text: 'The component needs React.memo', why: 'Memoisation cannot help when the animated value legitimately changes every frame.'},
]}
explanation={<>Pair Reanimated with <code>react-native-gesture-handler</code> so the gesture is also handled natively; otherwise the touch events still cross to JavaScript.</>}
reference={{label: 'Performance', href: '/knowledge-base/react-native#performance'}}
/>

<Quiz
question="A feature works in Expo Go during development but crashes immediately in a production build. What is the most likely cause?"
options={[
{
text: 'The reverse is more common — but here, a native module or configuration present in the build differs from the Expo Go sandbox, so test with a development build instead',
correct: true,
why: 'Expo Go ships a fixed set of native modules. Anything that behaves differently between it and a real build should be developed against a development build, which contains your actual native dependencies.',
},
{text: 'Production builds do not support hooks', why: 'Hooks work identically in every build.'},
{text: 'EAS Build strips TypeScript types at runtime', why: 'Types are erased at compile time in every environment, including development.'},
{text: 'Expo Go always uses the legacy architecture', why: 'SDK 55+ runs the New Architecture everywhere, with no opt-out.'},
]}
explanation={<>The general rule: Expo Go is for demos and first steps. As soon as a project has real native dependencies, develop against a development build so what you test matches what you ship.</>}
reference={{label: 'Development builds vs Expo Go', href: '/knowledge-base/react-native#development-builds-vs-expo-go'}}
/>

---

## References

- [React Native documentation](https://reactnative.dev/docs/getting-started) —
  core components, APIs, the New Architecture.
- [Expo documentation](https://docs.expo.dev/) — SDK, EAS Build, EAS Update,
  config plugins.
- [Expo Router](https://docs.expo.dev/router/introduction/) — file-based routing
  and deep linking.
- [React Native 0.83 release notes](https://reactnative.dev/blog/2025/12/10/react-native-0.83)
  — React 19.2 support and DevTools.
- [Reanimated](https://docs.swmansion.com/react-native-reanimated/) — UI-thread
  animation.
- [FlashList](https://shopify.github.io/flash-list/) — the faster list.
- [Maestro](https://maestro.mobile.dev/) — end-to-end testing.
