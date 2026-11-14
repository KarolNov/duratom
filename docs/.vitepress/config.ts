import { defineConfig } from 'vitepress'

const repo = 'https://github.com/KarolNov/duratom'

/**
 * The docs site: the README, the recipes and the API reference, built from the same Markdown that
 * ships in the repo and the package. Built with `pnpm site:build` into `docs/.vitepress/dist`.
 */
export default defineConfig({
  title: 'duratom',
  description:
    'Durable, live Jotai atoms over a Y.Doc: typed reads, validated writes, re-renders only on change.',
  // The Markdown lives at the repo root and in docs/, so the site reads from the root.
  srcDir: '..',
  srcExclude: [
    '**/node_modules/**',
    'dist/**',
    'examples/**',
    'skills/**',
    'src/**',
    'docs/snippets/**',
    'docs/tsdoc-examples/**',
  ],
  rewrites: {
    'README.md': 'index.md',
    'docs/api.md': 'api.md',
    'docs/recipes/:name.md': 'recipes/:name.md',
  },
  cleanUrls: true,
  lastUpdated: false,
  // Links to files that aren't pages (the example app, llms.txt) are rewritten below.
  ignoreDeadLinks: [/^\.\/examples\//, /^\.\/llms/, /^\.\/skills\//],
  markdown: {
    config(md) {
      // Repo-relative links to files that aren't pages point at GitHub instead.
      const toRepo = /^(?:\.\/)?(examples\/|skills\/)/
      const defaultRender =
        md.renderer.rules.link_open ??
        ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options))
      md.renderer.rules.link_open = (tokens, i, options, env, self) => {
        const href = tokens[i]!.attrGet('href')
        if (href && toRepo.test(href))
          tokens[i]!.attrSet('href', `${repo}/tree/main/${href.replace(/^\.\//, '')}`)
        else if (href && /^(?:\.\/)?llms(-full)?\.txt$/.test(href))
          tokens[i]!.attrSet('href', `/${href.replace(/^\.\//, '')}`)
        return defaultRender(tokens, i, options, env, self)
      }
    },
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/' },
      { text: 'API', link: '/api' },
      { text: 'llms.txt', link: '/llms.txt', target: '_self' },
    ],
    sidebar: [
      { text: 'Guide', items: [{ text: 'Introduction', link: '/' }] },
      {
        text: 'Recipes',
        items: [
          { text: 'Sync between devices', link: '/recipes/sync' },
          { text: 'Offline storage', link: '/recipes/offline' },
          { text: 'Repair a broken node', link: '/recipes/repair' },
        ],
      },
      { text: 'Reference', items: [{ text: 'API', link: '/api' }] },
    ],
    outline: [2, 3],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repo }],
  },
})
