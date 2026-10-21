# End-to-end tests

Browser tests for the app, written with [Playwright](https://playwright.dev)
and run in Chromium. They check what a user sees: the page is server-rendered
with the app's title and heading, hydrates without page or console errors (a
hydration mismatch fails), `/api/hello` answers and the page shows its result,
the links and theme toggle work, and an unknown path answers 404 with the
not-found page, whose link navigates home client-side.

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

With no `E2E_BASE_URL`, Playwright runs `npm run build` and starts the
production server (`npm start`, i.e. `server.mjs` — what the image runs) with
`PORT=3100`, on http://127.0.0.1:3100, then tests it. A server already
listening on that port is reused when not in CI; `npm run dev` (3000) is a
development server and is deliberately not used.

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
