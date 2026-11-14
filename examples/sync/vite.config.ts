import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // `cloudflare()` runs worker/index.ts in workerd beside the app, so one `vite dev` serves both.
  plugins: [react(), cloudflare()],
  // duratom is linked from the workspace; one copy of each keeps a single Yjs and React.
  resolve: { dedupe: ['yjs', 'jotai', 'react', 'react-dom'] },
})
