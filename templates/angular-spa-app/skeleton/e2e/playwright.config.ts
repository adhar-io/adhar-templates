import { defineConfig, devices } from '@playwright/test';

// End-to-end tests. Two modes:
//   - E2E_BASE_URL unset (CI, and the local default): Playwright runs the
//     production `ng build` and serves its output with e2e/serve.mjs on a fixed
//     port, then tests that — the same files the image ships.
//   - E2E_BASE_URL set: no server is started; the suite tests that URL, e.g. a
//     deployed environment (E2E_BASE_URL=https://shop.dev.example.com).
//
// Paths below are relative to this file, so results land in e2e/results/.
const PORT = 4300;
const externalBaseURL = process.env.E2E_BASE_URL;

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
        // A port of its own, so a running `ng serve` (4200, a DEV build) is
        // never mistaken for the production build.
        command: 'npm run build && node e2e/serve.mjs',
        cwd: '..',
        env: { PORT: String(PORT) },
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        // The production build is slow on a cold CI runner.
        timeout: 300_000,
      },
});
