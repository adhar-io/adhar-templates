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
