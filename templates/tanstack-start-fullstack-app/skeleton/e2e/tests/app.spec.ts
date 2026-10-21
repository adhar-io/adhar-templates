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
