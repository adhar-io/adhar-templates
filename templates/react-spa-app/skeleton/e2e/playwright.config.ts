import { defineConfig, devices } from '@playwright/test'

// End-to-end tests. Two modes:
//   - E2E_BASE_URL unset (CI, and the local default): Playwright builds the app
//     and serves the PRODUCTION build with `vite preview` on a fixed port, then
//     tests that — the same dist/ the image ships.
//   - E2E_BASE_URL set: no server is started; the suite tests that URL, e.g. a
//     deployed environment (E2E_BASE_URL=https://shop.dev.example.com).
//
// Paths below are relative to this file, so results land in e2e/results/.
const PORT = 4173
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
        // Build, then serve dist/ exactly as built. vite preview falls back to
        // index.html for unknown paths, like nginx with push-state in the image.
        command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
        cwd: '..',
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        // A cold CI runner installs nothing here, but the production build is slow.
        timeout: 300_000,
      },
})
