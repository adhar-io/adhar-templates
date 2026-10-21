import { defineConfig, devices } from '@playwright/test'

// End-to-end tests. Two modes:
//   - E2E_BASE_URL unset (CI, and the local default): Playwright runs the
//     production build and starts the production server (`npm start`, i.e.
//     server.mjs — the same process the image runs) on a fixed port, then
//     tests that: SSR, hydration and the server routes together.
//   - E2E_BASE_URL set: no server is started; the suite tests that URL, e.g. a
//     deployed environment (E2E_BASE_URL=https://shop.dev.example.com).
//
// Paths below are relative to this file, so results land in e2e/results/.
const PORT = 3100
const externalBaseURL = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './tests',
  outputDir: './results/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: './results/junit.xml' }],
    ['html', { outputFolder: './results/html', open: 'never' }],
  ],
  use: {
    baseURL: externalBaseURL ?? `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalBaseURL
    ? undefined
    : {
        // A port of its own, so a running `npm run dev` (3000, a DEV server)
        // is never mistaken for the production build.
        command: 'npm run build && npm start',
        cwd: '..',
        env: { PORT: String(PORT) },
        // Ready when / answers — the Rollout's readiness path. Not /api/hello:
        // a broken API should fail its tests, not look like a startup timeout.
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        // The production build is slow on a cold CI runner.
        timeout: 300_000,
      },
})
