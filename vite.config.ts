import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api/ai/': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        headers: { Origin: 'http://127.0.0.1:8787' },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'cloudflare/**/*.test.ts', 'local-codex/**/*.test.mjs'],
    maxWorkers: 2,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
