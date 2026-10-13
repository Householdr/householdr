import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Push on a device, from the notification settings page (ADR-0014 §7, clarification): turned on
// with the browser's permission, saved with the account and this device's session, and turned off
// again. Behind the settings page's release flag (CODE-20). A headless browser has no push service
// to subscribe with and asks nobody for permission, so the tests stand in for both: a person who
// allows notifications, and a PushManager that hands out a subscription of the test's own. The
// rest is real: our service worker's registration, and what the server keeps.

const flags = { 'sign-in': true, onboarding: true, 'notification-preferences': true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/**
 * Stands in for a person allowing notifications when asked, and for the browser's push service,
 * with a subscription whose endpoint is `endpoint`.
 */
const withPushService = (page: Page, endpoint: string) =>
  page.addInitScript((address) => {
    const allowed = 'e2e-notifications-allowed';
    Object.defineProperty(Notification, 'permission', {
      get: () => (localStorage.getItem(allowed) ? 'granted' : 'default'),
    });
    Notification.requestPermission = () => {
      localStorage.setItem(allowed, 'yes');
      return Promise.resolve('granted');
    };
    const held = 'e2e-push-subscription';
    const subscription = () => ({
      endpoint: address,
      expirationTime: null,
      toJSON: () => ({
        endpoint: address,
        expirationTime: null,
        keys: {
          p256dh:
            'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
          auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        },
      }),
      unsubscribe: () => {
        localStorage.removeItem(held);
        return Promise.resolve(true);
      },
    });
    PushManager.prototype.subscribe = function () {
      localStorage.setItem(held, 'yes');
      return Promise.resolve(subscription() as unknown as PushSubscription);
    };
    PushManager.prototype.getSubscription = function () {
      const found = localStorage.getItem(held) ? subscription() : null;
      return Promise.resolve(found as unknown as PushSubscription | null);
    };
  }, endpoint);

const section = (page: Page) => page.getByRole('region', { name: 'Push on this device' });

test('a member turns push on for this device, and off again', async ({
  page,
  accounts,
  account,
  baseURL,
}, testInfo) => {
  await withPushService(page, `https://fcm.googleapis.com/fcm/send/${testInfo.testId}`);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto('/notification-settings');

  const push = section(page);
  await expect(push.getByRole('status')).toHaveText('Push is off for this device.');
  await expectAccessible(page, 'push off');
  await push.getByRole('button', { name: 'Turn on push for this device' }).click();
  await expect(push.getByRole('status')).toHaveText('Push is on for this device.');
  // Our own service worker, and nothing else, now runs for the site.
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL,
      ),
    )
    .toBe(new URL('/service-worker.js', baseURL).href);

  // The server holds it for this device: it is still on after a reload.
  await page.reload();
  await expect(section(page).getByRole('status')).toHaveText('Push is on for this device.');
  await expectAccessible(page, 'push on');

  await section(page).getByRole('button', { name: 'Turn off push for this device' }).click();
  await expect(section(page).getByRole('status')).toHaveText('Push is off for this device.');
  await page.reload();
  await expect(section(page).getByRole('status')).toHaveText('Push is off for this device.');
});

test('push on this device is off for another account signed in on it later', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  await withPushService(page, `https://fcm.googleapis.com/fcm/send/${testInfo.testId}`);
  const own = await accounts.addHousehold(account.email, 'Ash Lane');
  const other = { email: `${testInfo.testId}-sam@example.org`, password: account.password };
  await accounts.add(other);
  const theirs = await accounts.addHousehold(other.email, 'Cedar Row');

  await signIn(page, account, `/households/${own}`);
  await page.goto('/notification-settings');
  await section(page).getByRole('button', { name: 'Turn on push for this device' }).click();
  await expect(section(page).getByRole('status')).toHaveText('Push is on for this device.');
  // Signing out ends the session, and push with it (ADR-0018 §2).
  await page.goto('/security');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();

  await signIn(page, other, `/households/${theirs}`);
  await page.goto('/notification-settings');
  await expect(section(page).getByRole('status')).toHaveText('Push is off for this device.');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the page says turning push on needs it', async ({ page, accounts, account }) => {
    const id = await accounts.addHousehold(account.email, 'Ash Lane');
    await signIn(page, account, `/households/${id}`);
    await page.goto('/notification-settings');
    await expect(section(page)).toContainText('Turning push on needs JavaScript in this browser.');
    await expect(section(page).getByRole('button')).toHaveCount(0);
  });
});
