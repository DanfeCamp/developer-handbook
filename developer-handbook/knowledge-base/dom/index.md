---
id: dom
title: DOM
---

### **DOM (Document Object Model)**

The **Document Object Model (DOM)** is an in-memory representation of the HTML document. When a web page is loaded, the browser parses the HTML and generates a tree structure, where each node represents a part of the document (such as elements, attributes, and text). This tree structure allows scripts, like JavaScript, to manipulate the content and structure of the web page dynamically.

- **Tree Structure:** The DOM is organized as a hierarchical tree where the root node represents the document itself, and branches represent the nested elements. For example, the `<html>` element is the parent, with `<head>` and `<body>` as its children, and so on.

- **Interactive Interface:** The DOM provides a programming interface for JavaScript to access and modify elements, attributes, and content. This allows developers to change the page dynamically (e.g., updating text, handling user events like clicks, or adding/removing elements).

### **Shadow DOM**

The **Shadow DOM** is a part of the web component standard that provides encapsulation of DOM elements and styles. It allows you to create a self-contained "shadow" subtree within a component, isolated from the rest of the document's DOM. This encapsulation ensures that the styles and structure of the shadow DOM do not interfere with the global DOM and vice versa.

- **Encapsulation:** When you create a shadow DOM within a web component, the styles and structure inside the shadow DOM are hidden from the main DOM. This prevents styles from "leaking" in or out, ensuring that the component looks and behaves consistently, regardless of the surrounding context.

- **CSS Isolation:** Styles defined inside a shadow DOM are scoped to that specific component. This means that global styles (in the main DOM) won’t affect the shadow DOM, and the component’s internal styles won’t affect other parts of the page.

- **Event Bubbling Isolation:** Events that originate inside the shadow DOM follow the same bubbling and capturing phase, but the event propagation is isolated. Events from the shadow DOM won’t bubble up to the main DOM, and events in the main DOM won’t propagate into the shadow DOM. This makes it easier to manage events in a more predictable, component-centric way.

### **Virtual DOM**

The **Virtual DOM** is a lightweight, virtual representation of the actual DOM. It is an abstraction layer that frameworks like React use to optimize DOM manipulation. Instead of directly manipulating the real DOM every time a change occurs (which can be slow and inefficient), the virtual DOM allows changes to be made in-memory first. Once updates are determined, they are applied to the real DOM in a single, optimized operation.

- **How It Works:**
  - **Initial Render:** The virtual DOM is a copy of the real DOM, representing the current structure and state of the document.
  - **Changes:** When a change occurs (such as a user interaction or state update), the framework updates the virtual DOM.
  - **Diffing:** The framework compares (or "diffs") the new virtual DOM with the previous virtual DOM to determine the minimum set of changes needed.
  - **Batching Changes:** Instead of making multiple small changes to the real DOM, the framework applies all necessary changes in one batch operation, improving performance.

- **Efficiency:** Updating the real DOM frequently can be slow because of the way the browser handles rendering and layout calculations. The virtual DOM minimizes direct interaction with the real DOM, allowing the browser to handle updates more efficiently.

- **React Example:** In React, when state changes in a component, the virtual DOM is updated first. React then calculates the difference (diffing) between the new virtual DOM and the old virtual DOM, and applies only the necessary changes to the real DOM, reducing unnecessary re-renders.
