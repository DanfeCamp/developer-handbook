---
title: General Concepts
description: Cross-cutting software engineering concepts that apply across languages and frameworks.
---

# General Concepts

### Tree Shaking vs Dead Code Elimination

**Tree shaking** is a term used in the JavaScript ecosystem that refers to the process of eliminating unused code (dead code) from the final bundle of an application. While the concept of **dead code elimination** exists in many programming languages, tree shaking is specific to JavaScript, particularly in the context of **module bundlers** like Webpack or Rollup.

But why is it called _tree shaking_?

Imagine the structure of your application as a tree. The different modules, components, and functions you import into your app are like branches and leaves on this tree. Some of these modules (leaves) are necessary for your application to function, while others (dead leaves) are unused and only contribute to unnecessary bulk. Tree shaking is the process of "shaking the tree" to remove these dead leaves, i.e., the unused imports and code, resulting in a cleaner and more efficient build.

#### How Tree Shaking Works

When bundling your application, the bundler can visualize the module imports and exports as a tree. It identifies which parts of the code are actually being used and which are not. For example, you might import a library or module that contains multiple functions or components, but you may only use one or two. Tree shaking ensures that only the components or functions you are actively using are included in the final output, removing the unused portions.

#### Why Is Tree Shaking Important?

Many libraries, especially large ones, include a wide range of components, utility functions, and features. Often, developers only use a small subset of what the library provides. Without tree shaking, the final bundled JavaScript file may include **all** components, leading to bloated files, slower load times, and poor performance, particularly in production environments.

By performing tree shaking, the bundler reduces the size of the final build by eliminating dead code. This results in faster downloads, quicker execution times, and an overall leaner application.

#### Dead Code Elimination

Tree shaking is essentially a form of dead code elimination, which refers to the removal of parts of the codebase that are never executed or referenced during the application runtime. These could be functions, variables, or even entire modules that are imported but not used. Dead code elimination ensures that these unnecessary pieces of code do not make it to the final build.

#### Example

Consider this scenario: you import a UI library that offers 50 components, but you only use two of them in your project. Without tree shaking, all 50 components will be included in your final build, leading to a larger file size. With tree shaking, only the two components that are actually used will be included, and the remaining 48 will be eliminated, improving your application's performance.

#### Conclusion

Tree shaking is an essential optimization technique in modern JavaScript development. It ensures that your application contains only the necessary code, removing any unused or dead code that can bloat your final bundle. By minimizing the final output, tree shaking leads to better performance, faster loading times, and a more efficient codebase.
