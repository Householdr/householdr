import { expect, expectAccessible, test } from './fixtures';

// The app runs and serves a page that meets the baseline, before there are pages of its own.

test('an unknown address shows the error page, in English and accessible', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle('Householdr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectAccessible(page);
});
