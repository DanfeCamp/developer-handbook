# Developer Handbook

Welcome to the Developer Handbook! This guide is designed to equip you with the knowledge, processes, and best practices needed to excel in web development.

### 🎯 Purpose and Scope

This handbook is a comprehensive resource for web developers. It covers a range of topics, from essential tools and workflows to best practices and optimization techniques.

### 🔎 What You'll Find Here

1. **Overview:** Get familiar with key tools, development environments, and version control workflows.
2. **Tools, Coding Standards, and Best Practices:** Learn about coding standards, accessibility guidelines, and performance optimization for popular technologies like WordPress and modern web frameworks.
3. **Starting Projects:** Understand how to manage your initial projects, collaborate effectively with others, and navigate development and deployment processes.
4. **Training and Career Growth:** Explore training resources, learning opportunities, and strategies for career advancement in web development.
5. **Roles and Responsibilities:** Gain insight into different roles within web development teams and their contributions.
6. **Additional Resources:** Find information on common engineering solutions, community meetups, and how to make the most of your development journey.

## 🤝🏻 How to Contribute

We encourage you to help improve this handbook. For detailed guidelines on contributing, please check the [WORKFLOW](https://github.com/DanfeCamp/developer-handbook/blob/main/WORKFLOW.md) file.

### 🧩 Branch Creation and Usage

To maintain a clean and organized Git history, we follow a specific branching strategy:

- **Main Branch:** The `main` branch contains the latest stable version of the handbook.
- **Feature Branches:** Use a separate branch for each set of related changes (e.g., `feature/update-coding-standards`).
- **Commits:** Make frequent, small commits with descriptive messages.
- **Pull Requests:** Open a pull request when your changes are ready, assign reviewers, and incorporate feedback.
- **Merging:** Merge your PR into `main` after it has been reviewed and approved.

### Setup Local Development

To contribute to the handbook locally, follow these steps:

#### Prerequisites

- Node.js (20 or higher; 22 LTS recommended)
- npm (10 or higher)

#### Steps

##### 1. Clone the Repository:

```Bash
git clone https://github.com/DanfeCamp/developer-handbook.git
```

##### 2. Install Dependencies:

```Bash
cd developer-handbook
npm install
```

##### 3. Start the Development Server:

```Bash
npm start
```

This will start a local development server, and you should be able to view the handbook in your browser at [http://localhost:3000/](http://localhost:3000/).

#### Making Changes

Edit the Markdown files in the `developer-handbook` directory to make your
changes. The development server will automatically reload, and you'll see your
changes reflected in the browser.

Content is organised into two sections:

- `developer-handbook/course/` — guided, ordered lessons.
- `developer-handbook/knowledge-base/` — reference material for quick lookups.

Sidebar labels and ordering are controlled by the `_category_.json` file in each
directory, so navigation stays next to the content it describes.

#### Available Scripts

| Script              | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `npm start`         | Start the local development server.              |
| `npm run build`     | Build the production site into `build/`.         |
| `npm run serve`     | Serve a production build locally.                |
| `npm run typecheck` | Type-check the project with TypeScript.          |
| `npm run lint`      | Lint with ESLint (`lint:fix` to autofix).        |
| `npm run format`    | Format with Prettier (`format:check` to verify). |
| `npm run validate`  | Run typecheck, lint, format check and build.     |

Run `npm run validate` before opening a pull request — CI runs the same checks.

## 📐 Let's Build Together!

This handbook is a living document, evolving to reflect the latest developments in web technology and best practices. Your contributions are vital in making it a valuable resource for the web development community. Let’s work together to create a handbook that supports developers everywhere!

