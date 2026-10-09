import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { forgetMail, mailTo, resetLink } from './mail';

// Choosing a new password through an e-mailed link (ADR-0010 §8), while its release flag is off by
// default (CODE-20).

test('the reset pages aren’t there while their flag is off', async ({ page, context, baseURL }) => {
  await forceFlags(context, baseURL, { 'sign-in': true });
  for (const path of ['/forgot-password', '/reset-password', '/reset-password/a-token']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
  await page.goto('/sign-in');
  await expect(page.getByRole('link', { name: 'Forgot your password?' })).toHaveCount(0);
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });
    test.beforeEach(async ({ context, baseURL }) => {
      await forceFlags(context, baseURL, { 'sign-in': true, 'password-reset': true });
    });

    test('sends a link that sets a new password once', async ({ page, account }) => {
      await forgetMail(account.email);
      await page.goto('/sign-in');
      await page.getByRole('link', { name: 'Forgot your password?' }).click();
      await expect(page).toHaveURL('/forgot-password');
      await expect(page).toHaveTitle('Forgot your password? · Householdr');
      if (javaScriptEnabled) await expectAccessible(page);
      await page.getByLabel('E-mail address').fill(account.email);
      await page.getByRole('button', { name: 'Send the link' }).click();
      await expect(page.getByRole('status')).toHaveText(
        `If ${account.email} has an account, we’ve sent it a link to choose a new password. The link works once, within 30 minutes.`,
      );
      if (javaScriptEnabled) await expectAccessible(page, 'link sent');

      // The token leaves the address bar at once, and no page it leads to sends a referrer to
      // another site (ADR-0017 §4, clarification).
      const link = await resetLink(account.email);
      const response = await page.goto(link);
      await expect(page).toHaveURL('/reset-password');
      expect(response?.headers()['referrer-policy']).toBe('same-origin');
      await expect(page).toHaveTitle('Choose a new password · Householdr');
      const field = page.getByLabel('New password');
      // What password managers fill in (UI-14).
      await expect(field).toHaveAttribute('autocomplete', 'new-password');
      await expect(field).toHaveAccessibleDescription(
        'At least 12 characters, and no other rules.',
      );
      // Without two-factor on, the new password is all it asks for (ADR-0010 §8).
      await expect(page.getByLabel(/code/i)).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page, 'new password');

      const newPassword = `a new password for ${test.info().project.name}`;
      await field.fill(newPassword);
      await page.getByRole('button', { name: 'Save the new password' }).click();
      await expect(page).toHaveURL('/sign-in?password=changed');
      await expect(page.getByRole('status')).toHaveText(
        'Your password is changed. Sign in with the new one.',
      );
      if (javaScriptEnabled) await expectAccessible(page, 'password changed');
      await mailTo(account.email, 'Your Householdr password was changed');
      await signIn(page, { ...account, password: newPassword });

      // A link works once.
      await page.goto(link);
      await expect(page.getByText('This link has expired or was used already.')).toBeVisible();
      await expect(page.getByLabel('New password')).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page, 'link used');
      await page.getByRole('link', { name: 'Ask for a new link' }).click();
      await expect(page).toHaveURL('/forgot-password');
    });

    test('answers the same for an address without an account (ADR-0010 §2)', async ({ page }) => {
      const email = `nobody-${test.info().testId}@example.org`;
      await page.goto('/forgot-password');
      await page.getByLabel('E-mail address').fill(email);
      await page.getByRole('button', { name: 'Send the link' }).click();
      await expect(page.getByRole('status')).toHaveText(
        `If ${email} has an account, we’ve sent it a link to choose a new password. The link works once, within 30 minutes.`,
      );
    });

    test('says why a new password is refused, and keeps the link', async ({ page, account }) => {
      await forgetMail(account.email);
      await page.goto('/forgot-password');
      await page.getByLabel('E-mail address').fill(account.email);
      await page.getByRole('button', { name: 'Send the link' }).click();
      await page.goto(await resetLink(account.email));
      // The browser's own check comes first (UI-2); the server's is what a browser without one sees.
      const field = page.getByLabel('New password');
      await expect(field).toHaveAttribute('minlength', '12');
      await page.locator('form').evaluate((form: HTMLFormElement) => {
        form.noValidate = true;
      });
      await field.fill('too short');
      await page.getByRole('button', { name: 'Save the new password' }).click();
      const summary = page.getByRole('region', { name: 'Saving the password didn’t work' });
      await expect(summary).toHaveText(/Use at least 12 characters\./);
      await expect(summary).toBeFocused();
      // A form that doesn't reload keeps the password; the server never sends it back (ADR-0011
      // §6, clarification).
      await expect(page.getByLabel('New password')).toHaveValue(
        javaScriptEnabled ? 'too short' : '',
      );
      await expect(page.getByLabel('New password')).toHaveAttribute('aria-invalid', 'true');
      if (javaScriptEnabled) await expectAccessible(page, 'password refused');
      await page.getByLabel('New password').fill('a long enough new password');
      await page.getByRole('button', { name: 'Save the new password' }).click();
      await expect(page).toHaveURL('/sign-in?password=changed');
    });
  });
}
