# End-to-end tests

Browser tests for the app, written with [Playwright](https://playwright.dev)
and run in Chromium. They check what a user sees: the page loads, shows the
app's title and heading, renders without page or console errors, its links and
theme toggle work, and unknown paths fall back to the app (push-state).

```
e2e/
├── playwright.config.ts   # one Chromium project, reporters, the web server
├── fixtures.ts            # fails any test that logs a console error or throws
└── tests/*.spec.ts        # the tests
```

## Run locally

```bash
npm install
npx playwright install chromium   # once per machine
npm run test:e2e
```

With no `E2E_BASE_URL`, Playwright runs `npm run build` and serves the
production build (`dist/`) with `vite preview` on http://127.0.0.1:4173, then
tests it. A server already listening on that port is reused when not in CI.

To test a running deployment instead, point the suite at it — no server is
started:

```bash
E2E_BASE_URL=https://<name>.dev.<platform domain> npm run test:e2e
```

Useful flags: `npx playwright test -c e2e/playwright.config.ts --ui` (watch
mode), `--headed`, `--debug`. Open the last HTML report with
`npx playwright show-report e2e/results/html`.

## In CI

CI runs the suite on every build in the
`mcr.microsoft.com/playwright:v1.64.1-noble` image, which ships the browsers.
Its version must match `@playwright/test` in `package.json` (pinned exactly at
`1.64.1`) — bump both together or the browsers will not be found.

```bash
npm install        # or `npm ci` once a package-lock.json is committed
CI=true npm run test:e2e
```

With `CI` set, `test.only` fails the run, a failed test is retried once (and
records a trace on that retry), and an existing server is never reused.

Results are written to `e2e/results/` (git-ignored):

| Path | What |
| --- | --- |
| `e2e/results/junit.xml` | JUnit report for the pipeline |
| `e2e/results/html/` | HTML report |
| `e2e/results/artifacts/` | screenshots of failures, traces of retries |
