---
id: common-misconceptions
title: Common Misconceptions
---

# Common Misconceptions

## Thinking that a Component is a Server Component Because It Does Not Have "use client" Directive

In Next.js, there is a common misconception that a component is automatically a server component if it does not have the use client directive. This assumption can lead to misunderstandings about how the component is rendered and can impact the overall performance and functionality of your application. It's essential to understand the distinction between server components and client components to utilize Next.js effectively.

```jsx
'use client';

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

In the example above, the `Page` component is explicitly marked with the `use client` directive. This means that the entire `Page` component, along with all its child components (`Header`, `Footer`, and `Counter`), will be rendered on the client side. The `use client` directive applied at the top level of the `Page` component cascades down, affecting all nested components.

The `Counter` component uses the `useState` hook, which requires it to be a client component. By placing the `use client` directive in the parent `Page` component, it ensures that `Counter` and any other child components are rendered on the client side, even if they do not explicitly include the `use client` directive themselves.

The rendering context is inherited from the parent component. Therefore, once a component is designated as a client component, all its children are also client components by extension.

## Thinking that a Server Component Becomes a Client Component if You Wrap It Inside a Client Component

In Next.js, there is a common misconception that wrapping a server component inside a client component will automatically transform it into a client component. This misunderstanding can lead to improper usage of components and inefficient rendering. Understanding how server and client components interact is crucial for leveraging the full benefits of both server-side and client-side rendering.

```jsx
import ThemeProvider from './components/ThemeProvider';
import Header from './components/Header';
import Footer from './components/Footer';
import Counter from './components/Counter';

export default function Page() {
  return (
    <ThemeProvider>
      <Header />
      <main>
        <h1>Welcome to My App</h1>
        <Counter /> {/* Only this part requires client-side interactivity */}
      </main>
      <Footer />
    </ThemeProvider>
  );
}
```

```jsx
'use client';

import { createContext, useState } from 'react';

export const ThemeContext = createContext();

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light');

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

```jsx
export default function Header() {
  return (
    <header>
      <h1>My App</h1>
      <p>Welcome to the server-rendered app!</p>
    </header>
  );
}
```

In the example above, the `ThemeProvider` component is marked with the `use client` directive, indicating that it should be rendered on the client side. This means that any state or context management handled within `ThemeProvider` will be executed on the client side. However, wrapping server components like `Header` inside `ThemeProvider` does not change the nature of `Header` component.

The `Header` component is a server component, meaning it does not rely on client-side hooks like `useState` or `useEffect`. Even though it is wrapped by the client-side `ThemeProvider`, `Header` retains its server-side characteristics. This allows Header to benefit from server-side rendering, offering faster initial load times and better SEO.

The key point here is that the server or client nature of a component is not inherited by being a child of another component. Each component maintains its own rendering context. Server components wrapped inside client components do not automatically gain client-side interactivity; they remain static and rendered on the server. Conversely, client components wrapped by server components do not lose their interactivity but will need to ensure proper client-side context management.

## Thinking that Client Component Only Runs in the Client Side

A common misconception in Next.js is that client components marked with the `use client` directive only execute on the client side. However, Next.js pre-renders components, including client components, on the server side before sending them to the client.

```jsx
'use client';

export default function Display() {
  console.log('Hello World');

  return (
    <div>
    {/* Component */}
    </div>
  );
}
```

In the example above, the `Display` component is explicitly marked with the `use client` directive, which indicates that it should be rendered on the client side. However, Next.js pre-renders components on the server before sending the rendered HTML to the client. This means that the `Display` component will be executed on the server during this pre-rendering process.

When `Display` is pre-rendered on the server, the console.log('Hello World') statement will be executed, and "Hello World" will be printed to the server terminal. This behavior might be unexpected if you assume that client components only run on the client side. After pre-rendering, the component is sent to the client, where it can then interact with the client-side environment, including managing state and handling user interactions.

## Thinking It's a Problem to Get the Same Data in Different Places

In Next.js, it's common to fetch data in multiple components. A common concern is that fetching the same data in different places might lead to unnecessary network requests, causing performance issues. However, Next.js handles this efficiently by caching data, ensuring that repeated requests for the same data are served from the cache rather than making new network requests.

```js
export default async function Title() {
  const res = await fetch('https://fakestoreapi.com/products/2');
  const product = await res.json();
  return <p>{product.title}</p>;
}
```

```js
export default async function Price() {
  const res = await fetch('https://fakestoreapi.com/products/2');
  const product = await res.json();
  return <p>{product.price}</p>;
}
```

In the above examples, both the `Title` and `Price` components fetch data from the same endpoint (`https://fakestoreapi.com/products/2`). At first glance, it might seem inefficient to fetch the same data in two different places. However, Next.js optimizes this by caching the data. When the same request is made multiple times, Next.js serves the data from the cache instead of making another network request. This approach ensures efficient data fetching and minimizes unnecessary network traffic, enhancing the application's performance.

This caching mechanism allows you to confidently fetch the same data in multiple components without worrying about redundant network requests. It simplifies your data-fetching logic and improves performance by reducing load times and server strain.

## Dynamic Route VS Search Parameter

In Next.js, both search parameters (query parameters) and dynamic routes are used to pass data through URLs, but they serve different purposes and are handled differently.

:::warning `params` and `searchParams` are Promises
As of **Next.js 16**, `params` and `searchParams` are asynchronous and must be
awaited. Synchronous access — common in tutorials written for Next.js 14 and
earlier — was removed and now throws at request time.
:::

```jsx
export default async function ProductPage({ params, searchParams }) {
  const { id } = await params;
  const { color } = await searchParams;

  return (
    <div>
      <p>Product ID: {id}</p>
      <p>Product Color: {color}</p>
    </div>
  );
}
```

In the example above, `ProductPage` receives both `params` and `searchParams` as
props. These two types of parameters represent different ways to pass data
through the URL.

**1. Dynamic Route (`params`):**

- The dynamic route is defined using square brackets in the file name, such as `/product/[id]`. This creates a dynamic segment in the URL, for example, `/product/123`.
- Awaiting `params` yields the values of these dynamic segments. In this case, `id` would be `123`.
- Dynamic routes are typically used to uniquely identify a resource, such as a specific product, user, or post.

**2. Search Parameter (`searchParams`):**

- Search parameters (also known as query parameters) are included in the URL after a `?`, such as `/product/123?color=red`.
- Awaiting `searchParams` yields the key-value pairs from the query string. In this case, `color` would be `red`.
- Search parameters are often used to filter or sort data, provide additional context, or pass non-essential data.

Note the practical difference: because `searchParams` can change without
changing the route, reading it makes a page dynamic. A page that only reads
`params` can still be statically generated via `generateStaticParams`.

<Quiz
question="Why does this Next.js 16 page throw at request time even though the build succeeded?"
options={[
{
text: 'params is a Promise and must be awaited',
correct: true,
why: 'Next.js 16 removed synchronous access to params, searchParams, cookies(), headers() and draftMode().',
},
{
text: 'The component is missing the "use client" directive',
why: 'Reading params does not require client rendering — Server Components receive it directly.',
},
{
text: 'Dynamic routes require generateStaticParams',
why: 'generateStaticParams is only needed to pre-render dynamic routes at build time; it is optional.',
},
{
text: 'Server Components cannot be async',
why: 'The opposite — Server Components are allowed to be async, which is how they fetch data directly.',
},
]}
explanation={<>The build only type-checks and compiles; the invalid access is not exercised until a request hits the route. This is why the upgrade guide recommends running the codemod and then testing each route.</>}

>

```jsx
export default function ProductPage({ params }) {
  return <p>Product ID: {params.id}</p>;
}
```

</Quiz>
