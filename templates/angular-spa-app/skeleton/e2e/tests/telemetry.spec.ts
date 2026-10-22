import { gunzipSync } from 'node:zlib'
import type { Page, Request } from '@playwright/test'
import { expect, test } from '../fixtures'

// Browser telemetry (src/app/telemetry.ts), switched on at runtime by
// /runtime-config.json. Here that file and every collector are stand-ins served
// by Playwright, so nothing leaves the machine: the tests prove what the page
// sends when configured and that it sends nothing, and logs no error, when not.
const APP_NAME = ${{ values.name | dump }}
const FARO_URL = 'https://faro.platform.example.test/collect'

type Sent = { faro: unknown[]; posthog: Record<string, any>[]; ingestPaths: string[]; other: Request[] }

async function stubCollectors(page: Page, runtimeConfig: unknown): Promise<Sent> {
  const sent: Sent = { faro: [], posthog: [], ingestPaths: [], other: [] }
  await page.route('**/runtime-config.json', (route) => route.fulfill({ json: runtimeConfig, headers: { 'cache-control': 'no-store' } }))
  await page.route(FARO_URL, (route) => {
    sent.faro.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: {}, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.route('**/ingest/**', (route) => {
    const url = new URL(route.request().url())
    sent.ingestPaths.push(url.pathname)
    if (/\/(flags|decide)\/?$/.test(url.pathname)) {
      return route.fulfill({ json: { featureFlags: {}, featureFlagPayloads: {}, errorsWhileComputingFlags: false } })
    }
    if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'application/javascript', body: '' })
    if (/\/(e|batch|capture)\/?$|\/i\/v0\/e\/?$/.test(url.pathname)) sent.posthog.push(...decodeEvents(route.request()))
    return route.fulfill({ json: { status: 1 } })
  })
  return sent
}

// posthog-js sends JSON, gzip-compressed JSON or base64 form data.
function decodeEvents(request: Request): Record<string, any>[] {
  const body = request.postDataBuffer()
  if (!body) return []
  let text: string
  if (body[0] === 0x1f && body[1] === 0x8b) text = gunzipSync(body).toString('utf8')
  else {
    text = body.toString('utf8')
    if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString('utf8')
  }
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : parsed.batch ?? [parsed]
}

test.describe('telemetry: not configured', () => {
  test('sends nothing and logs no error when /runtime-config.json turns nothing on', async ({ page, baseURL }) => {
    const external: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== new URL(baseURL!).origin || url.pathname.startsWith('/ingest')) external.push(request.url())
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(external.filter((u) => !u.startsWith('data:'))).toEqual([])
  })

  // What a server without the file answers: the push-state fallback, index.html.
  test('a /runtime-config.json that is not JSON is ignored', async ({ page }) => {
    await page.route('**/runtime-config.json', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>app shell</p>' }))
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('telemetry: Faro real-user monitoring', () => {
  test('reports page loads with the app name, version and environment', async ({ page }) => {
    const sent = await stubCollectors(page, { environment: 'dev', faro: { url: FARO_URL }, posthog: null })
    await page.goto('/')
    await expect.poll(() => sent.faro.length, { message: 'a payload reached the Faro receiver' }).toBeGreaterThan(0)
    const meta = (sent.faro[0] as any).meta
    expect(meta.app).toMatchObject({ name: APP_NAME, environment: 'dev' })
    expect(meta.app.version).toMatch(/^\d+\.\d+\.\d+/)
    await expect
      .poll(() => sent.faro.flatMap((p: any) => p.events ?? []).map((e: any) => e.name))
      .toContain('faro.performance.navigation')
  })

  test('propagates traceparent to its own origin and this environment\'s services only', async ({ page }) => {
    await stubCollectors(page, { environment: 'dev', faro: { url: FARO_URL } })
    const headers: Record<string, string | undefined> = {}
    for (const url of ['/api/ping', 'https://orders.dev.platform.example.test/api', 'https://idp.example.org/token']) {
      await page.route(url.startsWith('/') ? `**${url}` : url, (route) => {
        headers[url] = route.request().headers().traceparent
        return route.fulfill({ json: {}, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      })
    }
    await page.goto('/')
    // Faro loads after the page; fetches made before it is ready are not traced.
    await expect.poll(() => page.evaluate(() => Boolean((window as any).faro?.api))).toBe(true)
    await page.evaluate(async () => {
      for (const url of ['/api/ping', 'https://orders.dev.platform.example.test/api', 'https://idp.example.org/token']) await fetch(url)
    })
    expect(headers['/api/ping']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    expect(headers['https://orders.dev.platform.example.test/api']).toMatch(/^00-/)
    expect(headers['https://idp.example.org/token']).toBeUndefined()
  })
})
{%- if values.withAnalytics %}

test.describe('telemetry: PostHog product analytics', () => {
  const config = { environment: 'test', faro: { url: '' }, posthog: { key: 'phc_e2e', apiHost: '/ingest', uiHost: '' } }

  // posthog-js drops every event from a browser that looks automated (a
  // HeadlessChrome user agent or brand, navigator.webdriver), which is what a
  // test browser is. Look like a person's Chrome so the page behaves as it does
  // for real visitors.
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined })
    })
  })

  test('captures a page view through /ingest with the app, version and environment', async ({ page }) => {
    const sent = await stubCollectors(page, config)
    await page.goto('/')
    await expect
      .poll(() => sent.posthog.map((e) => e.event), { message: 'events sent to /ingest' })
      .toContain('$pageview')
    const pageview = sent.posthog.find((e) => e.event === '$pageview')!
    expect(pageview.properties).toMatchObject({ app: APP_NAME, environment: 'test', token: 'phc_e2e' })
    expect(pageview.properties.app_version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('counts a client-side route change as a page view', async ({ page }) => {
    const sent = await stubCollectors(page, config)
    await page.goto('/')
    await expect.poll(() => sent.posthog.filter((e) => e.event === '$pageview').length).toBe(1)
    await page.evaluate(() => history.pushState({}, '', '/somewhere-else'))
    await expect
      .poll(() => sent.posthog.filter((e) => e.event === '$pageview').map((e) => new URL(e.properties.$current_url).pathname))
      .toContain('/somewhere-else')
  })

  test('records no session replay unless the environment turns it on', async ({ page }) => {
    const sent = await stubCollectors(page, config)
    await page.goto('/')
    await expect.poll(() => sent.posthog.length).toBeGreaterThan(0)
    await page.waitForTimeout(1000)
    expect(sent.ingestPaths.filter((p) => /recorder/.test(p))).toEqual([])
    expect(sent.posthog.filter((e) => e.event === '$snapshot')).toEqual([])
  })

  for (const [why, init] of [
    ['the visitor opted out', () => localStorage.setItem('analytics-opt-out', '1')],
    ['Do Not Track is on', () => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' })],
  ] as const) {
    test(`sends nothing to /ingest when ${why}`, async ({ page }) => {
      await page.addInitScript(init)
      const sent = await stubCollectors(page, config)
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.waitForTimeout(1500)
      expect(sent.ingestPaths).toEqual([])
    })
  }

  test('window.adharAnalytics.optOut() stops capturing', async ({ page }) => {
    const sent = await stubCollectors(page, config)
    await page.goto('/')
    await expect.poll(() => sent.posthog.length).toBeGreaterThan(0)
    await page.evaluate(() => (window as any).adharAnalytics.optOut())
    const before = sent.posthog.length
    await page.evaluate(() => history.pushState({}, '', '/after-opt-out'))
    await page.waitForTimeout(1500)
    expect(sent.posthog.slice(before).map((e) => e.event)).not.toContain('$pageview')
  })
})
{%- endif %}
