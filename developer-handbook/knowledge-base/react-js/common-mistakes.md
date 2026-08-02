---
id: common-mistakes
title: Common Mistakes
---

# Common Mistakes

## State updates aren't immediate

React's state updates are asynchronous. When you call `setState` (in this case, `setCount`), React schedules an update to the component's state.

```js
// Wrong Approach
const handleClick = () => {
  setCount(count + 1);
  setCount(count + 1);
  setCount(count + 1);
}
```

In this approach, the state update function `setCount` is called multiple times with a direct reference to the current state value `count`. React batches these state updates, so all three calls end up using the same initial state value. As a result, `count` is only incremented once, leading to an incorrect final value.

```js
// Right Approach
const handleClick = () => {
  setCount((prev) => prev + 1);
  setCount((prev) => prev + 1);
  setCount((prev) => prev + 1);
}
```

In this approach, the state update function `setCount` is called multiple times with a function that takes the previous state value (`prev`) and returns the new state value. This ensures that each state update is based on the most recent state, resulting in `count` being correctly incremented by 1 each time, for a total increment of 3.

## Conditional Rendering

React hooks must be called in the exact same order on every render of a component. This rule is crucial to ensure that React can correctly manage the state and effects of your components. Conditional rendering can sometimes cause issues if hooks are called conditionally, leading to unpredictable behavior and bugs.

```js
// Wrong Approach
export default function ProductCard({ id }) {
  if (!id) {
    return <p>No id provided</p>;
  }

  const [productDetails, setProductDetails] = useState({});

  useEffect(() => {
    // Fetch the product details
  }, []);

  return <section>{/* Product Card */}</section>;
}
```

In this approach, the `useState` and `useEffect` hooks are called conditionally, based on whether the `id` prop is provided. If `id` is not provided, the component returns early and skips the hook calls. This violates the rule that hooks must be called in the same order on every render. When hooks are called conditionally, React loses track of the state and effect dependencies, leading to potential bugs and unpredictable behavior.

```js
// Right Approach
export default function ProductCard({ id }) {
  const [productDetails, setProductDetails] = useState({});

  useEffect(() => {
    // Fetch the product details
  }, []);

  if (!id) {
    return <p>No id provided</p>;
  }

  return <section>{/* Product Card */}</section>;
}
```

In this approach, the `useState` and `useEffect` hooks are called unconditionally at the top of the component. This ensures that the hooks are always called in the same order on every render, complying with React’s rules of hooks. After the hooks are called, the component checks if the `id` prop is provided and returns early if it's not. This structure maintains the consistency of hook calls, ensuring predictable and correct behavior. By calling the hooks unconditionally, you ensure that React can properly manage the component’s state and effects, avoiding issues that arise from conditional hook calls.

## Managing State for Form Data

When managing form data in React, it’s important to use state efficiently to keep the code clean and maintainable. There are different approaches to handling state for multiple form inputs, and choosing the right approach can simplify state management.

```js
// Wrong Approach
export default function Form() {
  const [name, setName] = useState('');
  const [age, setAge] = useState(0);
  const [city, setCity] = useState('');

  const handleNameChange = (e) => {
    setName(e.target.value);
  };
  const handleAgeChange = (e) => {
    setAge(e.target.value);
  };
  const handleCityChange = (e) => {
    setCity(e.target.value);
  };

  return (
    <form>
      <input value={name} onChange={handleNameChange} name="name" placeholder="Name" />
      <input value={age} onChange={handleAgeChange} name="age" placeholder="Age" />
      <input value={city} onChange={handleCityChange} name="city" placeholder="City" />
    </form>
  );
};
```

In this approach, each form input has its own piece of state and corresponding handler function. The `name`, `age`, and `city` inputs each have their own `useState` call and handler functions (`handleNameChange`, `handleAgeChange`, and `handleCityChange`). While this works, it quickly becomes unwieldy as the number of inputs grows. Managing state separately for each input can lead to repetitive code and makes it harder to maintain the form logic.

```js
// Right Approach
export default function Form() {
  const [form, setForm] = useState({});

  const handleChange = (e) => {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <form>
      <input value={name} onChange={handleNameChange} name="name" placeholder="Name" />
      <input value={age} onChange={handleAgeChange} name="age" placeholder="Age" />
      <input value={city} onChange={handleCityChange} name="city" placeholder="City" />
    </form>
  );
};
```

In this approach, a single state object `form` is used to manage all form inputs. The `useState` hook initializes the `form` object, and the `handleChange` function is a generalized handler for all input changes. This function updates the `form` state by using the spread operator to maintain the existing state and dynamically setting the value for the input that triggered the change event. Each input's `value` is accessed from the `form` state object, ensuring that all inputs are managed within a single state structure. This approach reduces repetitive code, simplifies state management, and makes the form logic more maintainable, especially as the number of inputs grows.

## Deriving Information from State

When working with state in React, it's important to recognize when certain pieces of state can be derived from other state values. This helps in keeping the state minimal and avoiding unnecessary re-renders.

```js
// Wrong Approach
const PRICE_PER_ITEM = 10;

export default function Cart() {
  const [numberOfItems, setNumberOfItems] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);

  const handleClick = () => {
    setNumberOfItems(numberOfItems + 1);
  };

  useEffect(() => {
    setTotalPrice(numberOfItems * PRICE_PER_ITEM);
  }, [numberOfItems]);

  return (
    <div>
      <button onClick={handleClick}>Add 1 Item</button>
      <p>Total Price: {totalPrice}</p>
    </div>
  );
};
```

In this approach, both `numberOfItems` and `totalPrice` are stored in the component state. When the number of items changes, a side effect is used to update the total price. This introduces unnecessary complexity and potential for bugs, as the total price is always directly dependent on the number of items. Managing `totalPrice` as a separate state variable can lead to inconsistencies and redundant state updates.

```js
// Right Approach
const PRICE_PER_ITEM = 10;

export default function Cart() {
  const [numberOfItems, setNumberOfItems] = useState(0);
  const totalPrice = numberOfItems * PRICE_PER_ITEM;

  const handleClick = () => {
    setNumberOfItems(numberOfItems + 1);
  };

  return (
    <div>
      <button onClick={handleClick}>Add 1 Item</button>
      <p>Total Price: {totalPrice}</p>
    </div>
  );
};
```

In this approach, only `numberOfItems` is stored in the state. The `totalPrice` is derived directly from `numberOfItems` within the render method. This approach simplifies the component by reducing the amount of state and eliminating the need for a side effect to update the total price. As a result, the component is easier to understand and maintain, and it ensures that the `totalPrice` is always consistent with the `numberOfItems`. By deriving `totalPrice` directly from `numberOfItems`, you avoid redundant state updates and keep the state management straightforward.

## Primitive VS Non-primitive Data for State Management

When using state in React, it is important to ensure that dependencies in hooks are as specific as possible to avoid unnecessary re-renders and side effects. In JavaScript, primitive data types such as numbers or strings are compared by value, meaning `a = 1` and `b = 1` are considered equal. However, non-primitive data types like objects and arrays are compared by reference. This means that even if two objects contain the same properties and values, they are not considered equal unless they reference the same instance. For example, `a = {}` and `b = {}` are not equal because they reference different objects.

```js
// Wrong Approach
export default function Product() {
  const [product, setProduct] = useState({
    id: 0,
    price: 0,
    title: '',
  });

  const changeProduct = () => {
    setProduct({
      id: 1,
      price: 100,
      title: 'New Product',
    });
  };

  useEffect(() => {
    console.log('Product changed');
  }, [product]);

  return <button onClick={changeProduct}>Change Product</button>;
};
```

In this approach, the `useEffect` hook has a dependency on the entire `product` object. This means that any change to any property of the product object will trigger the effect. This can lead to unnecessary re-renders and side effects even when irrelevant properties change. In this example, even if only the `price` or `title` changes, the effect will run, potentially causing performance issues or unexpected behavior.

```js
// Right Approach
export default function Product() {
  const [product, setProduct] = useState({
    id: 0,
    price: 0,
    title: '',
  });

  const changeProduct = () => {
    setProduct({
      id: 1,
      price: 100,
      title: 'New Product',
    });
  };

  useEffect(() => {
    console.log('Product changed');
  }, [product.id]);

  return <button onClick={changeProduct}>Change Product</button>;
};
```

In this approach, the `useEffect` hook has a dependency on `product.id` specifically. This ensures that the effect only runs when the `id` property of the `product` object changes. By narrowing the dependency array to the most relevant state properties, you can avoid unnecessary side effects and re-renders. This makes the component more efficient and easier to reason about. In this example, the effect will only run when the `id` changes, which is a more specific and likely scenario where you want to trigger the effect, such as when the product identity changes.

## Stale Closure

Stale closures occur when a function within a hook references state or props from an outdated render, leading to unexpected behavior. This typically happens because the function "closes over" the variables from its creation context, and if those variables change, the function won't reflect the updated values.

```js
// Wrong Approach
export default function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() =>{
      setCount(count + 1);
    }, [1000]);

    return () => clearInterval(intervalId);
  }, []);
};
```

In this approach, the `setInterval` callback references the `count` variable from the initial render. Since the `useEffect` dependency array is empty, the effect only runs once when the component mounts, and the `count` variable remains at its initial value of 0 inside the interval callback. As a result, the `setCount` call will always increment from 0, causing the count state to remain stuck at 1.

```js
// Right Approach
export default function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCount((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);
};
```

In this approach, the `setInterval` callback uses the functional form of the state setter function, `setCount`. By passing a function to `setCount`, React will use the latest state value every time the interval callback runs. This approach avoids the stale closure issue because the `prev` argument in the updater function is always the most recent state value.

## Fetching in useEffect

When fetching data in React components, it is crucial to manage the loading state properly to provide feedback to the user and prevent multiple concurrent requests. Disabling the fetch button while the previous request is still loading is a good practice to enhance user experience and ensure data consistency.

```js
// Wrong Approach
export default function Post() {
  const [id, setId] = useState(1);
  const [post, setPost] = useState(null);

  useEffect(() => {
    fetch(`https://dummyjson.com/posts/${id}`)
      .then((res) => res.json())
      .then((data) => setPost(data));
  }, [id]);

  return <button onClick={() => setId(Math.floor(Math.random * 100))}>Next Post</button>
};
```

In this approach, the fetch request is initiated whenever the `id` changes. However, there is no handling of the loading state, and the fetch button is not disabled during the request, leading to potential multiple concurrent requests and race conditions.

```js
// Right Approach
export default function Post() {
  const [id, setId] = useState(1);
  const [post, setPost] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`https://dummyjson.com/posts/${id}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        setPost(data);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Fetch error:', err);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    return () => controller.abort();
  }, [id]);

  return <button onClick={() => setId(Math.floor(Math.random * 100))} disabled={isLoading}>Next Post</button>
};
```

In this approach, an `isLoading` state is added to manage the loading state of the fetch request. The `isLoading` state is set to `true` when the fetch request starts and is reset to `false` when the fetch request completes or fails. The fetch button is disabled while the `isLoading` state is `true`, preventing multiple concurrent requests.
