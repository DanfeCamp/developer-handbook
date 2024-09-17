---
id: seo
title: Search Engine Optimization
---

# Search Engine Optimization

Next.js is an excellent choice for building SEO-friendly applications due to its server-side rendering (SSR) capabilities, which provide search engines with fully-rendered HTML content, and its built-in optimizations, such as automatic code splitting and prefetching, that contribute to better SEO performance.

Let's take a quick look at some key SEO principles. Meta tags, structured data markup, URL structure, and sitemaps are vital elements for search engine optimization.

### Metadata (Meta Tags and Title Optimization)

Next.js includes a Metadata API that allows you to define application metadata (such as meta and link tags within the HTML head element). This API ena	les the dynamic generation of meta tags and titles for each page, enhancing SEO and web shareability.

There are two ways you can add metadata to your application:

- **Config-based Metadata:** Export a static metadata object or a dynamic generateMetadata function in a `layout.js` or `page.js` file.
- **File-based Metadata:** Add static or dynamically generated special files to route segments.

With both these options, Next.js will automatically generate the relevant `<head>` elements for your pages. You can also create dynamic OG images using the ImageResponse constructor.

```tsx
// layout.tsx | page.tsx
import type { Metadata } from 'next'
 
export const metadata: Metadata = {
  title: '...',
  description: '...',
}
 
export default function Page() {}
```

### URL Structure and Canonical URLs

Next.js generates clean URLs by default based on the page structure. You can further optimize URLs by customizing them to include relevant keywords. Additionally, setting canonical URLs is essential to avoid duplicate content issues.

A canonical URL is the URL of the page that search engines think is most representative from a set of duplicate pages on your site. While you can directly specify canonical URLs to search engines, they may also autonomously group several URLs if they detect multiple paths leading to the same content. This can occur automatically if the search engine identifies the same content accessible through different URLs.

```html
<link rel="canonical" href="https://example.com/products/laptop" />
```

### Sitemap

sitemap.(xml|js|ts) is a special file that matches the [Sitemaps XML format](https://www.sitemaps.org/protocol.html) to help search engine crawlers index your site more efficiently. For smaller applications, you can create a sitemap.xml file and place it in the root of your app directory.

```ts
// app/sitemap.ts
import { MetadataRoute } from 'next'
 
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://acme.com',
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 1,
    },
    {
      url: 'https://acme.com/about',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: 'https://acme.com/blog',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.5,
    },
  ]
}
```


### Handling Pagination

Adding pagination enables users to navigate through multiple pages to view all invoices. Properly implementing pagination is crucial for SEO. Next.js supports pagination using the `next/link` component and the `rel="next/prev"` attribute.

### Responsive and Mobile-Friendly Design

Responsive design can result in improved visibility, higher click-through rates, and better SEO. A Responsive Design improves user experience, which in turn directly affects website ranks and overall SEO performance. Next.js, as a React framework, promotes building responsive layouts by utilizing CSS frameworks like Tailwind CSS or implementing responsive design principles with CSS media queries.

### Image Optimization

Images can greatly affect page load times, which in turn influences SEO. Next.js offers built-in image optimization features. By using Next.js’s `Image` component, you can automatically optimize images and take advantage of lazy loading, leading to faster rendering and enhanced performance. You can further optimize images by specifying attributes like alt text, dimensions, and file size.

```js
// app/page.js
import Image from 'next/image'
 
export default function Page() {
  return (
    <Image
      src="/profile.png"
      width={500}
      height={500}
      alt="Picture of the author"
    />
  )
}
```


### References

- https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
- https://dev.to/ikoichi/how-to-add-schemaorg-to-a-nextjs-13-website-1cm6
- https://dev.to/sh20raj/how-to-add-json-ld-structured-data-to-a-nextjs-website-58hh
- https://medium.com/@kishansheth21/optimizing-seo-in-next-js-advanced-techniques-for-better-search-engine-visibility-43ceaa1ea1d9