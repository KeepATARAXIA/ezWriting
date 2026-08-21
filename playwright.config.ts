import { defineConfig, devices } from '@playwright/test'

const ci = Boolean(process.env.CI)
const baseURL = 'http://127.0.0.1:4174'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? 'github' : 'list',
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    headless: ci,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        channel: ci ? undefined : 'chrome',
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4174',
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
