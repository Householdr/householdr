import { account } from './account';
import { expect, expectAccessible, forceFlags, test } from './fixtures';

// Signing in with a password (ADR-0010 §2), while its release flag is off by default (CODE-20).

test('the sign-in page isn’t there while its flag is off', async ({ page }) => {
  const response = await page.goto('/sign-in');
  expect(response?.status()).toBe(404);
});

/** An address without an account, of this test's own, so failures elsewhere don't count. */
const unknownAddress = () => `nobody-${test.info().testId}@example.org`;

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });
    test.beforeEach(async ({ context, baseURL }) => {
      await forceFlags(context, baseURL, { 'sign-in': true });
    });

    test('signs in, with a password manager’s help', async ({ page, context }) => {
      await page.goto('/sign-in');
      await expect(page).toHaveTitle('Sign in to Householdr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to Householdr');
      // What password managers fill in (UI-14).
      await expect(page.getByLabel('E-mail address')).toHaveAttribute('autocomplete', 'username');
      await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
      if (javaScriptEnabled) await expectAccessible(page);
      await page.getByLabel('E-mail address').fill(account.email);
      await page.getByLabel('Password').fill(account.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL('/');
      const session = (await context.cookies()).find(
        (cookie) => cookie.name === '__Host-householdr.session_token',
      );
      expect(session).toMatchObject({ path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
    });

    test('says the e-mail address or password is incorrect, and keeps the address', async ({
      page,
    }) => {
      const email = unknownAddress();
      await page.goto('/sign-in');
      await page.getByLabel('E-mail address').fill(email);
      await page.getByLabel('Password').fill('not the password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      const summary = page.getByRole('region', { name: 'Signing in didn’t work' });
      await expect(summary).toHaveText(/The e-mail address or the password is incorrect\./);
      await expect(summary).toBeFocused();
      await expect(page.getByLabel('E-mail address')).toHaveValue(email);
      if (javaScriptEnabled) await expectAccessible(page, 'signing in failed');
    });
  });
}
