import { expect, expectImagesLoaded, test } from '../fixtures'

// The name the app was scaffolded with; it is the page title and the heading.
const APP_NAME = ${{ values.name | dump }}

test.describe('home page', () => {
  test('is server-rendered with a 2xx and shows the app title and heading', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.ok(), `GET / returned ${response?.status()}`).toBe(true)

    // The heading is in the HTML the server sent, not only after hydration.
    const html = await response!.text()
    expect(html).toMatch(new RegExp(`<h1[^>]*>(?:<[^>]+>)*${APP_NAME}<`))
    expect(html).toContain(`<title>${APP_NAME}</title>`)

    await expect(page).toHaveTitle(APP_NAME)
    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What the platform gives you' })).toBeVisible()
  })

  test('hydrates without page or console errors, and its images load', async ({ page, pageErrors }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // The status card is filled in by a client-side fetch, so once it reads
    // Healthy the app has hydrated — a hydration mismatch is a console error.
    await expect(page.getByText('Healthy')).toBeVisible()

    await expectImagesLoaded(page)
    expect(pageErrors).toEqual([])
  })
})

test.describe('server route', () => {
  test('GET /api/hello answers with the service status', async ({ request }) => {
    const response = await request.get('/api/hello')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/json')
    expect(await response.json()).toMatchObject({ service: APP_NAME, status: 'ok' })
  })

  test('the home page shows the live result of that route', async ({ page }) => {
    const hello = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/hello')
    await page.goto('/')
    expect((await hello).status()).toBe(200)

    await expect(page.getByText('Healthy')).toBeVisible()
    await expect(page.getByText(/GET \/api\/hello · \d+ ms/)).toBeVisible()
    await expect(page.getByText('unreachable')).toHaveCount(0)
  })
})

test.describe('in-page navigation and interaction', () => {
  test('"Get started" scrolls to the getting-started section', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Get started' }).click()

    await expect(page).toHaveURL(/#get-started$/)
    await expect(page.locator('#get-started')).toBeInViewport()
    await expect(page.getByRole('heading', { level: 2, name: 'Get started' })).toBeVisible()
  })

  test('the theme toggle switches dark mode and remembers the choice', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    const html = page.locator('html')
    await expect(html).not.toHaveClass(/\bdark\b/)
    // The button only works once React has hydrated.
    await expect(page.getByText('Healthy')).toBeVisible()

    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(html).toHaveClass(/\bdark\b/)
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()

    // The choice outlives a reload (the root route applies it before first paint).
    await page.reload()
    await expect(html).toHaveClass(/\bdark\b/)

    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(html).not.toHaveClass(/\bdark\b/)
  })
})

test.describe('unknown routes', () => {
  test('answer 404 with the not-found page, which links back home client-side', async ({ page, pageErrors }) => {
    const response = await page.goto('/this/route/does/not/exist')
    expect(response?.status()).toBe(404)
    await expect(page).toHaveTitle(APP_NAME)
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()

    // Chrome logs the 404 status of the document itself as a console error.
    // That is the response this test asked for, so exactly that one entry is
    // accepted here; any other error, before or after, still fails the test.
    await expect.poll(() => pageErrors.length).toBeGreaterThan(0)
    expect(pageErrors).toHaveLength(1)
    expect(pageErrors[0]).toMatch(/^console\.error: Failed to load resource: .*status of 404\b/)
    pageErrors.length = 0

    // Client-side navigation: the router swaps the page without a document
    // load, so a value set on window survives the click.
    await page.evaluate(() => ((window as unknown as { __e2eMarker: boolean }).__e2eMarker = true))
    await page.getByRole('link', { name: 'Back to the home page' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __e2eMarker?: boolean }).__e2eMarker)).toBe(true)

    // And back again through history.
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  })
})
{%- if values.withLocalisation %}

// Localisation: the server renders each page in the visitor's language with
// texts from Tolgee (or the built-in files), and the browser loads another
// language from /i18n/<language>.json when the visitor switches. See
// src/localisation.tsx; src/server/i18n.test.ts covers Tolgee itself.
const LANGUAGES = ${{ values.languages | dump }}.split(',').map((tag) => tag.trim())
// The switching tests use the German example translation (src/i18n/de.json).
const GERMAN = LANGUAGES.includes('de')

test.describe('localisation', () => {
  // Chrome logs a failed fetch as a console error. A test that makes /i18n fail
  // on purpose accepts exactly those entries; any other error still fails it.
  function dropFailedTranslationFetches(pageErrors: string[]) {
    const rest = pageErrors.filter((error) => !/Failed to load resource: .*status of 500\b/.test(error))
    pageErrors.length = 0
    pageErrors.push(...rest)
  }

  test('GET /i18n/<language>.json answers with that language, and 404 for one the app does not have', async ({ request }) => {
    const response = await request.get('/i18n/en.json')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/json')
    expect(await response.json()).toMatchObject({ 'features.heading': expect.any(String) })

    expect((await request.get('/i18n/xx.json')).status()).toBe(404)
    expect((await request.get('/i18n/not-a-language.json')).status()).toBe(404)
  })

  test('the server renders the texts /i18n serves, so the first paint is translated', async ({ page, request }) => {
    const texts = await (await request.get('/i18n/en.json')).json()
    const response = await page.goto('/')
    const html = await response!.text()
    expect(html).toContain('<html lang="en"')
    expect(html).toContain(texts['features.heading'])
    await expect(page.getByRole('heading', { name: texts['features.heading'] })).toBeVisible()
  })

  test('the language switcher changes the visible text, and the server renders the choice next time', async ({ page }) => {
    test.skip(!GERMAN, 'German is not one of this app\'s languages')
    await page.goto('/')
    // The switcher works once React has hydrated.
    await expect(page.getByText('Healthy')).toBeVisible()

    await page.getByRole('combobox', { name: 'Language' }).selectOption('de')
    await expect(page.getByRole('heading', { name: 'Was die Plattform mitbringt' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    // A key German does not translate falls back to English, not to the key.
    await expect(page.getByText('app.description')).toHaveCount(0)

    const response = await page.reload()
    expect(await response!.text()).toContain('Was die Plattform mitbringt')
    await expect(page.getByText('Gesund')).toBeVisible()

    await page.getByRole('combobox', { name: 'Sprache' }).selectOption('en')
    await expect(page.getByRole('heading', { name: 'What the platform gives you' })).toBeVisible()
  })

  test('switching language shows the texts /i18n returns at runtime', async ({ page }) => {
    test.skip(!GERMAN, 'German is not one of this app\'s languages')
    // Stand in for an edit made in Tolgee: the page must show it without a rebuild.
    await page.route('**/i18n/de.json', async (route) => {
      const response = await route.fetch()
      const texts = await response.json()
      await route.fulfill({ response, json: { ...texts, 'features.heading': 'In Tolgee bearbeitet' } })
    })
    await page.goto('/')
    await expect(page.getByText('Healthy')).toBeVisible()
    await page.getByRole('combobox', { name: 'Language' }).selectOption('de')
    await expect(page.getByRole('heading', { name: 'In Tolgee bearbeitet' })).toBeVisible()
  })

  test('still shows every text when /i18n fails, from the translations built into the app', async ({ page, pageErrors }) => {
    test.skip(!GERMAN, 'German is not one of this app\'s languages')
    let failed = 0
    await page.route('**/i18n/*.json', (route) => {
      failed++
      return route.fulfill({ status: 500, body: 'Tolgee is down' })
    })
    await page.goto('/')
    await expect(page.getByText('Healthy')).toBeVisible()
    await page.getByRole('combobox', { name: 'Language' }).selectOption('de')
    await expect(page.getByRole('heading', { name: 'Was die Plattform mitbringt' })).toBeVisible()
    await expect(page.getByText('Gesund')).toBeVisible()
    expect(failed, 'requests to /i18n that failed').toBeGreaterThan(0)
    dropFailedTranslationFetches(pageErrors)
  })
})

test.describe('localisation in a German browser', () => {
  test.use({ locale: 'de-DE' })

  test('is server-rendered in German', async ({ page }) => {
    test.skip(!GERMAN, 'German is not one of this app\'s languages')
    const response = await page.goto('/')
    const html = await response!.text()
    expect(html).toContain('<html lang="de"')
    expect(html).toContain('Was die Plattform mitbringt')
    await expect(page.getByText('Gesund')).toBeVisible()
  })
})
{%- endif %}
