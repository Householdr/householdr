import { expect, expectAccessible, forceFlags, otherDevice, signIn, test } from './fixtures';

// The security page's signed-in devices (ADR-0010 §6, ADR-0018 §2), behind sign-in's flag
// (CODE-20).

const flags = { 'sign-in': true };
const firefoxOnLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const safariOnIphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

test('without a session, the page sends to the sign-in page (ADR-0017 §2)', async ({ page }) => {
  await page.goto('/security');
  await expect(page).toHaveURL('/sign-in');
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('lists this device and another, and signs the other out', async ({
      page,
      browser,
      baseURL,
      account,
    }) => {
      const laptop = await otherDevice(browser, baseURL, firefoxOnLinux, flags);
      const elsewhere = await laptop.newPage();
      await signIn(elsewhere, account);
      await signIn(page, account);

      const devices = page.getByRole('list', { name: 'Signed-in devices' });
      await expect(devices.getByRole('listitem').first()).toContainText('This device');
      const other = devices.getByRole('listitem').filter({ hasText: 'Firefox on Linux' });
      await expect(other).toContainText('Used in the last 24 hours');
      if (javaScriptEnabled) await expectAccessible(page);

      await other.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('status')).toHaveText('That device is signed out.');
      await expect(other).toHaveCount(0);
      if (javaScriptEnabled) {
        await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toBeFocused();
      }

      // The other device is signed out the next time it asks for a page.
      await elsewhere.goto('/security');
      await expect(elsewhere).toHaveURL('/sign-in');
      await laptop.close();
    });

    test('signs this device out', async ({ page, account }) => {
      await signIn(page, account);
      await page
        .getByRole('listitem')
        .filter({ hasText: 'This device' })
        .getByRole('button', { name: 'Sign out' })
        .click();
      await expect(page).toHaveURL('/sign-in');
      await page.goto('/security');
      await expect(page).toHaveURL('/sign-in');
    });
  });
}

test('signs every other device out at once', async ({ page, browser, baseURL, account }) => {
  const laptop = await otherDevice(browser, baseURL, firefoxOnLinux, flags);
  const phone = await otherDevice(browser, baseURL, safariOnIphone, flags);
  const others = [await laptop.newPage(), await phone.newPage()];
  for (const other of others) await signIn(other, account);
  await signIn(page, account);
  await expect(page.getByRole('listitem')).toHaveCount(3);

  await page.getByRole('button', { name: 'Sign out all other devices' }).click();
  await expect(page.getByRole('status')).toHaveText('All other devices are signed out.');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Sign out all other devices' })).toHaveCount(0);
  for (const other of others) {
    await other.goto('/security');
    await expect(other).toHaveURL('/sign-in');
  }
  await laptop.close();
  await phone.close();
});
