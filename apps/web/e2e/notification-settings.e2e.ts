import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// The account's own notification settings (ADR-0014 §3, clarifications): a channel for each
// category, the locked security row, quiet hours and the e-mail fallback, saved from the version
// the form was loaded with (ADR-0019 §5). Behind its release flag (CODE-20).

const flags = {
  'sign-in': true,
  onboarding: true,
  notifications: true,
  'notification-preferences': true,
};

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** The same person's other device, as the test's project sets devices up. */
const otherDevice = async (browser: Browser, testInfo: TestInfo, javaScriptEnabled: boolean) => {
  const { viewport, colorScheme, deviceScaleFactor, isMobile, hasTouch, userAgent, baseURL } =
    testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: ownNetwork(`${testInfo.testId}-other`),
    javaScriptEnabled,
    viewport,
    colorScheme,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    userAgent,
  });
  await forceFlags(context, baseURL, flags);
  return context;
};

const published = (page: Page) => page.getByLabel('Your week’s plan is published');
const drafted = (page: Page) => page.getByLabel('A draft plan is ready to check');
const fallback = (page: Page) =>
  page.getByRole('checkbox', { name: 'When push can’t reach me, send it by e-mail instead' });

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a member chooses how they get each kind, their quiet hours and the fallback', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.getByRole('link', { name: 'Notification settings' }).click();
      await expect(page).toHaveURL('/notification-settings');
      await expect(page).toHaveTitle('Notification settings · Householdr');

      // The catalogue's defaults (ADR-0014 §2–§5), and who gets each kind.
      await expect(published(page)).toHaveValue('push');
      await expect(page.getByText('For everyone with tasks in it.')).toBeVisible();
      await expect(drafted(page)).toHaveValue('push');
      await expect(
        page.getByText('For heads. You can choose it before you are one.'),
      ).toBeVisible();
      await expect(page.getByLabel('From')).toHaveValue('21:30');
      await expect(page.getByLabel('Until')).toHaveValue('07:30');
      await expect(fallback(page)).toBeChecked();
      // Security messages can't be turned off, and the page says why (ADR-0014 §3).
      await expect(page.getByRole('main')).toContainText('Always by e-mail');
      if (javaScriptEnabled) await expectAccessible(page, 'the defaults');

      await published(page).selectOption({ label: 'E-mail' });
      await drafted(page).selectOption({ label: 'Only in the app' });
      await page.getByLabel('From').fill('22:00');
      await page.getByLabel('Until').fill('06:30');
      await fallback(page).uncheck();
      await page.getByRole('button', { name: 'Save the settings' }).click();
      await expect(page.getByRole('status').first()).toHaveText('The settings are saved.');

      await page.reload();
      await expect(published(page)).toHaveValue('email');
      await expect(drafted(page)).toHaveValue('app');
      await expect(page.getByLabel('From')).toHaveValue('22:00');
      await expect(page.getByLabel('Until')).toHaveValue('06:30');
      await expect(fallback(page)).not.toBeChecked();
    });

    test('quiet hours that end when they start are refused, and the choices kept', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto('/notification-settings');
      await published(page).selectOption({ label: 'Push and e-mail' });
      await page.getByLabel('Until').fill('21:30');
      await page.getByRole('button', { name: 'Save the settings' }).click();

      const summary = page.getByRole('region', { name: 'Saving didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText(
        'Enter a time other than the start, such as 07:30.',
      );
      await expect(page.getByLabel('Until')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByLabel('Until')).toHaveValue('21:30');
      await expect(published(page)).toHaveValue('push-and-email');
      if (javaScriptEnabled) await expectAccessible(page, 'quiet hours refused');
    });

    test('a save from another device since is never overwritten (ADR-0019 §5, TEST-10)', async ({
      page,
      browser,
      accounts,
      account,
    }, testInfo) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto('/notification-settings');

      const device = await otherDevice(browser, testInfo, javaScriptEnabled);
      try {
        const other = await device.newPage();
        await signIn(other, account, `/households/${id}`);
        await other.goto('/notification-settings');
        await drafted(other).selectOption({ label: 'E-mail' });
        await other.getByRole('button', { name: 'Save the settings' }).click();
        await expect(other.getByRole('status').first()).toHaveText('The settings are saved.');
      } finally {
        await device.close();
      }

      await drafted(page).selectOption({ label: 'Only in the app' });
      await page.getByRole('button', { name: 'Save the settings' }).click();
      await expect(page.getByRole('region', { name: 'Saving didn’t work' })).toBeFocused();
      const now = page.getByRole('region', { name: 'The settings now' });
      await expect(now).toContainText('E-mail');
      await expect(drafted(page)).toHaveValue('app');
      if (javaScriptEnabled) await expectAccessible(page, 'a conflict');
      // Saving again keeps this device's choice.
      await page.getByRole('button', { name: 'Save the settings' }).click();
      await expect(page.getByRole('status').first()).toHaveText('The settings are saved.');
      await page.reload();
      await expect(drafted(page)).toHaveValue('app');
    });
  });
}

test('the settings aren’t there while their flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, 'notification-preferences': false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Notification settings' })).toHaveCount(0);
  await page.goto(`/households/${id}/notifications`);
  await expect(page.getByRole('link', { name: 'Choose how you get notifications' })).toHaveCount(0);
  expect((await page.goto('/notification-settings'))?.status()).toBe(404);
});

test('the list of notifications leads to the settings', async ({ page, accounts, account }) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/notifications`);
  await page.getByRole('link', { name: 'Choose how you get notifications' }).click();
  await expect(page).toHaveURL('/notification-settings');
});
