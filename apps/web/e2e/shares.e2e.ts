import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Heads set members' shares (ADR-0001 §4), which only they and the member see (ADR-0018 §4), from
// the version they saw (ADR-0019 §5); once the household has started, the activity log shows whose
// changed (ADR-0018 §5). Behind its flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, shares: true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Adds Sam's profile on the household page, then opens the shares. */
const withSam = async (page: Page, id: string) => {
  await page.getByLabel('Name').fill('Sam');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('status')).toContainText('Sam');
  await page.getByRole('link', { name: 'Shares' }).click();
  await expect(page).toHaveURL(`/households/${id}/shares`);
  await expect(page).toHaveTitle('Shares · Householdr');
};

const items = (page: Page) =>
  page.getByRole('list', { name: 'Shares', exact: true }).locator(':scope > li');

/** The days from `first` to `last` days from today in Brussels, as the form takes and the page says them. */
const daysAhead = (first: number, last: number) => {
  const today = Temporal.Now.plainDateISO('Europe/Brussels');
  const from = today.add({ days: first });
  const to = today.add({ days: last });
  const utc = (day: Temporal.PlainDate) => day.toZonedDateTime('UTC').epochMilliseconds;
  const format = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' });
  return {
    firstDay: from.toString(),
    lastDay: to.toString(),
    said: format.formatRange(utc(from), utc(to)),
  };
};

/**
 * `text` as a pattern that takes any spaces where it has some: the page's Intl and the test's can
 * space a range of days differently, such as with a thin space around the dash.
 */
const loosely = (text: string, { whole = false } = {}) => {
  const pattern = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return new RegExp(whole ? `^${pattern}$` : pattern);
};

/** Sam's form for a temporary share, which every member has one of. */
const samsTemporary = (page: Page) =>
  page.locator('details', { hasText: 'Add a temporary share for Sam' });

/** Adds a temporary share for Sam through its form, opening it if it's closed. */
const addTemporary = async (
  page: Page,
  { firstDay, lastDay }: { firstDay: string; lastDay: string },
  percent: string,
) => {
  const form = samsTemporary(page);
  if (!(await form.getByLabel('First day').isVisible())) {
    await form.getByText('Add a temporary share for Sam').click();
  }
  await form.getByLabel('First day').fill(firstDay);
  await form.getByLabel('Last day').fill(lastDay);
  await form.getByLabel('Share on those days (%)').fill(percent);
  await form.getByRole('button', { name: 'Add Sam’s temporary share' }).click();
};

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head sets a share, and puts it back to the default', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      await expect(items(page)).toHaveText([
        /Robin \(you\).*Head.*100% this week, the default/,
        /Sam.*Adult.*100% this week, the default/,
      ]);
      if (javaScriptEnabled) await expectAccessible(page);

      await page.getByLabel('Share for Sam (%)').fill('50');
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      await expect(page.getByRole('status')).toHaveText('Sam’s share is saved.');
      await expect(items(page).nth(1)).toContainText('50% this week, set by a head');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('50');

      await page.getByRole('button', { name: 'Use the default for Sam' }).click();
      await expect(page.getByRole('status')).toHaveText('Sam’s share is saved.');
      await expect(items(page).nth(1)).toContainText('100% this week, the default');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Use the default for Sam' })).toHaveCount(0);
    });

    test('a share that isn’t a whole percent up to 100 is kept, with why', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      // What the browser would refuse, for the server to answer (PRIN-5).
      const field = page.getByLabel('Share for Sam (%)');
      await page
        .locator('form')
        .filter({ has: field })
        .evaluate((form) => {
          if (form instanceof HTMLFormElement) form.noValidate = true;
        });
      await page.getByLabel('Share for Sam (%)').fill('150');
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      const summary = page.getByRole('region', { name: 'Saving didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText(['Enter a whole number from 0 to 100.']);
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('150');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveAttribute('aria-invalid', 'true');
      if (javaScriptEnabled) await expectAccessible(page, 'invalid');
      await summary.getByRole('link').click();
      await expect(page.getByLabel('Share for Sam (%)')).toBeFocused();
    });

    test('a share changed since keeps what was entered, with the share now', async ({
      page,
      context,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      // The same head in another tab saves first.
      const other = await context.newPage();
      await other.goto(`/households/${id}/shares`);
      await other.getByLabel('Share for Sam (%)').fill('50');
      await other.getByRole('button', { name: 'Save Sam’s share' }).click();
      await expect(other.getByRole('status')).toHaveText('Sam’s share is saved.');

      await page.getByLabel('Share for Sam (%)').fill('70');
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      const summary = page.getByRole('region', { name: 'Saving didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('Their share is 50% this week.');
      await expect(items(page).nth(1)).toContainText('50% this week, set by a head');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('70');
      if (javaScriptEnabled) await expectAccessible(page, 'conflict');
      // Saved again, theirs is kept.
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      await expect(page.getByRole('status')).toHaveText('Sam’s share is saved.');
      await expect(items(page).nth(1)).toContainText('70% this week, set by a head');
    });

    test('a head plans a temporary share, and removes it', async ({ page, accounts, account }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      const nextWeek = daysAhead(7, 13);
      await addTemporary(page, nextWeek, '50');
      await expect(page.getByRole('status')).toHaveText('Sam’s temporary share is added.');
      const planned = page.getByRole('list', { name: 'Temporary shares for Sam' });
      await expect(planned.getByRole('listitem')).toHaveText([loosely(`50% for ${nextWeek.said}`)]);
      if (javaScriptEnabled) await expectAccessible(page, 'temporary');

      await page
        .getByRole('button', { name: loosely(`Remove Sam’s 50% for ${nextWeek.said}`) })
        .click();
      await expect(page.getByRole('status')).toHaveText('Sam’s temporary share is removed.');
      await expect(planned).toHaveCount(0);
    });

    test('a temporary share that isn’t valid, or overlaps another, is kept, with why', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      const backwards = { firstDay: daysAhead(9, 9).firstDay, lastDay: daysAhead(7, 7).lastDay };
      const form = samsTemporary(page);
      await form.getByText('Add a temporary share for Sam').click();
      await form.locator('form').evaluate((element) => {
        if (element instanceof HTMLFormElement) element.noValidate = true;
      });
      await addTemporary(page, backwards, '50');
      const summary = page.getByRole('region', { name: 'Saving didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText([/^Choose a day from the first day to /]);
      await expect(form.getByLabel('First day')).toHaveValue(backwards.firstDay);
      await expect(form.getByLabel('Last day')).toHaveValue(backwards.lastDay);
      await expect(form.getByLabel('Last day')).toHaveAttribute('aria-invalid', 'true');
      if (javaScriptEnabled) await expectAccessible(page, 'temporary-invalid');

      const nextWeek = daysAhead(7, 13);
      await addTemporary(page, nextWeek, '50');
      await expect(page.getByRole('status')).toHaveText('Sam’s temporary share is added.');
      await addTemporary(page, daysAhead(13, 15), '20');
      await expect(summary).toBeFocused();
      await expect(summary).toContainText(
        loosely(`Sam already has a temporary share of 50% for ${nextWeek.said}`),
      );
      await expect(summary.getByRole('link')).toHaveText([
        loosely(`Choose days outside ${nextWeek.said}.`, { whole: true }),
      ]);
      await expect(form.getByLabel('Share on those days (%)')).toHaveValue('20');
    });
  });
}

test('after the start, the activity log says whose share a head changed, never to what', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  // Starting takes the plans' flag, and the log its own (ADR-0007 §2, ADR-0018 §5).
  await forceFlags(context, baseURL, { ...flags, plans: true, 'activity-log': true });
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await accounts.addProfile(id, 'Sam');
  await signIn(page, account, `/households/${id}`);
  const ready = page.getByRole('region', { name: 'Ready to start?' });
  await ready.getByRole('link', { name: 'Start the household' }).click();
  await page.getByRole('radio', { name: /^Start on / }).check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(`/households/${id}?started`);

  await page.getByRole('link', { name: 'Shares' }).click();
  await page.getByLabel('Share for Sam (%)').fill('50');
  await page.getByRole('button', { name: 'Save Sam’s share' }).click();
  await expect(page.getByRole('status')).toHaveText('Sam’s share is saved.');

  await page.goto(`/households/${id}`);
  await page.getByRole('link', { name: 'Activity' }).click();
  const entries = page.getByRole('list', { name: 'Activity' }).getByRole('listitem');
  await expect(entries).toHaveText([
    /^\s*Robin changed Sam’s share\./,
    /^\s*Robin started the household\./,
  ]);
  // Only heads and Sam see the share itself (ADR-0018 §4).
  await expect(entries.first()).not.toContainText(/%|\b50\b/);
  await expectAccessible(page, 'share changed');
});

test('without head powers, a member sees only their own share', async ({
  page,
  accounts,
  account,
}) => {
  // A head without a second factor has no head powers yet (ADR-0010 §3).
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.getByRole('link', { name: 'Shares' }).click();
  await expect(items(page)).toHaveText([/Robin \(you\).*100% this week, the default/]);
  await expect(page.getByText('Only you and the household’s heads see your share.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expectAccessible(page);
});

test('the page isn’t there while its flag is off', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, shares: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Shares' })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/shares`))?.status()).toBe(404);
});
