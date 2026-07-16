import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'en-US',
  title: 'fast-json-rules-engine',
  description:
    'Compiled, synchronous, zero-dependency rules engine compatible with the json-rules-engine rule format — compile once, no Promise overhead per run.',
  base: '/fast-json-rules-engine/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://bobdu.github.io/fast-json-rules-engine/',
  },
  head: [
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/fast-json-rules-engine/logo.svg',
      },
    ],
    [
      'link',
      {
        rel: 'apple-touch-icon',
        href: '/fast-json-rules-engine/logo.png',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'fast-json-rules-engine' }],
    [
      'meta',
      {
        property: 'og:title',
        content: 'fast-json-rules-engine',
      },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'json-rules-engine rules, compiled for synchronous speed.',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content:
          'https://bobdu.github.io/fast-json-rules-engine/social-preview.png',
      },
    ],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    [
      'meta',
      {
        name: 'twitter:image',
        content:
          'https://bobdu.github.io/fast-json-rules-engine/social-preview.png',
      },
    ],
    // Google Search Console verification tag goes here once registered:
    // ['meta', { name: 'google-site-verification', content: '<token>' }],
  ],
  themeConfig: {
    logo: { src: '/logo.svg', alt: 'fast-json-rules-engine' },
    nav: [
      { text: 'Usage', link: '/USAGE' },
      { text: 'Migration', link: '/MIGRATING' },
      { text: 'Benchmarks', link: '/benchmarks' },
    ],
    sidebar: [
      {
        items: [
          { text: 'Usage guide', link: '/USAGE' },
          { text: 'Migrating from json-rules-engine', link: '/MIGRATING' },
          { text: 'Benchmarks', link: '/benchmarks' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/BobDu/fast-json-rules-engine' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/fast-json-rules-engine' },
    ],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/BobDu/fast-json-rules-engine/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message:
        'Released under the MIT License. An independent project, not affiliated with json-rules-engine.',
      copyright: 'Copyright © 2026 BobDu',
    },
    outline: 'deep',
  },
})
