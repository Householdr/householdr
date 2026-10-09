import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test, withAuthenticator } from './fixtures';
import { forgetMail, mailTo } from './mail';
import { proxyHeaders } from './proxy';

// Adding and removing passkeys on the security page, signing in with them, and confirming it's you
// with them (ADR-0010 §2, §6), behind their release flag (CODE-20).

const flags = { 'sign-in': true, passkeys: true };
const firefoxOnLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';

test('the passkeys aren’t on the security page while their flag is off', async ({
  page,
  context,
  baseURL,
  account,
}) => {
  await forceFlags(context, baseURL, { 'sign-in': true });
  await signIn(page, account);
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toHaveCount(0);
});

test('adds a passkey, named after the device, and e-mails the member', async ({
  page,
  context,
  baseURL,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  await withAuthenticator(page);
  await forgetMail(account.email);
  await signIn(page, account);
  const section = page.getByRole('region', { name: 'Passkeys' });
  await expect(section).toContainText('You have no passkeys yet.');
  await expectAccessible(page);

  await section.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(section.getByRole('status')).toHaveText('The passkey is added.');
  const passkeys = section.getByRole('list', { name: 'Passkeys' }).getByRole('listitem');
  await expect(passkeys).toHaveCount(1);
  await expect(passkeys).toContainText(/Chrome on (Windows|Android)/);
  await expect(passkeys).toContainText('Added in the last 24 hours');
  await expectAccessible(page, 'passkey added');
  await mailTo(account.email, 'A passkey was added to your Householdr account');
});

/** Adds a passkey on the security page `page` shows, and signs out of this device. */
async function addPasskeyAndSignOut(page: Page) {
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('The passkey is added.')).toBeVisible();
  await page
    .getByRole('list', { name: 'Signed-in devices' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(page).toHaveURL('/sign-in');
}

test('the sign-in page offers no passkey while their flag is off', async ({
  page,
  context,
  baseURL,
}) => {
  await forceFlags(context, baseURL, { 'sign-in': true });
  await page.goto('/sign-in');
  await expect(page.getByLabel('E-mail address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0);
});

test('signs in with a passkey, first on the sign-in page', async ({
  page,
  context,
  baseURL,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  await withAuthenticator(page);
  await signIn(page, account);
  await addPasskeyAndSignOut(page);

  const passkey = page.getByRole('button', { name: 'Sign in with a passkey' });
  await expect(passkey).toBeVisible();
  // Before the e-mail address and password (ADR-0011 §6).
  await expect(page.getByRole('button').first()).toHaveAccessibleName('Sign in with a passkey');
  await expectAccessible(page, 'sign-in with a passkey');
  await passkey.click();
  await expect(page).toHaveURL('/security');
  await expect(
    page.getByRole('list', { name: 'Signed-in devices' }).getByRole('listitem'),
  ).toContainText('This device');
});

test('says when a passkey doesn’t sign in, and keeps the password', async ({
  page,
  context,
  baseURL,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  await withAuthenticator(page);
  await signIn(page, account);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('The passkey is added.')).toBeVisible();
  // Removed from the account, though the device still has it.
  await page
    .getByRole('list', { name: 'Passkeys' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page.getByText('The passkey is removed.')).toBeVisible();
  await page
    .getByRole('list', { name: 'Signed-in devices' })
    .getByRole('button', { name: 'Sign out' })
    .click();

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  const summary = page.getByRole('region', { name: 'Signing in didn’t work' });
  await expect(summary).toHaveText(/Signing in with a passkey didn’t work\./);
  await expect(summary).toBeFocused();
  await expectAccessible(page, 'passkey refused');
  await page.getByLabel('E-mail address').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/security');
});

test('confirms it’s you with a passkey once the sign-in is 10 minutes old', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  await withAuthenticator(page);
  await signIn(page, account);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('The passkey is added.')).toBeVisible();
  await accounts.signedInLongAgo(account.email);
  await page.reload();
  const confirm = page.getByRole('region', { name: 'Confirm it’s you' });
  await confirm.getByRole('button', { name: 'Confirm with a passkey' }).click();
  await expect(page).toHaveURL('/security?confirmed');
  await expect(
    page.getByRole('status').filter({ hasText: 'Confirmed. For the next 10 minutes' }),
  ).toHaveText('Confirmed. For the next 10 minutes, you can change how you sign in.');
  const section = page.getByRole('region', { name: 'Passkeys' });
  await expect(section.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });
    test.beforeEach(async ({ context, baseURL }) => {
      await forceFlags(context, baseURL, flags);
    });

    test('removes a passkey added on another device, and e-mails the member', async ({
      page,
      browser,
      baseURL,
      account,
    }) => {
      // Only a browser with JavaScript can add one: a laptop, with Firefox on Linux.
      const laptop = await browser.newContext({
        baseURL,
        userAgent: firefoxOnLinux,
        extraHTTPHeaders: proxyHeaders,
        javaScriptEnabled: true,
      });
      await forceFlags(laptop, baseURL, flags);
      const there = await laptop.newPage();
      await withAuthenticator(there);
      await signIn(there, account);
      await there.getByRole('button', { name: 'Add a passkey' }).click();
      await expect(there.getByText('The passkey is added.')).toBeVisible();

      await forgetMail(account.email);
      await signIn(page, account);
      const section = page.getByRole('region', { name: 'Passkeys' });
      const passkey = section.getByRole('list', { name: 'Passkeys' }).getByRole('listitem');
      await expect(passkey).toContainText('Firefox on Linux');
      // A browser without JavaScript can't add one, so it isn't offered there.
      await expect(section.getByRole('button', { name: 'Add a passkey' })).toHaveCount(
        javaScriptEnabled ? 1 : 0,
      );
      const remove = passkey.getByRole('button', { name: 'Remove' });
      await expect(remove).toHaveAccessibleDescription(/Firefox on Linux/);
      await remove.click();
      await expect(section.getByRole('status')).toHaveText('The passkey is removed.');
      await expect(section).toContainText('You have no passkeys yet.');
      if (javaScriptEnabled) {
        await expect(section.getByRole('heading', { name: 'Passkeys' })).toBeFocused();
      }
      await mailTo(account.email, 'A passkey was removed from your Householdr account');
    });

    test('keeps a head’s last passkey without two-factor, and says why (ADR-0010 §3)', async ({
      page,
      accounts,
      account,
    }) => {
      await signIn(page, account);
      // A passkey no device holds, and a password without two-factor.
      await accounts.addSecondFactor(account.email);
      await accounts.addHousehold(account.email, 'Ash Lane');
      await page.goto('/security');
      const section = page.getByRole('region', { name: 'Passkeys' });
      const passkeys = section.getByRole('list', { name: 'Passkeys' }).getByRole('listitem');
      await expect(passkeys).toHaveCount(1);
      await passkeys.getByRole('button', { name: 'Remove' }).click();
      const summary = page.getByRole('region', { name: 'Removing the passkey didn’t work' });
      await expect(summary).toContainText(
        'As a head of a household, you need two factors to sign in. Add another passkey first, then you can remove this one.',
      );
      await expect(summary).toBeFocused();
      await expect(passkeys).toHaveCount(1);
      await expect(section.getByRole('status')).toHaveText('');
      if (javaScriptEnabled) await expectAccessible(page, 'head keeps the last passkey');
    });

    test('asks to confirm it’s you once the sign-in is 10 minutes old', async ({
      page,
      accounts,
      account,
    }) => {
      await signIn(page, account);
      await accounts.signedInLongAgo(account.email);
      await page.reload();
      const section = page.getByRole('region', { name: 'Confirm it’s you' });
      await expect(section.getByRole('heading', { name: 'Confirm it’s you' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
      // Without two-factor on, the password is enough.
      await expect(section.getByLabel('Code from your authenticator app')).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page, 'confirm it’s you');

      const field = section.getByLabel('Password');
      // What password managers fill in (UI-14).
      await expect(field).toHaveAttribute('autocomplete', 'current-password');
      await field.fill('not the password');
      await section.getByRole('button', { name: 'Confirm' }).click();
      const summary = page.getByRole('region', { name: 'Confirming didn’t work' });
      await expect(summary).toHaveText(/The password is incorrect\./);
      await expect(summary).toBeFocused();
      if (javaScriptEnabled) await expectAccessible(page, 'confirming failed');

      await section.getByLabel('Password').fill(account.password);
      await section.getByRole('button', { name: 'Confirm' }).click();
      await expect(page).toHaveURL('/security?confirmed');
      await expect(
        page.getByRole('status').filter({ hasText: 'Confirmed. For the next 10 minutes' }),
      ).toHaveText('Confirmed. For the next 10 minutes, you can change how you sign in.');
      await expect(page.getByRole('heading', { name: 'Confirm it’s you' })).toHaveCount(0);
      // One device signed in, not two: the confirmation replaced the old session.
      await expect(
        page.getByRole('list', { name: 'Signed-in devices' }).getByRole('listitem'),
      ).toHaveCount(1);
    });
  });
}
