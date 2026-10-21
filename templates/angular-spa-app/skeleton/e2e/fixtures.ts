import { expect, test as base, type Page } from '@playwright/test';

// Every test fails if the page throws or logs an error — a production build
// that "renders" while a component crashes in the console is not a passing app.
// (Angular reports bootstrap failures through console.error in src/main.ts.)
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
      });
      await use(errors);
      expect(errors, 'uncaught page errors or console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// Every <img> on the page has loaded. A wrong asset path does not always show up
// as a console error — a push-state server answers it with index.html — but the
// image is then left with no natural size.
export async function expectImagesLoaded(page: Page) {
  const images = page.locator('img');
  expect(await images.count(), 'images on the page').toBeGreaterThan(0);
  for (const image of await images.all()) {
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
        message: `image ${await image.getAttribute('src')} loaded`,
      })
      .toBe(true);
  }
}
