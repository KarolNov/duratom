import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // duratom is linked from the workspace; one copy of each keeps a single Yjs and React.
  resolve: { dedupe: ['yjs', 'jotai', 'react', 'react-dom'] },
})
