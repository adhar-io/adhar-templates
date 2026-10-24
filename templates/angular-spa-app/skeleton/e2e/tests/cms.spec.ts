{% if values.withCms -%}
import type { Page, Request, Route } from '@playwright/test';
import { expect, test } from '../fixtures';

// The home page's CMS section (src/app/cms.ts). /cms/ is stubbed here, so these
// tests prove what the page asks Strapi for and how it shows every answer —
// entries, none, not connected, failing — without a Strapi. That nginx turns
// /cms/ into Strapi's /api/ with the token is e2e/nginx/test.sh's job.
const APP_NAME = ${{ values.name | dump }};
const COLLECTION = ${{ values.cmsCollection | dump }};

const IMAGE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#888"/></svg>';

/** Answers /cms/ (and Strapi's media under /uploads/); returns the URLs the page asked for. */
async function stubCms(page: Page, answer: (request: Request) => Parameters<Route['fulfill']>[0]) {
  const requests: URL[] = [];
  await page.route('**/cms/**', (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill(answer(route.request()));
  });
  await page.route('**/uploads/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: IMAGE }));
  return requests;
}

const section = (page: Page) => page.getByRole('region', { name: 'From the CMS' });

test('lists the latest published entries, newest first, with their images', async ({ page }) => {
  const requests = await stubCms(page, () => ({
    json: {
      data: [
        { id: 1, documentId: 'a1', title: 'Spring launch', description: 'What is new this season.', publishedAt: '2026-10-01T09:00:00.000Z', cover: { url: '/uploads/spring_3f2a.svg' } },
        { id: 2, documentId: 'b2', name: 'Opening hours', publishedAt: '2026-09-12T09:00:00.000Z' },
      ],
      meta: { pagination: { page: 1, pageSize: 6, pageCount: 1, total: 2 } },
    },
    headers: { 'x-cms': 'strapi' },
  }));
  await page.goto('/');

  await expect(section(page).getByRole('heading', { level: 3, name: 'Spring launch' })).toBeVisible();
  await expect(section(page).getByText('What is new this season.')).toBeVisible();
  await expect(section(page).getByRole('heading', { level: 3, name: 'Opening hours' })).toBeVisible();
  await expect(section(page).locator('time[datetime="2026-10-01T09:00:00.000Z"]')).toBeVisible();
  const cover = section(page).locator('img[src="/uploads/spring_3f2a.svg"]');
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  const query = requests[0];
  expect(query.pathname).toBe(`/cms/${COLLECTION}`);
  expect(query.searchParams.get('pagination[pageSize]')).toBe('6');
  expect(query.searchParams.get('sort[0]')).toBe('publishedAt:desc');
  expect(query.searchParams.get('locale')).toBe('en');
});

test('says how to publish the first entry when there is none', async ({ page }) => {
  await stubCms(page, () => ({ json: { data: [], meta: { pagination: { total: 0 } } }, headers: { 'x-cms': 'strapi' } }));
  await page.goto('/');
  await expect(section(page).getByRole('status')).toContainText(`Publish the first entry of ${COLLECTION} in Strapi`);
});

test('names the Secret to create when this environment has no Strapi token', async ({ page }) => {
  await stubCms(page, () => ({ json: { data: null, meta: { cms: 'off' } }, headers: { 'x-cms': 'off' } }));
  await page.goto('/');
  await expect(section(page).getByRole('status')).toContainText(`${APP_NAME}-strapi`);
});

test('a failing Strapi costs the section, never the page', async ({ page, pageErrors }) => {
  await stubCms(page, () => ({ status: 502, body: 'Bad Gateway' }));
  await page.goto('/');
  await expect(section(page).getByRole('status')).toContainText('could not be loaded');
  await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible();
  // The browser logs the failed request itself; that one error is expected.
  expect(pageErrors.every((error) => /502|Bad Gateway/.test(error))).toBe(true);
  pageErrors.splice(0);
});
{%- if values.withLocalisation %}

test('asks for the entries in the language the user switches to', async ({ page }) => {
  const requests = await stubCms(page, () => ({ json: { data: [], meta: {} }, headers: { 'x-cms': 'strapi' } }));
  await page.goto('/');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await expect.poll(() => requests.at(-1)?.searchParams.get('locale')).toBe('de');
});
{%- endif %}
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false), so
// there is nothing to test here.
export {};
{%- endif %}
