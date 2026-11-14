import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', 'core/index': 'src/core/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['yjs'],
})
