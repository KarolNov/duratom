/**
 * Builds the docs site into docs/.vitepress/dist: the VitePress build, `llms.txt` and
 * `llms-full.txt` beside it, and a `_headers` file that lets browsers cache hashed assets for good.
 * Cloudflare Workers Builds runs this and deploys the result as Workers static assets
 * (site/wrangler.jsonc): main to duratom.karolnov.dev, other branches as preview versions.
 * `pnpm site:deploy` does the same by hand.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'docs/.vitepress/dist')

execFileSync('npx', ['vitepress', 'build', 'docs'], { cwd: root, stdio: 'inherit' })
for (const name of ['llms.txt', 'llms-full.txt']) copyFileSync(join(root, name), join(dist, name))
// Asset names carry a hash of their content, so a name never points at different bytes.
writeFileSync(
  join(dist, '_headers'),
  '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
)
