import { pseudoLocale, pseudoText } from '../pseudo-locale';
import { expect, expectAccessible, test } from './fixtures';

// One smoke test in the pseudo-locale (ADR-0016 §5): text from the catalogue comes out accented,
// longer and in brackets, so anything that skipped the catalogue stands out.

test('the pseudo-locale shows the catalogue’s text, accessibly', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'PARAGLIDE_LOCALE', value: pseudoLocale, url: baseURL }]);
  await page.goto('/no-such-page');
  await expect(page.locator('html')).toHaveAttribute('lang', pseudoLocale);
  await expect(page).toHaveTitle(pseudoText('Householdr'));
  await expectAccessible(page);
});
