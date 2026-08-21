import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'cloudflare/**/*.test.ts'],
    maxWorkers: 2,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
