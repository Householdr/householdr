import type { Browser, Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test, withAuthenticator } from './fixtures';
import { termsUrl } from './global-setup';
import { forgetMail, signUpLink } from './mail';
import { ownNetwork } from './proxy';

// Invitation links (ADR-0010 §5): a head makes one for a profile, someone with an account accepts
// it and joins as that profile, and the head sees who did. Behind onboarding's flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true };
const password = 'correct horse battery staple';

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** The members as the list shows them. */
const membersOf = (page: Page) => page.getByRole('list', { name: 'Members' }).getByRole('listitem');

/** Another person's browser, with or without JavaScript. */
async function someoneElse(
  browser: Browser,
  baseURL: string | undefined,
  javaScriptEnabled = true,
) {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled,
    // From a network of their own, so that limits per network don't count other tests' requests.
    extraHTTPHeaders: ownNetwork(`${test.info().testId}-invitee`),
  });
  await forceFlags(context, baseURL, flags);
  return context.newPage();
}

/** Signs the head in to Ash Lane, adds Kim's profile, and makes Kim's link; returns it. */
async function inviteKim(
  page: Page,
  accounts: {
    addSecondFactor: (email: string) => Promise<void>;
    addHousehold: (email: string, name: string) => Promise<string>;
  },
  account: { email: string; password: string },
) {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.getByLabel('Name').fill('Kim');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(membersOf(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Invite Kim' }).click();
  const link = page.getByLabel('Invitation link for Kim');
  await expect(link).toHaveAccessibleDescription(/It works once, for 7 days\./);
  return { id, link: await link.inputValue() };
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('someone signs in from the link, joins as the profile, and the head sees who did', async ({
      page,
      browser,
      baseURL,
      accounts,
      account,
    }, testInfo) => {
      const { id, link } = await inviteKim(page, accounts, account);
      expect(link).toMatch(/\/invitations\/[\w-]{43}$/);
      if (javaScriptEnabled) await expectAccessible(page, 'link made');

      const sam = { email: `${testInfo.testId}-sam@example.org`, password };
      await accounts.add(sam);
      const invitee = await someoneElse(browser, baseURL, javaScriptEnabled);
      // The token leaves the address bar at once (ADR-0017 §4).
      const response = await invitee.goto(link);
      await expect(invitee).toHaveURL('/invitation');
      expect(response?.headers()['referrer-policy']).toBe('same-origin');
      await expect(invitee).toHaveTitle('Invitation · Householdr');
      await expect(invitee.getByRole('heading', { level: 1 })).toHaveText('Join Ash Lane');
      await expect(
        invitee.getByText('You’re invited to join Ash Lane on Householdr as Kim.'),
      ).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(invitee, 'invitation, signed out');
      await invitee.getByRole('link', { name: 'Sign in' }).click();
      await invitee.getByLabel('E-mail address').fill(sam.email);
      await invitee.getByLabel('Password').fill(sam.password);
      await invitee.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(invitee).toHaveURL('/invitation');
      if (javaScriptEnabled) await expectAccessible(invitee, 'invitation, signed in');
      await invitee.getByRole('button', { name: 'Join the household' }).click();
      await expect(invitee).toHaveURL(`/households/${id}`);
      await expect(membersOf(invitee)).toHaveText([/Robin\s*Head/, /Kim \(you\)\s*Adult/]);

      // The head sees who accepted (ADR-0010 §5); the link is used up.
      await page.goto(`/households/${id}`);
      await expect(membersOf(page).nth(1)).toContainText(`Joined as Robin, ${sam.email}`);
      await expect(page.getByRole('button', { name: 'Invite Kim' })).toHaveCount(0);
      await invitee.goto(link);
      await expect(
        invitee.getByText('This invitation has expired or was used already.'),
      ).toBeVisible();
      await invitee.context().close();
    });

    test('a revoked or replaced link no longer works', async ({
      page,
      browser,
      baseURL,
      accounts,
      account,
    }) => {
      const first = await inviteKim(page, accounts, account);
      await page.getByRole('button', { name: 'Make a new link for Kim' }).click();
      const field = page.getByLabel('Invitation link for Kim');
      await expect(field).not.toHaveValue(first.link);
      const second = await field.inputValue();
      await page.goto(`/households/${first.id}`);
      await expect(
        page.getByText('An invitation link is out. It works for 7 more days.'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Revoke Kim’s link' }).click();
      await expect(page.getByRole('status').first()).toHaveText(
        'Kim’s link is revoked: it no longer works.',
      );
      const invitee = await someoneElse(browser, baseURL, javaScriptEnabled);
      for (const link of [first.link, second]) {
        await invitee.goto(link);
        await expect(
          invitee.getByText('This invitation has expired or was used already.'),
        ).toBeVisible();
      }
      if (javaScriptEnabled) await expectAccessible(invitee, 'expired');
      await invitee.context().close();
    });

    test('says when the account is already a member', async ({ page, accounts, account }) => {
      const { link } = await inviteKim(page, accounts, account);
      await page.goto(link);
      await page.getByRole('button', { name: 'Join the household' }).click();
      const summary = page.getByRole('region', { name: 'Joining didn’t work' });
      await expect(summary).toHaveText(/You’re already a member of Ash Lane\./);
      await expect(summary).toBeFocused();
      if (javaScriptEnabled) await expectAccessible(page, 'already a member');
    });
  });
}

test('copies the link where the browser can', async ({ page, context, accounts, account }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { link } = await inviteKim(page, accounts, account);
  await page.getByRole('button', { name: 'Copy the link' }).click();
  await expect(page.getByRole('status').first()).toHaveText('The link is copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
});

/** Opens `link` in `invitee`'s browser, and confirms a new address from there (ADR-0010 §1). */
async function confirmNewAddress(invitee: Page, link: string, email: string) {
  await forgetMail(email);
  await invitee.goto(link);
  await invitee.getByRole('link', { name: 'New here? Create an account' }).click();
  await expect(invitee).toHaveURL('/sign-up');
  await invitee.getByLabel('E-mail address').fill(email);
  await invitee.getByRole('button', { name: 'Send the link' }).click();
  await expect(invitee.getByRole('status')).toContainText(email);
  // The link in the e-mail comes back to the invitation, in the browser that opened it.
  await invitee.goto(await signUpLink(email));
  await expect(invitee).toHaveURL('/invitation');
}

test('someone new creates an account with a passkey from the link, and joins', async ({
  page,
  browser,
  baseURL,
  accounts,
  account,
}, testInfo) => {
  const { id, link } = await inviteKim(page, accounts, account);
  const invitee = await someoneElse(browser, baseURL);
  await withAuthenticator(invitee);
  const email = `${testInfo.testId}-sam@example.org`;
  await confirmNewAddress(invitee, link, email);
  await expect(
    invitee.getByText(`Your e-mail address ${email} is confirmed. Create your account to join.`),
  ).toBeVisible();
  // The profile's name to start with, which is theirs to change (ADR-0010 §1, clarification).
  await expect(invitee.getByLabel('Your name')).toHaveValue('Kim');
  await expect(invitee.getByLabel('Your name')).toHaveAttribute('autocomplete', 'name');
  // The instance's terms, as the founding head accepts them, in a new tab so the form stays
  // (ADR-0010 §1, clarification).
  const terms = invitee.getByRole('link', { name: 'Read the terms (opens in a new tab)' });
  await expect(terms).toHaveAttribute('href', termsUrl);
  await expect(terms).toHaveAttribute('target', '_blank');
  await expectAccessible(invitee, 'creating an account');
  await invitee.getByLabel('Your name').fill('Sam');
  await invitee.getByRole('checkbox', { name: 'I accept the terms' }).check();
  await invitee.getByRole('button', { name: 'Create my account with a passkey and join' }).click();
  await expect(invitee).toHaveURL(`/households/${id}`);
  await expect(membersOf(invitee)).toHaveText([/Robin\s*Head/, /Kim \(you\)\s*Adult/]);
  await expectAccessible(invitee, 'joined');

  await page.goto(`/households/${id}`);
  await expect(membersOf(page).nth(1)).toContainText(`Joined as Sam, ${email}`);
  await invitee.context().close();
});

test('says what a new account needs before a passkey is made', async ({
  page,
  browser,
  baseURL,
  accounts,
  account,
}, testInfo) => {
  const { link } = await inviteKim(page, accounts, account);
  const invitee = await someoneElse(browser, baseURL);
  const authenticator = await withAuthenticator(invitee);
  await confirmNewAddress(invitee, link, `${testInfo.testId}-sam@example.org`);
  // The browser's own checks come first (UI-2); the server's are what a browser without them sees.
  await invitee.locator('form').evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await invitee.getByLabel('Your name').fill(' ');
  await invitee.getByRole('button', { name: 'Create my account with a passkey and join' }).click();
  const summary = invitee.getByRole('region', { name: 'Joining didn’t work' });
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Enter your name, up to 100 characters.',
    'Accept the terms to create an account.',
  ]);
  await expect(invitee.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  const terms = invitee.getByRole('checkbox', { name: 'I accept the terms' });
  await expect(terms).toHaveAttribute('aria-invalid', 'true');
  await expect(terms).toHaveAccessibleDescription('Accept the terms to create an account.');
  await expectAccessible(invitee, 'fields refused');
  expect(await authenticator.passkeys()).toEqual([]);
  await invitee.context().close();
});

test('says so where the browser can’t make a passkey', async ({
  page,
  browser,
  baseURL,
  accounts,
  account,
}, testInfo) => {
  const { link } = await inviteKim(page, accounts, account);
  const invitee = await someoneElse(browser, baseURL, false);
  await confirmNewAddress(invitee, link, `${testInfo.testId}-sam@example.org`);
  // Playwright's text locators skip what is inside <noscript> (TEST-3 exception).
  await expect(invitee.locator('noscript p')).toHaveText(
    /Creating an account needs a passkey, which this browser can’t make\./,
  );
  await expect(
    invitee.getByRole('button', { name: 'Create my account with a passkey and join' }),
  ).toHaveCount(0);
  await invitee.context().close();
});
