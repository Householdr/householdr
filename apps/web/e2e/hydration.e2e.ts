import { expect, forceFlags, test } from './fixtures';

// A page a test opens runs its scripts before the test acts on it (TEST-7). A test that selected a
// field's text while Svelte was still taking over the page lost the selection, and typed after
// the text instead of over it: a task renamed "Hoover" was saved as "VacuumHoover".

test('a page a test opens runs its scripts before the test goes on', async ({
  page,
  context,
  baseURL,
}) => {
  await forceFlags(context, baseURL, { 'sign-in': true });
  // As on a slow phone: the app's scripts arrive well after the page.
  await page.route(/\/_app\/immutable\/entry\/start\./, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto('/sign-in');
  // Read once, without waiting for it.
  expect(await page.locator(':root').getAttribute('data-hydrated')).toBe('');
});
