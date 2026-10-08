import { expect, expectAccessible, forceFlags, test } from './fixtures';
import { forgetMail, mailTo, subjectsTo } from './mail';

// Signing up starts by confirming the e-mail address with an e-mailed link (ADR-0010 §1,
// clarifications), while the onboarding flag is off by default (CODE-20).

test('the sign-up pages aren’t there while their flag is off', async ({
  page,
  context,
  baseURL,
}) => {
  await forceFlags(context, baseURL, { 'sign-in': true });
  for (const path of ['/sign-up', '/sign-up/a-token', '/sign-up/household']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
  await page.goto('/sign-in');
  await expect(page.getByRole('link', { name: 'New here? Create a household' })).toHaveCount(0);
});

/** The link in the sign-up e-mail to `address`. */
const signUpLink = async (address: string) => {
  const text = await mailTo(address, 'Confirm your e-mail address for Householdr');
  const link = /https?:\/\/\S+\/sign-up\/\S+/.exec(text)?.[0];
  if (!link) throw new Error(`No link in: ${text}`);
  return link;
};

/** What the sign-up page says once a link is asked for `email`, whether or not it has an account. */
const sent = (email: string) =>
  `If ${email} has no account yet, we’ve sent it a link to continue. The link works for 30 minutes.`;

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });
    test.beforeEach(async ({ context, baseURL }) => {
      await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true });
    });

    test('sends a link that confirms the address', async ({ page }) => {
      const email = `${test.info().testId}-new@example.org`;
      await forgetMail(email);
      await page.goto('/sign-in');
      await page.getByRole('link', { name: 'New here? Create a household' }).click();
      await expect(page).toHaveURL('/sign-up');
      await expect(page).toHaveTitle('Create a household · Householdr');
      if (javaScriptEnabled) await expectAccessible(page);
      const field = page.getByLabel('E-mail address');
      // What password managers and browsers fill in (UI-14).
      await expect(field).toHaveAttribute('autocomplete', 'email');
      await field.fill(email);
      await page.getByRole('button', { name: 'Send the link' }).click();
      await expect(page.getByRole('status')).toHaveText(sent(email));
      if (javaScriptEnabled) await expectAccessible(page, 'link sent');

      // The token leaves the address bar at once, and no page it leads to sends a referrer to
      // another site (ADR-0017 §4, clarification).
      const response = await page.goto(await signUpLink(email));
      await expect(page).toHaveURL('/sign-up/household');
      expect(response?.headers()['referrer-policy']).toBe('same-origin');
      await expect(page).toHaveTitle('Set up your household · Householdr');
      await expect(page.getByText(`Your e-mail address ${email} is confirmed.`)).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'address confirmed');
    });

    test('answers the same for an address with an account, and sends it nothing', async ({
      page,
      account,
    }) => {
      const email = `${test.info().testId}-new@example.org`;
      await forgetMail(account.email);
      for (const address of [account.email, email]) {
        await page.goto('/sign-up');
        await page.getByLabel('E-mail address').fill(address);
        await page.getByRole('button', { name: 'Send the link' }).click();
        await expect(page.getByRole('status')).toHaveText(sent(address));
      }
      // The e-mail asked for second has arrived, and none came for the first.
      await signUpLink(email);
      expect(await subjectsTo(account.email)).toEqual([]);
    });

    test('says when a link no longer works, and asks for a new one', async ({ page }) => {
      await page.goto('/sign-up/not-a-token');
      await expect(page).toHaveURL('/sign-up/household');
      await expect(page.getByText('This link has expired or was used already.')).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'link expired');
      await page.getByRole('link', { name: 'Ask for a new link' }).click();
      await expect(page).toHaveURL('/sign-up');
    });

    test('says what isn’t an e-mail address', async ({ page }) => {
      await page.goto('/sign-up');
      // The browser's own check comes first (UI-2); the server's is what a browser without one sees.
      await page.locator('form').evaluate((form: HTMLFormElement) => {
        form.noValidate = true;
      });
      await page.getByLabel('E-mail address').fill('robin');
      await page.getByRole('button', { name: 'Send the link' }).click();
      const summary = page.getByRole('region', { name: 'Sending the link didn’t work' });
      await expect(summary).toHaveText(/Enter an e-mail address, like name@example\.org\./);
      await expect(summary).toBeFocused();
      await expect(page.getByLabel('E-mail address')).toHaveValue('robin');
      if (javaScriptEnabled) await expectAccessible(page, 'not an address');
    });
  });
}
