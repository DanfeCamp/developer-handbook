---
id: folder-structure
title: Folder Structure
---

# Folder Structure

The presented approach is not the only or mandatory method for setting up a folder structure. While it has proven effective in many projects, it's important to recognize that folder organization is flexible and should be tailored to specific project requirements.

```
your-amazing-app
├── __tests__
│   ├── ComponentA.test.js
│   └── ComponentB.test.js
├── actions
│   ├── auth.ts
│   ├── order.ts
│   ├── search.ts
├── app
│   ├── api
│   │   └── apiroute
│   │       └── route.ts
│   ├── blog
│   │   ├── [dynamicroute]
│   │   ├── loading.tsx
│   │   └── page.tsx
│   ├── layout.tsx
│   ├── not-found.tsx
│   ├── page.tsx
│   └── someroute
│       └── page.tsx
├── components
│   ├── Buttons
│   │   ├── PrimaryButton
│   │   │   └── index.tsx
│   │   └── SecondaryButton
│   │       └── index.tsx
│   ├── ComponentA
│   │   └── index.tsx
│   └── ComponentB
├── containers
│   ├── blog-page
│   │   └── index.tsx
│   └── home-page
│       ├── hero-section
│       │   └── index.tsx
│       └── info-section
│           └── index.tsx
├── hooks
│   └── useSomeHooks.tsx
├── public
│   ├── favicon.ico
│   ├── fonts
│   │   └── someFont.ttf
│   ├── images
│   │   └── someImage.webp
│   └── robots.txt
├── styles
│   └── global.css
├── types
│   ├── Blog.ts
│   ├── Product.ts
│   └── User.ts
└── utils
    └── someUtilityFunction.ts
```

### References

- https://medium.com/@mertenercan/nextjs-13-folder-structure-c3453d780366
