import { defineConfig, devices } from '@playwright/test'

const PORT = 5199
// Set to test a deployed Worker instead, such as `https://duratom-example-sync.<you>.workers.dev`.
const deployed = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: 'e2e',
  // Each test opens its own room, so they can run at once against one server.
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: deployed ?? `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The app and the sync Worker, both from `vite dev`, unless testing a deployed Worker.
  webServer: deployed
    ? undefined
    : {
        command: `pnpm exec vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
      },
})
