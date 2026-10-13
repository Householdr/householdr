import { weekDay } from '../src/lib/intl';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// "I can't today": a member says it with one tap, to the end of today or a later day of the
// week, and "I can after all"; everyone else sees only until which day (ADR-0005 §3, ADR-0018 §3).
// Behind its release flag (CODE-20), on the page of who is away.

const flags = { 'sign-in': true, onboarding: true, availability: true, unavailability: true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Today in the test household, which is in Brussels, as `YYYY-MM-DD`. */
const today = () => Temporal.Now.plainDateISO('Europe/Brussels');

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a member can’t today, then can after all', async ({ page, accounts, account }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/availability`);
      const you = page.getByRole('region', { name: 'Robin (you)' });
      const form = you.getByRole('group', { name: 'Can’t today?' });
      // Today is chosen to begin with, so it is one tap (ADR-0005, Consequences).
      await expect(form.getByLabel('Until the end of')).toHaveValue(today().toString());
      if (javaScriptEnabled) await expectAccessible(page);

      await you.getByRole('button', { name: 'I can’t' }).click();
      await expect(you.getByRole('status')).toHaveText(
        'Noted. Others see until which day, never why.',
      );
      await expect(you).toContainText('Can’t today.');
      if (javaScriptEnabled) await expectAccessible(page, 'can’t today');

      await you.getByRole('button', { name: 'I can after all' }).click();
      await expect(you.getByRole('status')).toHaveText('Noted: can after all.');
      await expect(you).not.toContainText('Can’t today.');
      await expect(you.getByRole('button', { name: 'I can after all' })).toHaveCount(0);
      // The button left, so the focus goes to the day's field (UI-7).
      if (javaScriptEnabled) await expect(form.getByLabel('Until the end of')).toBeFocused();
    });

    test('a member can’t until a later day of the week', async ({ page, accounts, account }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/availability`);
      const you = page.getByRole('region', { name: 'Robin (you)' });
      const field = you.getByLabel('Until the end of');
      const days = await field
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      // From today to the last day of the plan week, whose start the household chose.
      expect(days[0]).toBe(today().toString());
      const last = days.at(-1) ?? '';
      await field.selectOption(last);
      await you.getByRole('button', { name: 'I can’t' }).click();
      await expect(you.getByRole('status')).toHaveText(
        'Noted. Others see until which day, never why.',
      );
      await expect(you).toContainText(
        days.length === 1 ? 'Can’t today.' : `Can’t until the end of ${weekDay(last, 'en-BE')}.`,
      );
    });
  });
}

test('another adult sees until which day, and can’t change it', async ({
  page,
  accounts,
  account,
  browser,
}, testInfo) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  const alex = { email: `${testInfo.testId}-alex@example.org`, password: account.password };
  await accounts.add(alex);
  await accounts.addMember(alex.email, id, 'Alex');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/availability`);
  await page
    .getByRole('region', { name: 'Robin (you)' })
    .getByRole('button', { name: 'I can’t' })
    .click();
  await expect(page.getByRole('region', { name: 'Robin (you)' })).toContainText('Can’t today.');
  // Never for another adult (ADR-0018 §4).
  await expect(page.getByRole('region', { name: 'Alex' }).getByRole('button')).toHaveCount(0);

  const theirs = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: ownNetwork(`${testInfo.testId}-alex`),
  });
  try {
    await forceFlags(theirs, testInfo.project.use.baseURL, flags);
    const other = await theirs.newPage();
    await signIn(other, alex, `/households/${id}`);
    await other.goto(`/households/${id}/availability`);
    const robin = other.getByRole('region', { name: 'Robin' });
    await expect(robin).toContainText('Can’t today.');
    await expect(robin.getByRole('button')).toHaveCount(0);
    await expect(
      other
        .getByRole('region', { name: 'Alex (you)' })
        .getByRole('group', { name: 'Can’t today?' }),
    ).toBeVisible();
    await expectAccessible(other, 'another adult’s view');
  } finally {
    await theirs.close();
  }
});

test('is not there while its flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, unavailability: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/availability`);
  await expect(page.getByRole('region', { name: 'Robin (you)' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Can’t today?' })).toHaveCount(0);
});
