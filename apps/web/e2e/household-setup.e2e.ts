import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, test, withAuthenticator } from './fixtures';
import { termsUrl } from './global-setup';
import { forgetMail, signUpLink, subjectsTo } from './mail';

// The first step of setting up a household: its settings, the head's name and language, and the
// account secured with a passkey, all created at once (ADR-0007 §2; ADR-0010 §1, §3,
// clarifications), behind the onboarding flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, passkeys: true };

/** Asks for a sign-up link for this test's own address, and opens it on `page`. */
async function openSignUpLink(page: Page) {
  const email = `${test.info().testId}-head@example.org`;
  await forgetMail(email);
  await page.goto('/sign-up');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText(email);
  const link = await signUpLink(email);
  await page.goto(link);
  await expect(page).toHaveURL('/sign-up/household');
  return { email, link };
}

/** Fills in what the browser can't, and ticks the boxes. */
async function fillIn(page: Page) {
  await page.getByLabel('Household name').fill('Ash Lane');
  await page.getByLabel('Your name').fill('Robin');
  await page.getByRole('checkbox', { name: 'I am 18 or older' }).check();
  await page.getByRole('checkbox', { name: 'I accept the terms' }).check();
}

/** The page of a household, where its new head lands (ADR-0005 §1). */
const household = /\/households\/[0-9a-f-]{36}$/;

const create = (page: Page) =>
  page.getByRole('button', { name: 'Create the household with a passkey' });

test.describe('with JavaScript and passkeys', () => {
  // A browser in Brussels: its time zone is all the page uses to fill in the country.
  test.use({ timezoneId: 'Europe/Brussels' });
  test.beforeEach(async ({ context, baseURL }) => {
    await forceFlags(context, baseURL, flags);
  });

  test('creates the household and signs in with its new passkey', async ({ page }) => {
    await withAuthenticator(page);
    const { email, link } = await openSignUpLink(page);
    await expect(page).toHaveTitle('Set up your household · Householdr');
    // Filled in from the browser, for the head to confirm (ADR-0007 §2).
    await expect(page.getByLabel('Country')).toHaveValue('BE');
    await expect(page.getByLabel('Country').locator('option:checked')).toHaveText('Belgium');
    await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Brussels');
    await expect(page.getByLabel('Time zone').locator('option:checked')).toHaveText(
      'Brussels (Central European Time)',
    );
    await expect(page.getByLabel('Household language')).toHaveValue('en');
    await expect(page.getByLabel('Your language')).toHaveValue('en');
    await expect(page.getByLabel('Weeks start on').locator('option:checked')).toHaveText('Monday');
    await expect(page.getByLabel('Household language')).toHaveAccessibleDescription(
      'Whoever you invite starts with this language, and can choose their own.',
    );
    // What browsers fill in for a name (UI-14), and nothing for the household's.
    await expect(page.getByLabel('Your name')).toHaveAttribute('autocomplete', 'name');
    await expect(page.getByLabel('Household name')).toHaveAttribute('autocomplete', 'off');
    // The instance's terms, in a new tab so the form stays (ADR-0007 §2, clarification).
    const terms = page.getByRole('link', { name: 'Read the terms (opens in a new tab)' });
    await expect(terms).toHaveAttribute('href', termsUrl);
    await expect(terms).toHaveAttribute('target', '_blank');
    await expectAccessible(page, 'step 1');

    await fillIn(page);
    await create(page).click();
    await expect(page).toHaveURL(household);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ash Lane');
    await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveText([
      /Robin \(you\)\s*Head/,
    ]);
    await page.getByRole('link', { name: 'Security' }).click();
    await expect(
      page.getByRole('list', { name: 'Signed-in devices' }).getByRole('listitem'),
    ).toContainText('This device');
    const passkeys = page.getByRole('list', { name: 'Passkeys' }).getByRole('listitem');
    await expect(passkeys).toHaveCount(1);
    await expect(passkeys).toContainText(/Chrome on (Windows|Android)/);
    await expectAccessible(page, 'signed in');
    // The passkey is part of creating the account, so no e-mail says one was added.
    expect(await subjectsTo(email)).toEqual(['Confirm your e-mail address for Householdr']);

    // Signed out, the passkey signs in again.
    await page
      .getByRole('list', { name: 'Signed-in devices' })
      .getByRole('button', { name: 'Sign out' })
      .click();
    await expect(page).toHaveURL('/sign-in');
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page).toHaveURL(household);

    // The link is used up (ADR-0010 §1, clarification).
    await page.goto(link);
    await expect(page.getByText('This link has expired or was used already.')).toBeVisible();
  });

  test('says what needs changing before a passkey is made', async ({ page }) => {
    const authenticator = await withAuthenticator(page);
    await openSignUpLink(page);
    // The browser's own checks come first (UI-2); the server's are what a browser without them
    // sees.
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
    });
    await page.getByLabel('Your name').fill('Robin');
    await create(page).click();

    const summary = page.getByRole('region', { name: 'Creating the household didn’t work' });
    await expect(summary).toBeFocused();
    const problems = summary.getByRole('link');
    await expect(problems).toHaveText([
      'Enter the household’s name, up to 100 characters.',
      'Only someone 18 or older can create a household.',
      'Accept the terms to create a household.',
    ]);
    const name = page.getByLabel('Household name');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription(
      'Enter the household’s name, up to 100 characters.',
    );
    await expect(page.getByLabel('Your name')).not.toHaveAttribute('aria-invalid');
    await expect(page.getByLabel('Your name')).toHaveValue('Robin');
    await expectAccessible(page, 'fields refused');
    // No passkey was made for a form that couldn't be sent.
    expect(await authenticator.passkeys()).toEqual([]);

    // Each problem leads to its field.
    await problems.first().click();
    await expect(name).toBeFocused();

    // Another country brings its own time zones, its main one chosen.
    await page.getByLabel('Country').selectOption({ label: 'Spain' });
    await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Madrid');
    // By their cities and names, the main one first.
    await expect(page.getByLabel('Time zone').locator('option')).toHaveText([
      'Madrid (Central European Time)',
      'Ceuta (Central European Time)',
      'Canary (Western European Time)',
    ]);

    await fillIn(page);
    await create(page).click();
    await expect(page).toHaveURL(household);
    expect(await authenticator.passkeys()).toHaveLength(1);
  });
});

test('says so where the browser can’t make a passkey', async ({ page, context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
  // A browser without WebAuthn's JSON form.
  await page.addInitScript(() => {
    Reflect.deleteProperty(PublicKeyCredential, 'parseCreationOptionsFromJSON');
  });
  await openSignUpLink(page);
  await expect(
    page.getByText('Creating a household needs a passkey, which this browser can’t make.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(create(page)).toHaveCount(0);
  await expectAccessible(page, 'no passkeys');
});

test.describe('without JavaScript (PRIN-5)', () => {
  test.use({ javaScriptEnabled: false });

  test('says the household needs JavaScript and a passkey, with no button', async ({
    page,
    context,
    baseURL,
  }) => {
    await forceFlags(context, baseURL, flags);
    await openSignUpLink(page);
    await expect(page.getByRole('group', { name: 'Your household' })).toBeVisible();
    // What `<noscript>` holds shows, but Playwright's text and role locators skip it, so this one
    // is found by its element.
    const unsupported = page.locator('noscript p');
    await expect(unsupported).toBeVisible();
    await expect(unsupported).toHaveText(
      'Creating a household needs a passkey, which this browser can’t make. Open the link from the e-mail in an up-to-date browser, with JavaScript on.',
    );
    await expect(create(page)).toHaveCount(0);
  });
});
