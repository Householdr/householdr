import { totpCode } from '@householdr/auth/testing';
import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test, withAuthenticator } from './fixtures';
import { forgetMail, mailTo, resetLink } from './mail';

// Two-factor codes from an authenticator app: turning them on and off on the security page,
// signing in with them or a recovery code, confirming it's you with one, and choosing a new
// password with one (ADR-0010 §2, §3, §6, §8), behind their release flag (CODE-20). The tests compute the app's codes from the key the page
// shows, as an app would. Axe needs JavaScript in the page, so it checks the pages with it.

const flags = { 'sign-in': true, 'two-factor': true };

/** The section of the security page about two-factor. */
const section = (page: Page) => page.getByRole('region', { name: 'Two-factor authentication' });

/** A code that is wrong now for the app set up with `key`. */
const wrongCode = (key: string) => String((Number(totpCode(key)) + 1) % 1_000_000).padStart(6, '0');

/**
 * Turns two-factor on from the security page `page` shows: scans nothing, but reads the key the
 * page shows for typing in. Returns the key and the recovery codes.
 */
async function turnOn(page: Page) {
  await section(page).getByRole('button', { name: 'Turn on two-factor authentication' }).click();
  await expect(
    section(page).getByRole('heading', { name: 'Set up your authenticator app' }),
  ).toBeVisible();
  const key = ((await section(page).getByRole('code').textContent()) ?? '').replaceAll(' ', '');
  await section(page).getByLabel('Code from the app').fill(totpCode(key));
  await section(page).getByRole('button', { name: 'Turn on', exact: true }).click();
  const codes = section(page)
    .getByRole('list', { name: 'Your recovery codes' })
    .getByRole('listitem');
  await expect(codes).toHaveCount(10);
  return { key, recoveryCodes: await codes.allTextContents() };
}

/** Signs this device out from the security page, back to the sign-in page. */
async function signOut(page: Page) {
  await page
    .getByRole('list', { name: 'Signed-in devices' })
    .getByRole('listitem')
    .filter({ hasText: 'This device' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(page).toHaveURL('/sign-in');
}

/** The sign-in page's password step, which goes on to the code step for two-factor. */
async function password(page: Page, { email, password }: { email: string; password: string }) {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/sign-in/two-factor');
}

test('the security page shows nothing of two-factor while its flag is off', async ({
  page,
  context,
  baseURL,
  account,
}) => {
  await forceFlags(context, baseURL, { 'sign-in': true });
  await signIn(page, account);
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /two-factor/ })).toHaveCount(0);
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });
    test.beforeEach(async ({ context, baseURL }) => {
      await forceFlags(context, baseURL, flags);
    });

    test('turns two-factor on with the app’s first code, and e-mails the member', async ({
      page,
      account,
    }) => {
      await forgetMail(account.email);
      await signIn(page, account);
      await expect(section(page).getByRole('status')).toHaveText(
        'Two-factor authentication is off.',
      );
      if (javaScriptEnabled) await expectAccessible(page, 'two-factor off');

      await section(page)
        .getByRole('button', { name: 'Turn on two-factor authentication' })
        .click();
      const setup = section(page).getByRole('heading', { name: 'Set up your authenticator app' });
      await expect(setup).toBeVisible();
      if (javaScriptEnabled) await expect(setup).toBeFocused();
      await expect(
        section(page).getByRole('img', { name: 'QR code to set up your authenticator app' }),
      ).toBeVisible();
      const key = ((await section(page).getByRole('code').textContent()) ?? '').replaceAll(' ', '');
      expect(key).toMatch(/^[A-Z2-7]{52}$/);
      const field = section(page).getByLabel('Code from the app');
      // What password managers and phones fill in, with a keypad of digits (ADR-0011 §6, UI-14).
      await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
      await expect(field).toHaveAttribute('inputmode', 'numeric');
      if (javaScriptEnabled) await expectAccessible(page, 'setting up the app');

      await field.fill(wrongCode(key));
      await section(page).getByRole('button', { name: 'Turn on', exact: true }).click();
      const summary = page.getByRole('region', { name: 'Two-factor authentication didn’t change' });
      await expect(summary).toContainText('The code is incorrect.');
      await expect(summary).toBeFocused();
      // The setup is still there. A code comes back empty after a reload, as without JavaScript,
      // and stays in its field otherwise (ADR-0011 §6, clarification).
      await expect(section(page).getByRole('code')).toHaveText(
        key.match(/.{1,4}/g)?.join(' ') ?? '',
      );
      if (!javaScriptEnabled) {
        await expect(section(page).getByLabel('Code from the app')).toHaveValue('');
      }
      if (javaScriptEnabled) await expectAccessible(page, 'wrong first code');

      await section(page).getByLabel('Code from the app').fill(totpCode(key));
      await section(page).getByRole('button', { name: 'Turn on', exact: true }).click();
      const codes = section(page).getByRole('list', { name: 'Your recovery codes' });
      await expect(codes.getByRole('listitem')).toHaveCount(10);
      await expect(codes.getByRole('listitem').first()).toHaveText(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
      if (javaScriptEnabled) {
        await expect(
          section(page).getByRole('heading', { name: 'Your recovery codes' }),
        ).toBeFocused();
      }
      await expect(section(page).getByRole('status')).toHaveText(
        'Two-factor authentication is on.',
      );
      if (javaScriptEnabled) await expectAccessible(page, 'recovery codes');
      await mailTo(
        account.email,
        'Two-factor authentication was turned on for your Householdr account',
      );

      // Shown once: gone once the page loads again.
      await section(page).getByRole('link', { name: 'Done' }).click();
      await expect(section(page).getByRole('list', { name: 'Your recovery codes' })).toHaveCount(0);
      await expect(
        section(page).getByRole('button', { name: 'Turn off two-factor authentication' }),
      ).toBeVisible();
    });

    test('asks for a code after the password, and refuses a wrong one', async ({
      page,
      account,
    }) => {
      await signIn(page, account);
      const { key } = await turnOn(page);
      await signOut(page);

      await password(page, account);
      await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
      const field = page.getByLabel('Code from your authenticator app');
      await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
      await expect(field).toHaveAttribute('inputmode', 'numeric');
      if (javaScriptEnabled) await expectAccessible(page, 'code step');
      // No session yet: the security page still sends to the sign-in page.
      await page.goto('/security');
      await expect(page).toHaveURL('/sign-in');

      await password(page, account);
      await page.getByLabel('Code from your authenticator app').fill(wrongCode(key));
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const summary = page.getByRole('region', { name: 'Signing in didn’t work' });
      await expect(summary).toContainText('The code is incorrect.');
      await expect(summary).toBeFocused();
      if (!javaScriptEnabled) {
        await expect(page.getByLabel('Code from your authenticator app')).toHaveValue('');
      }
      if (javaScriptEnabled) await expectAccessible(page, 'wrong code');

      await page.getByLabel('Code from your authenticator app').fill(totpCode(key));
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL('/security');
      await expect(section(page).getByRole('status')).toHaveText(
        'Two-factor authentication is on.',
      );
    });

    test('signs in with a recovery code, which works once', async ({ page, account }) => {
      await signIn(page, account);
      const { recoveryCodes } = await turnOn(page);
      const [code = ''] = recoveryCodes;
      await signOut(page);

      for (const attempt of ['first', 'again']) {
        await password(page, account);
        await page.getByText('Use a recovery code instead').click();
        const field = page.getByLabel('Recovery code');
        await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
        await field.fill(code.toUpperCase());
        await page.getByRole('button', { name: 'Sign in with the recovery code' }).click();
        if (attempt === 'first') {
          await expect(page).toHaveURL('/security');
          await signOut(page);
        }
      }
      const summary = page.getByRole('region', { name: 'Signing in didn’t work' });
      await expect(summary).toContainText(
        'The recovery code is incorrect, or it was used already.',
      );
      await expect(summary).toBeFocused();
      await expect(page.getByLabel('Recovery code')).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'recovery code used');
    });

    test('asks for a code with a new password from a reset link (ADR-0010 §8)', async ({
      page,
      context,
      baseURL,
      account,
    }) => {
      await forceFlags(context, baseURL, { ...flags, 'password-reset': true });
      await signIn(page, account);
      const { key, recoveryCodes } = await turnOn(page);
      await signOut(page);
      await forgetMail(account.email);
      await page.goto('/forgot-password');
      await page.getByLabel('E-mail address').fill(account.email);
      await page.getByRole('button', { name: 'Send the link' }).click();
      await expect(page.getByRole('status')).toContainText(account.email);
      await page.goto(await resetLink(account.email));
      await expect(page).toHaveURL('/reset-password');

      const code = page.getByLabel('Code from your authenticator app, or a recovery code');
      await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      await expect(code).toHaveAccessibleDescription(
        'Enter the code your authenticator app shows for Householdr. Without the app, enter one of the recovery codes you saved when you turned on two-factor authentication, such as abcde-12345. Each works once.',
      );
      if (javaScriptEnabled) await expectAccessible(page, 'new password with a code');

      // A wrong code changes nothing, and the link keeps working.
      const newPassword = `a new password for ${test.info().project.name}`;
      await page.getByLabel('New password').fill(newPassword);
      await code.fill(wrongCode(key));
      await page.getByRole('button', { name: 'Save the new password' }).click();
      const summary = page.getByRole('region', { name: 'Saving the password didn’t work' });
      await expect(summary).toContainText('The code is incorrect, or it was used already.');
      await expect(summary).toBeFocused();
      await expect(code).toHaveAttribute('aria-invalid', 'true');
      // Neither the password nor the code comes back from the server (ADR-0011 §6, clarification).
      if (!javaScriptEnabled) {
        await expect(page.getByLabel('New password')).toHaveValue('');
        await expect(code).toHaveValue('');
      }
      if (javaScriptEnabled) await expectAccessible(page, 'wrong code with a new password');

      await page.getByLabel('New password').fill(newPassword);
      await code.fill(recoveryCodes[0] ?? '');
      await page.getByRole('button', { name: 'Save the new password' }).click();
      await expect(page).toHaveURL('/sign-in?password=changed');
      await mailTo(account.email, 'Your Householdr password was changed');

      // The new password, and still the app's code after it.
      await password(page, { ...account, password: newPassword });
      await page.getByLabel('Code from your authenticator app').fill(totpCode(key));
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL('/security');
    });

    test('asks for a code too to confirm it’s you, and turns two-factor off', async ({
      page,
      accounts,
      account,
    }) => {
      await signIn(page, account);
      const { key } = await turnOn(page);
      await accounts.signedInLongAgo(account.email);
      await page.goto('/security');
      const confirm = page.getByRole('region', { name: 'Confirm it’s you' });
      await expect(
        section(page).getByRole('button', { name: 'Turn off two-factor authentication' }),
      ).toHaveCount(0);
      await confirm.getByLabel('Password').fill(account.password);
      const code = confirm.getByLabel('Code from your authenticator app');
      await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      await code.fill(wrongCode(key));
      await confirm.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByRole('region', { name: 'Confirming didn’t work' })).toContainText(
        'The code from your authenticator app is incorrect.',
      );
      if (javaScriptEnabled) await expectAccessible(page, 'confirming with a code');

      await forgetMail(account.email);
      await confirm.getByLabel('Password').fill(account.password);
      await confirm.getByLabel('Code from your authenticator app').fill(totpCode(key));
      await confirm.getByRole('button', { name: 'Confirm' }).click();
      await expect(page).toHaveURL('/security?confirmed');
      await section(page)
        .getByRole('button', { name: 'Turn off two-factor authentication' })
        .click();
      await expect(section(page).getByRole('status')).toHaveText(
        'Two-factor authentication is off.',
      );
      await mailTo(
        account.email,
        'Two-factor authentication was turned off for your Householdr account',
      );
      // The password signs in on its own again.
      await signOut(page);
      await signIn(page, account);
    });
  });
}

test('makes new recovery codes, and the old ones stop working', async ({
  page,
  context,
  baseURL,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  await signIn(page, account);
  const { recoveryCodes } = await turnOn(page);
  await section(page).getByRole('link', { name: 'Done' }).click();
  await forgetMail(account.email);
  await section(page).getByRole('button', { name: 'Make new recovery codes' }).click();
  await expect(section(page).getByRole('status')).toHaveText(
    'New recovery codes are made. The old ones no longer work.',
  );
  const codes = section(page)
    .getByRole('list', { name: 'Your recovery codes' })
    .getByRole('listitem');
  await expect(codes).toHaveCount(10);
  expect(await codes.allTextContents()).not.toContain(recoveryCodes[0]);
  await mailTo(account.email, 'New recovery codes were made for your Householdr account');
  await signOut(page);
  await password(page, account);
  await page.getByText('Use a recovery code instead').click();
  await page.getByLabel('Recovery code').fill(recoveryCodes[0] ?? '');
  await page.getByRole('button', { name: 'Sign in with the recovery code' }).click();
  await expect(page.getByRole('region', { name: 'Signing in didn’t work' })).toBeVisible();
});

test('keeps it on for a head without a passkey, and says why (ADR-0010 §3)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  await signIn(page, account);
  await turnOn(page);
  await accounts.addHousehold(account.email, 'Ash Lane');
  await section(page).getByRole('link', { name: 'Done' }).click();
  await section(page).getByRole('button', { name: 'Turn off two-factor authentication' }).click();
  const summary = page.getByRole('region', { name: 'Two-factor authentication didn’t change' });
  await expect(summary).toContainText('As a head of a household, you need two factors to sign in.');
  await expect(summary).toBeFocused();
  await expect(section(page).getByRole('status')).toHaveText('Two-factor authentication is on.');
  await expectAccessible(page, 'head keeps two-factor');
});

test('never asks a passkey for a code, since it is two factors already', async ({
  page,
  context,
  baseURL,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, passkeys: true });
  await withAuthenticator(page);
  await signIn(page, account);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('The passkey is added.')).toBeVisible();
  await turnOn(page);
  await signOut(page);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL('/security');
});
