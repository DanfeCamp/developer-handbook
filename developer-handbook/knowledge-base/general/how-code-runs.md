---
title: 'How Code Runs'
description: 'How source text becomes a running program — interpreters, compilers and JIT, transpilation, module systems, bundling, tree shaking and source maps.'
---

# How Code Runs

## Introduction

Between the text you write and the work the CPU does sit several translation
steps. Most developers can ignore them until something behaves oddly — and then
the explanation is almost always in this pipeline.

**Four questions this page answers:**

- Why does the same function get faster after a few thousand calls?
- Why do TypeScript types not protect you from bad API data?
- Why does `require()` produce larger bundles than `import`?
- Why does a stack trace point at minified column 4,812?

None of this is language trivia. A micro-benchmark that measures the interpreter
instead of the optimised code will send you optimising the wrong function; a
type assertion mistaken for validation will fail far from its cause.

---

## Interpreters, Compilers and JIT

Three strategies for turning source into execution:

| Strategy                         | How it works                                                | Trade-off                                           |
| -------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| **Interpreter**                  | Reads source and executes it directly                       | Fast to start, slower to run                        |
| **Ahead-of-time (AOT) compiler** | Translates the whole program to machine code before running | Slow to build, fast to run                          |
| **JIT compiler**                 | Interprets first, then compiles hot paths at runtime        | Fast start _and_ fast steady state, after a warm-up |

**Go, Rust and C are AOT.** The binary contains machine code; there is no
translation left at runtime.

**V8, the JVM and PHP 8 are JIT.** They start by interpreting, count how often
each function runs, and compile the hot ones to machine code — using
observations about the actual types flowing through to produce specialised code.

**The consequence that surprises people: the same function gets measurably
faster after a few thousand calls.** A benchmark that runs a loop once measures
the interpreter. A benchmark that runs it a million times measures optimised
code. Neither necessarily matches production.

**The related consequence is deoptimisation.** A JIT compiles on the assumption
that a value is always a number. Pass it a string on the ten-thousandth call and
the engine discards the optimised version and falls back — which is why
consistently shaped objects and monomorphic functions run faster than
polymorphic ones.

**What to take from this:** warm up before measuring, measure with realistic
data, and do not micro-optimise on the basis of a loop that ran once.

---

## Transpiling Is Not Compiling

A **transpiler** converts source in one language to source in another at a
similar level of abstraction: TypeScript → JavaScript, modern JavaScript →
ES2017, Sass → CSS. Nothing becomes machine code.

**This matters for one reason above all: TypeScript types are erased.**

```ts
interface User {
  id: number;
  email: string;
}

// ❌ An assertion. Nothing checks it. If the API returns {id: "3"}, this lies.
const user = (await res.json()) as User;

// ✅ Validation. This actually inspects the data at runtime.
const user = UserSchema.parse(await res.json());
```

Types exist during type checking and are gone by the time the program runs. At
runtime the values are plain JavaScript, and **nothing validates that JSON
arriving from an API matches the interface you declared**.

**Type checking and runtime validation are separate jobs.** Use the type system
for code you control, and a validator — Zod, Valibot, ArkType, a hand-written
guard — at every boundary where data enters: HTTP responses, request bodies,
environment variables, `localStorage`, message payloads.

Modern toolchains often split the work further: `esbuild` or SWC strips types
fast without checking them, and `tsc --noEmit` checks them separately in CI.
That is fast and correct, and it means **your build succeeding tells you nothing
about whether the types are sound**.

---

## Modules

Two module systems coexist in the JavaScript world.

|                   | CommonJS                       | ES Modules            |
| ----------------- | ------------------------------ | --------------------- |
| Syntax            | `require()` / `module.exports` | `import` / `export`   |
| Resolution        | Runtime, dynamic               | Static, at parse time |
| Loading           | Synchronous                    | Asynchronous          |
| Tree-shakeable    | No                             | Yes                   |
| Top-level `await` | No                             | Yes                   |
| Circular imports  | Partial exports                | Hoisted bindings      |

**The distinction that matters is static versus dynamic.** ESM imports are
resolved before any code executes, so a tool can see the entire dependency graph
without running the program. That single property enables tree shaking, precise
bundling and reliable dead-code elimination — none of which are possible when
`require()` might be called with a computed string:

```js
// Statically analysable — the bundler knows exactly what is used.
import {formatDate} from './utils.js';

// Not analysable — the bundler cannot know what this resolves to.
const mod = require(`./locales/${userLocale}.js`);
```

**Write ESM in new code.** In Node, set `"type": "module"` in `package.json`.

**Interoperability is where the friction is.** ESM can import CommonJS, mostly.
CommonJS cannot `require()` ESM synchronously in older Node versions, which is
why some packages ship dual builds and why "Cannot use import statement outside
a module" is such a common error. Node's `exports` field in `package.json` maps
entry points per environment, and getting it wrong is a frequent cause of
packages that work in one tool and not another.

**Dynamic `import()` is the escape hatch**, and it is available in both systems.
It returns a promise, is statically detectable enough for bundlers to split a
chunk, and is the correct mechanism for lazy loading a route or a heavy library.

---

## Bundling, Minification and Tree Shaking

A bundler — Vite/Rollup, webpack, esbuild, Turbopack — walks the import graph
and produces a small number of output files. Three distinct operations get
conflated:

**Tree shaking** is dead-code elimination across module boundaries. Picture the
dependency graph as a tree: the entry point is the trunk, imports are branches,
and functions you never call are dead leaves. Shaking the tree drops them.

```js
// utils.js exports 40 functions.
import {formatDate} from './utils.js';

// Only formatDate and its own dependencies reach the bundle.
// The other 39 are shaken out.
```

**Three things break it:**

1. **CommonJS.** `require()` cannot be analysed statically, so nothing can be
   proven unused.
2. **Side effects.** If importing a module runs code — registering a polyfill,
   mutating a prototype, adding a CSS import — the bundler must keep it.
   Declare `"sideEffects": false` in `package.json`, or list the files that do
   have them, so the bundler knows it is safe to drop unused exports.
3. **Re-export barrels.** A large `index.js` re-exporting everything can defeat
   the analysis and pull in far more than you imported. Import from the specific
   module when bundle size matters.

**Tree shaking works at export granularity, not runtime reachability.** If an
export is imported, its whole body ships — even the branch that never executes.

**Minification** is separate: renaming variables to single letters, removing
whitespace, collapsing expressions, dropping dead branches within a function.
Tree shaking removes code you never referenced; minification shrinks the code
that remains.

**Code splitting** is the third operation: producing several chunks so a user
downloads only what the current route needs. Dynamic `import()` marks the split
points.

**Source maps** map transformed output back to original source, so a stack trace
points at your TypeScript rather than at minified column 4,812.

```
// Generate them in production, upload to your error tracker,
// and do not serve them publicly if the source is not public.
```

Without them, production error reports are unreadable. With them served openly,
your entire source is one click away in DevTools. Upload to Sentry or equivalent
and keep them out of the public bundle.

---

## Do's and Don'ts

### Do

- Write ESM in new code, and set `"type": "module"` in Node.
- Validate external data at runtime, with a schema library.
- Run `tsc --noEmit` in CI, separately from the build.
- Declare `"sideEffects"` accurately in published packages.
- Import from specific modules rather than barrel files when size matters.
- Use dynamic `import()` for route-level and heavy-library splitting.
- Generate source maps and upload them to your error tracker.
- Warm up before benchmarking, and benchmark with realistic data.

### Don't

- Don't treat a type assertion as validation.
- Don't assume a successful build means the types check.
- Don't publish CommonJS-only packages if you want consumers to tree-shake.
- Don't serve source maps publicly for closed source.
- Don't micro-optimise from a benchmark that ran the code once.
- Don't `require()` with a computed path in code you want bundled well.
- Don't assume minification and tree shaking are the same thing.

---

## Common Mistakes

**Assuming types validate runtime data.** `await res.json() as User` asserts a
lie. When the API changes, you get `undefined is not a function` somewhere far
from the cause.

**A barrel file that defeats tree shaking.** `import {Button} from '@/components'`
pulls the whole component library into the bundle when the barrel is not
side-effect-free.

**Missing `"sideEffects"` metadata.** The bundler conservatively keeps
everything, and your library ships far heavier than it should.

**Mixed module systems in one package.** Dual builds with a misconfigured
`exports` map produce packages that work in Vite and fail in Node, or load twice
under two identities.

**Benchmarking cold code.** Measuring the interpreter, then optimising a
function that the JIT would have handled.

**Publishing source maps with closed source.** The entire application source,
readable in DevTools.

**Expecting tree shaking to remove an unused branch.** It removes unused
_exports_, not unreachable code inside one you imported.

---

## Debugging

| Symptom                                        | Where to look                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| "Cannot use import statement outside a module" | Missing `"type": "module"`, or a CJS consumer loading ESM         |
| Bundle far larger than expected                | Barrel imports, CommonJS dependencies, missing `sideEffects`      |
| Stack traces point at minified code            | Source maps not generated or not uploaded                         |
| Types pass but production breaks               | Runtime data does not match the declared type — add validation    |
| Package works in dev, fails in build           | `exports` map, or a dependency that is ESM-only                   |
| Function slower than a benchmark suggested     | Benchmark measured optimised code; production is polymorphic      |
| Duplicate copies of a library in the bundle    | Two entry points resolved — check `exports` and peer dependencies |

**Use your bundler's analyser** — `rollup-plugin-visualizer`,
`webpack-bundle-analyzer`, `vite-bundle-visualizer`. A treemap of what actually
shipped answers size questions in seconds that are otherwise guesswork.

---

## FAQ

**Should I still use CommonJS?**
Only for existing code. ESM is the standard, is required for tree shaking, and
is now well supported across the Node ecosystem.

**Do I need a bundler for a Node backend?**
Usually not — Node loads modules directly. Bundling a backend helps mainly for
serverless cold starts and single-file distribution.

**Is TypeScript slower at runtime?**
No. The types are erased; the emitted JavaScript is what runs. Compilation time
is the only cost.

**Which bundler?**
Vite for applications, `tsup`/Rollup for libraries, esbuild when raw speed
matters most. Next.js and other frameworks bring their own.

**Why does my library's `import` cost 200 kB?**
Almost certainly a barrel file or a CommonJS dependency. Check with a bundle
analyser before optimising anything else.

**What is the difference between `tsc` and `esbuild` for TypeScript?**
`tsc` type-checks and emits. `esbuild` and SWC only strip types, very fast, with
no checking. Most setups use the fast one to build and `tsc --noEmit` to check.

---

## Check your understanding

<Quiz
question="A team writes `const user = await res.json() as User` and is surprised when a field is undefined in production. What went wrong?"
options={[
{
text: 'The assertion is erased at compile time — nothing checks the shape of the data at runtime',
correct: true,
why: 'TypeScript types exist only during type checking. An assertion tells the compiler to stop complaining; it performs no inspection of the actual value.',
},
{text: 'The API response needed to be awaited twice', why: 'One await resolves the JSON parsing; the shape of the parsed value is the issue.'},
{text: 'The User interface should have been a class', why: 'Classes exist at runtime, and using one would not validate incoming JSON either.'},
{text: 'TypeScript cannot type asynchronous values', why: 'It types promises and awaited values perfectly well.'},
]}
explanation={<>Type checking and runtime validation are separate jobs. Parse external data with a schema library — <code>UserSchema.parse(await res.json())</code> — at every boundary: HTTP responses, request bodies, environment variables, message payloads.</>}
reference={{label: 'Transpiling is not compiling', href: '/knowledge-base/general/how-code-runs#transpiling-is-not-compiling'}}
/>

<Quiz
question="Which statements about tree shaking are true?"
type="multiple"
options={[
{text: 'It relies on ES module imports being statically analysable', correct: true, why: 'The bundler must know the full import graph without executing code. require() with a computed path defeats this entirely.'},
{text: 'A module marked as having side effects cannot have its unused exports dropped', correct: true, why: 'If importing the module runs code, removing it would change behaviour — hence the sideEffects field in package.json.'},
{text: 'A barrel file re-exporting everything can pull in far more than you imported', correct: true, why: 'The re-export chain can defeat the analysis, which is why importing from the specific module matters when size does.'},
{text: 'It is the same thing as minification', why: 'Minification shrinks the code that remains — renaming, whitespace. Tree shaking removes code never referenced. Different stages, different jobs.'},
{text: 'It removes code inside a function that is never called at runtime', why: 'It works at module-export granularity, not runtime reachability. If an export is imported, its whole body ships.'},
]}
explanation={<>Tree shaking is dead-code elimination across module boundaries, entirely dependent on static analysis — which is why the ESM/CommonJS distinction has real consequences for bundle size.</>}
reference={{label: 'Bundling, minification and tree shaking', href: '/knowledge-base/general/how-code-runs#bundling-minification-and-tree-shaking'}}
/>

<Quiz
question="A micro-benchmark reports a function at 40 ns per call. In production the same function averages 300 ns. Which explanation is most likely?"
options={[
{
text: 'The benchmark ran the function hot with uniform inputs, so the JIT specialised it; production passes varied shapes and the optimised version is discarded',
correct: true,
why: 'JIT compilers specialise on observed types. Monomorphic, warmed-up code is fast; polymorphic inputs cause deoptimisation back to slower paths.',
},
{text: 'Production builds disable optimisation', width: false, why: 'Production builds are the optimised ones; JIT behaviour is a runtime matter regardless.'},
{text: 'The benchmark measured a different function due to inlining', why: 'Inlining can distort benchmarks, and it does not explain a consistent slowdown with varied data.'},
{text: 'Garbage collection does not run during benchmarks', why: 'It runs during both, and it would not produce this specific pattern.'},
]}
explanation={<>Warm up before measuring, use realistic data, and prefer consistently shaped objects in hot paths. A benchmark that runs a loop once measures the interpreter; one that runs it a million times measures code production may never reach.</>}
reference={{label: 'Interpreters, compilers and JIT', href: '/knowledge-base/general/how-code-runs#interpreters-compilers-and-jit'}}
/>

<Quiz
question="Why can a bundler tree-shake `import {x} from './m.js'` but not `const {x} = require('./m.js')`?"
options={[
{
text: 'ESM imports are resolved statically before execution, so the full dependency graph is known without running the code; require() is a runtime call whose argument could be computed',
correct: true,
why: 'Static resolution is what makes the analysis sound. A runtime call with a potentially dynamic path cannot be proven to resolve to any particular module.',
},
{text: 'CommonJS modules are always larger than ES modules', width: false, why: 'Size is unrelated; analysability is the constraint.'},
{text: 'require() loads synchronously, which prevents optimisation', why: 'Synchronous loading is a real difference and not what blocks dead-code elimination.'},
{text: 'Bundlers deliberately skip CommonJS for compatibility', why: 'They process CommonJS; they simply cannot prove which exports are unused.'},
]}
explanation={<>This static/dynamic split is the single most consequential difference between the two module systems, and the reason to write ESM in new code and set <code>"type": "module"</code> in Node.</>}
reference={{label: 'Modules', href: '/knowledge-base/general/how-code-runs#modules'}}
/>

<Quiz
question="A production error report shows a stack trace pointing at `main.a3f2.js:1:48120`. What is missing, and what is the risk of the naive fix?"
options={[
{
text: 'Source maps — generate them and upload to the error tracker, but do not serve them publicly if the source is closed',
correct: true,
why: 'Source maps translate minified positions back to original source. Serving them from the public bundle makes the entire source readable in DevTools.',
},
{text: 'Minification should be disabled in production', width: false, why: 'That fixes readability by shipping far more bytes to every user, and still exposes the source.'},
{text: 'The error tracker needs the original repository access', why: 'Trackers symbolicate from uploaded source maps, not repository access.'},
{text: 'Stack traces require the code to be unbundled', why: 'Bundled code produces perfectly good traces once source maps are available.'},
]}
explanation={<>Generate source maps in the production build, upload them to Sentry or equivalent as a build step, and exclude them from what the web server serves. You get readable traces without publishing your source.</>}
reference={{label: 'Bundling, minification and tree shaking', href: '/knowledge-base/general/how-code-runs#bundling-minification-and-tree-shaking'}}
/>

---

## References

- [MDN: JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
  — ESM semantics and CommonJS interoperability.
- [Node.js: Modules — Packages](https://nodejs.org/api/packages.html) — the
  `exports` map, dual packages and resolution rules.
- [TypeScript: Modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
  — how TypeScript resolves and emits modules.
- [Rollup: Tree shaking](https://rollupjs.org/introduction/#tree-shaking) — what
  the analysis can and cannot prove.
- [webpack: `sideEffects`](https://webpack.js.org/guides/tree-shaking/) —
  declaring side-effect-free modules.
- [V8: Understanding the JIT](https://v8.dev/blog/turbofan-jit) — optimisation
  and deoptimisation in practice.
