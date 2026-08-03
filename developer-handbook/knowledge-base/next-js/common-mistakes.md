---
id: common-mistakes
title: Common Mistakes
description: The App Router mistakes that cost the most time — client boundaries, fetch waterfalls, stale caches, leaked secrets — with the fix for each.
---

# Common Mistakes

Almost every mistake here comes from the same root: the App Router runs your
code in **two places**, and it is easy to lose track of which one you are in.

:::tip Three questions that prevent most of them

1. **Where does this run?** Server Component, Client Component, or both during
   hydration.
2. **When does this run?** Build time, request time, or in the browser.
3. **What is cached, and what invalidates it?** Explicit is always better than
   discovering it in production.
   :::

## Using the "use client" Directive Too High in the Component Tree

In Next.js, the `use client` directive is used to indicate that a component should be rendered on the client side. While this can be necessary for interactive features, using `use client` too high in the component tree can lead to performance issues, larger bundle sizes, and reduced SEO effectiveness. It's important to apply `use client` selectively and only where necessary to maintain the benefits of server-side rendering (SSR).

```jsx
// Wrong Approach
'use client';

import { useState } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';

export default function Page() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <Header />
      <main>
        <h1>Welcome to My App</h1>
        <button onClick={() => setCount(count + 1)}>Click me</button>
        <p>Count: {count}</p>
      </main>
      <Footer />
    </div>
  );
}
```

Using `use client` at the top level of the component tree forces the entire tree to be rendered on the client side. This negates the benefits of server-side rendering, leading to slower initial load times as the client has to download and execute more JavaScript. The increased bundle size also affects performance, especially on slower networks or less powerful devices. Additionally, client-side rendering delays the availability of content to search engine crawlers, potentially harming SEO. Hydration, the process of making server-rendered HTML interactive, becomes more expensive as more components require client-side processing.

```jsx
// Right Approach

// page.jsx
import Header from './components/Header';
import Footer from './components/Footer';
import Counter from './components/Counter';

export default function Page() {
  return (
    <div>
      <Header />
      <main>
        <h1>Welcome to My App</h1>
        <Counter /> {/* Only this part requires client-side interactivity */}
      </main>
      <Footer />
    </div>
  );
}
```

```jsx
// Counter.jsx

'use client';

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Click me</button>
      <p>Count: {count}</p>
    </div>
  );
}
```

Applying `use client` selectively ensures that only the components needing client-side interactivity are rendered on the client. This approach maintains the benefits of server-side rendering, such as faster initial load times and better SEO, as most of the content is pre-rendered on the server. It also reduces the amount of JavaScript that needs to be downloaded and executed on the client, leading to improved performance. By keeping `use client` lower in the component tree, the hydration process is less expensive and easier to manage, resulting in a more maintainable codebase.

## Using Browser APIs

When working with browser APIs like `window.localStorage` in Next.js, it's essential to use them correctly to avoid issues with server-side rendering. Directly accessing these APIs outside of client-side lifecycle methods can lead to errors because these APIs are not available during server-side rendering. Properly managing when and how these APIs are used ensures your components render correctly both on the server and client.

```js
// Wrong Approach
'use client';

export default function Home() {
  const isNewUser = window.localStorage.getItem('user-id');

  if (isNewUser) {
    console.log('New user');
  }

  return (
    <div>
      {/* Component */}
    </div>
  );
}
```

In this approach, `window.localStorage.getItem('user-id')` is called directly within the `Home` component. This code runs during both server-side and client-side rendering. Since `window` and `localStorage` are only available in the browser, attempting to access them during server-side rendering will result in errors or unexpected behavior, as these objects are not defined on the server. This can lead to issues where the component fails to render correctly or produces runtime errors during server-side rendering.

```js
// Right Approach
'use client';

import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    const isNewUser = window.localStorage.getItem('user-id');

    if (isNewUser) {
      console.log('New user');
    }
  }, []);

  return (
    <div>
      {/* Component */}
    </div>
  );
}
```

In this approach, `window.localStorage.getItem('user-id')` is accessed within the `useEffect` hook, which ensures that this code only runs on the client side. `useEffect` is a React hook that runs after the initial render, making it suitable for interacting with browser APIs that are not available during server-side rendering. This approach avoids errors related to accessing browser-specific objects during server-side rendering and ensures that the component behaves correctly in both server and client environments.

## Getting a Waterfall Effect When Fetching Data

When fetching data in Next.js, a common mistake is to await each request sequentially, creating a waterfall effect. This means subsequent requests wait for previous ones to complete, which can significantly increase the total loading time. A better approach is to fetch data concurrently, reducing the overall waiting time and improving performance.

```jsx
// Wrong Approach
import Product from './product';
import Rating from './rating';

const getProduct = async() => {
  const res = await fetch('https://fakestoreapi.com/products/2');
  const product = await res.json();
  return product;
}

const getRatings = async() => {
  const res = await fetch('https://example.com/api/ratings/2');
  const rating = await res.json();
  return rating;
}

export default async function Home() {
  const product = await getProduct();
  const ratings = await getRatings();

  return (
    <>
      <Product product={product} />
      <Ratings ratings={ratings} />
    </>
  );
}
```

In this approach, the `Home` component first waits for `getProduct` to resolve before making the `getRatings` request. This sequential fetching creates a waterfall effect, where the second request only starts after the first one finishes. This can cause unnecessary delays, as the total loading time is the sum of the individual waiting times for each request.

```jsx
// Right Approach
import Product from './product';
import Rating from './rating';

const getProduct = async() => {
  const res = await fetch('https://fakestoreapi.com/products/2');
  const product = await res.json();
  return product;
}

const getRatings = async() => {
  const res = await fetch('https://example.com/api/ratings/2');
  const rating = await res.json();
  return rating;
}

export default async function Home() {
  const [product, ratings] = await Promise.all([getProduct, getRatings]);

  return (
    <>
      <Product product={product} />
      <Ratings ratings={ratings} />
    </>
  );
}
```

In this approach, `Promise.all` is used to fetch the product and ratings concurrently. By initiating both requests at the same time, the total waiting time is reduced to the time it takes for the slower request to complete. This approach prevents the waterfall effect and significantly improves the performance of the data fetching process, leading to faster page loads and a better user experience.

## Page Not Reflecting Data Mutation

In Next.js, data fetched during server-side rendering is heavily cached to improve performance. However, this can lead to issues where the page does not reflect the latest data mutations. Developers need to specify cache revalidation strategies to ensure the page updates with new content as intended.

```jsx
// Wrong Appraoch
export default async function News() {
  const res = await fetch('https://example.com/api/news');
  const news = await res.json();

  return (
    <div>
      {news.map((item) => {
        const { title, id } = item;
        return <p key={id}>{title}</p>;
      })}
    </div>
  );
}
```

In this approach, the `News` component fetches data from an API without specifying a cache revalidation strategy. Due to Next.js's default caching mechanism, the data might be served from the cache even if the underlying data has changed. This can lead to the page displaying outdated content, as the fetched data is not revalidated and updated frequently.

```jsx
// Right Appraoch
export default async function News() {
  const res = await fetch('https://example.com/api/news', {
    next: {
      revalidate: 1,
    },
  });
  const news = await res.json();

  return (
    <div>
      {news.map((item) => {
        const { title, id } = item;
        return <p key={id}>{title}</p>;
      })}
    </div>
  );
}
```

In this approach, the `News` component includes a `revalidate` option in the fetch request. By setting `revalidate: 1`, the data is revalidated every second, ensuring that the latest data is fetched and displayed. This approach overrides the default caching behavior, forcing Next.js to check for new data at the specified interval. As a result, the page will reflect any data mutations more accurately and promptly, providing up-to-date content to users.

## Forgetting to Deal with Loading State

In Next.js, managing the loading state is crucial when fetching data asynchronously. Without handling this state, users might experience a blank or unresponsive interface while waiting for the data to load. React's `Suspense` component can be used to elegantly manage the loading state by displaying a fallback UI until the data is fully loaded.

```jsx
// app/home/page.jsx (Wrong Approach)
export default async function Home() {
  const res = await fetch('https://example.com/api/123');
  const data = await res.json();

  return (
    <div>
      {data.map((item) => {
        return <p id={item.id}>{item.title}</p>;
      })}
    </div>
  );
}
```

In this approach, the `Home` component fetches data and directly renders it. There is no handling for the loading state, so while the data is being fetched, users might see an empty or incomplete page. This can lead to a poor user experience as there's no indication that data is being loaded in the background.

```jsx
// app/home/page.jsx (Right Approach)
import { Suspense } from 'react';
import Product from '@/components/product';

export default async function Home() {
  return (
    <Suspense fallback="Loading...">
      <Product />
    </Suspense>
  );
}

// app/component/product.jsx
export default async function Product() {
  const res = await fetch('https://example.com/api/123');
  const data = await res.json();

  return (
    <div>
      {data.map((item) => {
        return <p key={item.id}>{item.title}</p>;
      })}
    </div>
  );
}
```

In this approach, the `Home` component uses the Suspense component from React to handle the loading state. By wrapping the `Product` component in `Suspense` and providing a `fallback` prop, Next.js automatically displays the `fallback` content ("Loading...") while the `Product` component is fetching data. This approach leverages React's concurrent features to provide a smoother user experience, ensuring users receive immediate feedback that data is being loaded. `Suspense` simplifies loading state management and makes the application more responsive and user-friendly.

## Hardcoding Secrets

In web development, handling sensitive information like API keys or secret keys is crucial for maintaining security. Hardcoding secrets directly in your code can lead to unintentional exposure, which can be exploited by malicious actors. Instead, secrets should be stored in environment variables, which provide a safer and more flexible way to manage sensitive information.

```jsx
// app/home/page.jsx (Wrong Approach)
export default function Home() {
  const SECRET_KEY = 'XYZ';
  // Code
}
```

In this approach, the `SECRET_KEY` is hardcoded directly within the component. This approach is risky because the secret is exposed in the source code, which can be viewed by anyone with access to the codebase. If the code is pushed to a public repository or shared inadvertently, the secret is compromised. Additionally, managing secrets directly in the code is inflexible and makes it difficult to change them across different environments (development, testing, production) without modifying the code.

```jsx
// app/home/page.jsx (Right Approach)
export default function Home() {
  const SECRET_KEY = process.env.SECRET_KEY;
  // Use the secret key in your code
  ...
}

// .env file
SECRET_KEY=XYZ
```

In this approach, the `SECRET_KEY` is stored in an environment variable. By using `process.env.SECRET_KEY`, the secret key is retrieved from the environment, making it much more secure. Environment variables are defined in a `.env` file, which should be added to `.gitignore` to ensure it is not included in version control. This approach prevents the secret from being exposed in the source code and allows for easy configuration across different environments. Secrets can be managed and rotated without changing the codebase, enhancing security and maintainability.

**Note:** If you want to explicitly make the secrets publicly available then use `NEXT_PUBLIC_` prefix with the secret.

## Using Redirect in Try Catch

In Next.js, the `redirect` function is used to navigate the user to a different route. However, it's important to understand that redirect throws an error to stop further execution and initiate the redirect process. Placing the `redirect` function inside a `try` block can cause it to be caught by the `catch` block, which is not the intended behavior.

```jsx
// Wrong Approach
import { redirect } from 'next/navigation';

export default async function Product() {
  let product;

  try {
    const res = await fetch('https://fakestoreapi.com/products/1');
    product = await res.json();

    if (!product) {
      redirect('/create-product');
    }
  } catch (e) {
    console.error(e);
  }

  return (
    <p>{product.title}</p>
  );
}
```

In this approach, the `redirect` function is used inside the `try` block. Since `redirect` throws an error to halt the current execution and redirect the user, this error is caught by the `catch` block. As a result, the redirect does not work as intended, and the catch block handles it as a regular error, potentially causing issues with error handling and user navigation.

```jsx
// Right Approach
import { redirect } from 'next/navigation';

export default async function Product() {
  let product;

  try {
    const res = await fetch('https://fakestoreapi.com/products/1');
    product = await res.json();
  } catch (e) {
    console.error(e);
  }

  if (!product) {
    redirect('/create-product');
  }

  return (
    <p>{product.title}</p>
  );
}
```

In this approach, the `redirect` function is placed outside the `try` block. By doing so, any errors thrown by `redirect` will not be caught by the `catch` block, allowing the redirect to proceed as intended. This ensures that the user is properly redirected to the `/create-product` page if the `product` is not found. Separating the `redirect` logic from the `try-catch` block provides clearer and more predictable error handling and navigation.

The same applies to `notFound()`, which works by throwing in exactly the same
way.

---

## Two More Worth Knowing

### Forgetting that request APIs are asynchronous

Next.js 15 made `params`, `searchParams`, `cookies()` and `headers()` return
promises. The failure is quiet — you get `undefined` rather than an error:

```tsx
// ❌ Next.js 14 and earlier
export default function Page({params}: {params: {slug: string}}) {
  return <h1>{params.slug}</h1>; // undefined
}

// ✅
export default async function Page({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  return <h1>{slug}</h1>;
}
```

This is the single most common Next.js 14 → 16 upgrade break.

### Treating a Server Action as private

`'use server'` creates a **public HTTP endpoint**. The form is not a gate —
anyone can invoke the action directly with any arguments they like.

```ts
'use server';

export async function deleteOrder(id: string) {
  // ❌ No checks: any caller can delete any order.
  await db.order.delete({where: {id}});
}
```

```ts
'use server';

export async function deleteOrder(id: string) {
  const session = await auth(); //         who are you?
  if (!session) throw new Error('Unauthorized');

  const order = await db.order.findUnique({where: {id}});
  if (order?.userId !== session.user.id) {
    // may you touch this one?
    throw new Error('Not found');
  }

  await db.order.delete({where: {id}});
  revalidateTag('orders');
}
```

Authenticate **and** authorise inside every action, exactly as you would in a
[Route Handler](/knowledge-base/next-js/api-routes#authentication).

---

## Check your understanding

<Quiz
question="A layout at app/(app)/layout.tsx starts with 'use client' so it can use a theme toggle. What is the consequence?"
options={[
{
text: 'Every component rendered inside that layout becomes part of the client bundle, so the whole section loses Server Component benefits',
correct: true,
why: "'use client' marks a boundary, not a single file. Everything imported below it is client code — no direct database access, no server-only dependencies, and a much larger bundle.",
},
{
text: 'Only the layout itself becomes a Client Component; children are unaffected',
why: 'Children rendered by a Client Component are also client code. The exception is content passed as children from a Server Component parent.',
},
{
text: 'Nothing — layouts are always rendered on the server regardless',
why: 'A layout with the directive is a Client Component like any other.',
},
{
text: 'Metadata exports continue to work as normal',
why: 'They are ignored in Client Components — a second casualty of putting the directive too high.',
},
]}
explanation={<>Keep the layout a Server Component and extract the toggle into its own <code>'use client'</code> leaf. Content can still be passed through as <code>children</code> and stay server-rendered.</>}
reference={{label: 'use client too high', href: '/knowledge-base/next-js/common-mistakes#using-the-use-client-directive-too-high-in-the-component-tree'}}
/>

<Quiz
question="A page awaits three independent data fetches in sequence and takes 900 ms. Each fetch takes about 300 ms. What is the fix?"
options={[
{
text: 'Start all three and await them together with Promise.all, so they run in parallel',
correct: true,
why: 'Sequential awaits create a waterfall: each request waits for the previous to resolve even though none depends on the others. In parallel the page waits for the slowest, roughly 300 ms.',
},
{text: 'Move the fetches into a Client Component with useEffect', why: 'That adds a round trip after hydration and makes it slower, not faster.'},
{text: 'Add a loading.tsx file', why: 'Improves perceived performance by showing a fallback, but the data still takes 900 ms to arrive.'},
{text: 'Cache each fetch with use cache', why: 'Helps on subsequent requests; the first uncached request still waterfalls.'},
]}
explanation={<>Sequential awaits are only correct when a later request genuinely needs an earlier result. Otherwise start them together. Suspense boundaries let independently slow sections stream in without blocking the shell.</>}
reference={{label: 'Waterfall effect', href: '/knowledge-base/next-js/common-mistakes#getting-a-waterfall-effect-when-fetching-data'}}
/>

<Quiz
question="Which of these correctly keep a secret out of the browser bundle?"
type="multiple"
options={[
{text: 'Read process.env.DATABASE_URL only inside a Server Component or Route Handler', correct: true, why: 'Variables without the NEXT_PUBLIC_ prefix are server-only, provided the module is never imported into client code.'},
{text: 'Add import "server-only" at the top of the module holding the secret', correct: true, why: 'Turns an accidental client import into a build error rather than a silent leak.'},
{text: 'Access it in a Server Action', correct: true, why: 'Server Actions execute on the server; the code is never sent to the browser.'},
{text: 'Prefix it NEXT_PUBLIC_ so Next.js manages it properly', why: 'The opposite: that prefix explicitly inlines the value into the client bundle.'},
{text: 'Store it in a Client Component but never render it', why: 'Anything imported by client code ships to the browser, rendered or not. It is readable in the bundle.'},
]}
explanation={<>The <code>server-only</code> package is the highest-value line here: it converts a class of invisible leak into a loud build failure.</>}
reference={{label: 'Hardcoding secrets', href: '/knowledge-base/next-js/common-mistakes#hardcoding-secrets'}}
/>

<Quiz
question="After a Server Action creates a record, the list page still shows the old data until a hard refresh. Why?"
options={[
{
text: 'The cached route was not invalidated — the action needs revalidatePath or revalidateTag',
correct: true,
why: 'Next.js caches rendered output and data. A mutation must explicitly tell the framework what is now stale, otherwise the cached version continues to be served.',
},
{text: 'Server Actions cannot modify data that a page reads', why: 'They can and routinely do; the missing piece is cache invalidation.'},
{text: 'The page needs export const dynamic = "force-dynamic"', why: 'It would work by disabling caching entirely — throwing away the performance benefit rather than invalidating precisely.'},
{text: 'router.refresh() must be called from the server', why: 'router.refresh() is a client API, and targeted revalidation is the better tool here.'},
]}
explanation={<>Prefer <code>revalidateTag</code> over <code>revalidatePath</code> where you can: tags let one mutation invalidate exactly the data it affected, across whichever routes happen to use it.</>}
reference={{label: 'Page not reflecting data mutation', href: '/knowledge-base/next-js/common-mistakes#page-not-reflecting-data-mutation'}}
/>

<Quiz
question="This Server Component throws 'NEXT_REDIRECT' and renders an error page instead of redirecting. What is wrong?"
options={[
{
text: 'redirect() works by throwing a special error, and the try/catch swallows it',
correct: true,
why: 'Both redirect() and notFound() signal by throwing. Catching that error stops Next.js seeing the signal, so it is handled as an ordinary failure.',
},
{text: 'redirect() cannot be used in a Server Component', why: 'It is designed for exactly this. The problem is the surrounding try/catch.'},
{text: 'The redirect target must be an absolute URL', why: 'Relative paths are supported and idiomatic.'},
{text: 'redirect() must be awaited', why: 'It does not return a promise; it throws.'},
]}
explanation={<>Call <code>redirect()</code> and <code>notFound()</code> <em>after</em> the try/catch, using its result to decide. If you must catch broadly, re-throw anything matching Next.js's internal error signals.</>}
reference={{label: 'Using redirect in try/catch', href: '/knowledge-base/next-js/common-mistakes#using-redirect-in-try-catch'}}>

```tsx
export default async function Page({params}) {
  try {
    const {id} = await params;
    const product = await getProduct(id);
    if (!product) redirect('/create-product');
    return <ProductView product={product} />;
  } catch (error) {
    return <ErrorMessage />;
  }
}
```

</Quiz>

---

## References

- [Server and Client Components](https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns)
  — where the boundary belongs.
- [Caching in Next.js](https://nextjs.org/docs/app/building-your-application/caching)
  — the four caches and what invalidates each.
- [Server Actions security](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#security)
  — why every action needs its own checks.
- [redirect()](https://nextjs.org/docs/app/api-reference/functions/redirect) —
  the throwing behaviour, documented.
- [Common Misconceptions](/knowledge-base/next-js/common-misconceptions) — the
  companion page on what people believe that is not true.
