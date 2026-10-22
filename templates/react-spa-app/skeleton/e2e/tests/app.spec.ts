import { expect, expectImagesLoaded, test } from '../fixtures'

// The name the app was scaffolded with; it is the page title and the heading.
const APP_NAME = ${{ values.name | dump }}

test.describe('home page', () => {
  test('loads with a 2xx and shows the app title and heading', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.ok(), `GET / returned ${response?.status()}`).toBe(true)

    await expect(page).toHaveTitle(APP_NAME)
    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What the platform gives you' })).toBeVisible()
    await expect(page.getByText('Delivery pipeline')).toBeVisible()
  })

  test('renders without page or console errors, and its images load', async ({ page, pageErrors }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await expectImagesLoaded(page)
    expect(pageErrors).toEqual([])
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

    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(html).toHaveClass(/\bdark\b/)
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()

    // The choice outlives a reload (index.html applies it before first paint).
    await page.reload()
    await expect(html).toHaveClass(/\bdark\b/)

    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(html).not.toHaveClass(/\bdark\b/)
  })
})

test.describe('unknown routes', () => {
  // The app is a single-page app served with push-state: any path the server
  // does not have a file for returns index.html, so deep links never 404.
  test('a deep link to an unknown path serves the app shell', async ({ page }) => {
    const response = await page.goto('/this/route/does/not/exist')
    expect(response?.ok(), `GET returned ${response?.status()}`).toBe(true)
    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible()
    await expectImagesLoaded(page)
  })
})
{%- if values.withLocalisation %}

// Localisation: the texts are fetched at runtime from /i18n/<language>.json
// (Tolgee, through this app's own server), with the copy built into the app as
// the fallback. See src/i18n.jsx.
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

  test('GET /i18n/en.json answers with the English texts', async ({ request }) => {
    const response = await request.get('/i18n/en.json')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/json')
    expect(await response.json()).toMatchObject({ 'features.heading': expect.any(String) })
  })

  test('the page shows the texts /i18n/en.json returns at runtime', async ({ page }) => {
    // Stand in for an edit made in Tolgee: the page must show it without a rebuild.
    await page.route('**/i18n/en.json', async (route) => {
      const response = await route.fetch()
      const texts = await response.json()
      await route.fulfill({ response, json: { ...texts, 'features.heading': 'Edited in Tolgee' } })
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Edited in Tolgee' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What the platform gives you' })).toHaveCount(0)
  })

  test('the language switcher changes the visible text and remembers the choice', async ({ page }) => {
    test.skip(!GERMAN, 'German is not one of this app\'s languages')
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'What the platform gives you' })).toBeVisible()

    await page.getByRole('combobox', { name: 'Language' }).selectOption('de')
    await expect(page.getByRole('heading', { name: 'Was die Plattform mitbringt' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    // A key German does not translate falls back to English, not to the key.
    await expect(page.getByText('app.description')).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Was die Plattform mitbringt' })).toBeVisible()

    await page.getByRole('combobox', { name: 'Sprache' }).selectOption('en')
    await expect(page.getByRole('heading', { name: 'What the platform gives you' })).toBeVisible()
  })

  test('still renders every text when /i18n fails, from the translations built into the app', async ({ page, pageErrors }) => {
    let failed = 0
    await page.route('**/i18n/*.json', (route) => {
      failed++
      return route.fulfill({ status: 500, body: 'Tolgee is down' })
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What the platform gives you' })).toBeVisible()
    await expect(page.getByText('Delivery pipeline')).toBeVisible()

    if (GERMAN) {
      await page.getByRole('combobox', { name: 'Language' }).selectOption('de')
      await expect(page.getByRole('heading', { name: 'Was die Plattform mitbringt' })).toBeVisible()
    }
    expect(failed, 'requests to /i18n that failed').toBeGreaterThan(0)
    dropFailedTranslationFetches(pageErrors)
  })
})

test.describe('localisation in a German browser', () => {
  test.use({ locale: 'de-DE' })

  test('starts in German', async ({ page }) => {
    test.skip(!GERMAN, 'German is not one of this app\'s languages')
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Was die Plattform mitbringt' })).toBeVisible()
  })
})
{%- endif %}
