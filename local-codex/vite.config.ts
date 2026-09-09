import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'node24', outDir: 'local-codex/dist',
    lib: { entry: 'local-codex/main.mjs', formats: ['es'], fileName: () => 'bridge.mjs' },
    rolldownOptions: { external: [/^node:/] },
  },
})
