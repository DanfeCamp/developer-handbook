import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const GITHUB_REPO = 'https://github.com/DanfeCamp/developer-handbook';

const config: Config = {
  title: 'Developer Handbook',
  tagline:
    'A practical, self-contained reference for modern software development',
  favicon: 'img/favicon.svg',

  // Set the production url of your site here
  url: 'https://learn.danfecamp.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  baseUrl: '/',

  // GitHub pages deployment config.
  organizationName: 'DanfeCamp',
  projectName: 'developer-handbook',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onDuplicateRoutes: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang.
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
      onBrokenMarkdownImages: 'throw',
    },
  },

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        // These two must mirror the docs plugin's `path` and `routeBasePath`
        // below, otherwise the indexer looks in the wrong place and silently
        // produces an incomplete index.
        docsDir: 'developer-handbook',
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        searchBarShortcut: true,
        searchBarShortcutHint: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'developer-handbook',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: ({docPath}) =>
            `${GITHUB_REPO}/edit/main/developer-handbook/${docPath}`,
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
          breadcrumbs: true,
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo.svg',
    metadata: [
      {
        name: 'keywords',
        content:
          'developer handbook, web development, react, next.js, git, npm, docker, best practices',
      },
    ],
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    colorMode: {
      respectPrefersColorScheme: true,
      disableSwitch: false,
    },
    navbar: {
      hideOnScroll: true,
      title: 'Developer Handbook',
      logo: {
        alt: 'Developer Handbook',
        // The mark is a self-contained filled badge, so it reads on both light
        // and dark backgrounds; no `srcDark` variant is needed.
        src: 'img/logo.svg',
        href: '/',
        target: '_self',
      },
      items: [
        {
          href: GITHUB_REPO,
          position: 'right',
          // Rendered as an icon via CSS; `aria-label` supplies the accessible
          // name that the missing text label would otherwise have provided.
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Learn',
          items: [
            {label: 'Introduction', to: '/'},
            {label: 'Course', to: '/course'},
            {label: 'Knowledge Base', to: '/knowledge-base'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: GITHUB_REPO},
            {
              label: 'Code of Conduct',
              href: `${GITHUB_REPO}/blob/main/CODE_OF_CONDUCT.md`,
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Contributing Workflow',
              href: `${GITHUB_REPO}/blob/main/WORKFLOW.md`,
            },
            {label: 'License', href: `${GITHUB_REPO}/blob/main/LICENSE`},
          ],
        },
      ],
      copyright:
        'Made with ❤️ by <a href="https://danfecamp.com/" target="_blank" rel="noopener noreferrer">DanfeCamp</a>',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: [
        'bash',
        'diff',
        'docker',
        'git',
        'ini',
        'json',
        'markdown',
        'nginx',
        'php',
        'python',
        'sql',
        'toml',
        'yaml',
      ],
    },
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
