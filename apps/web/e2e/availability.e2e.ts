import type { Page } from '@playwright/test';
import { calendarDay } from '../src/lib/intl';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// Who is away when: members plan their days away, heads plan them for profiles without an
// account, and everyone else sees only the dates (ADR-0005 §2, ADR-0018 §3–§4). Behind its
// release flag (CODE-20), in a household of onboarding's.

const flags = { 'sign-in': true, onboarding: true, availability: true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** The day `days` from today in the test household, which is in Brussels, as `YYYY-MM-DD`. */
const fromToday = (days: number) =>
  Temporal.Now.plainDateISO('Europe/Brussels').add({ days }).toString();

/** The days as the page writes them, in English. */
const shown = (first: string, last: string) =>
  new RegExp(`First day\\s*${calendarDay(first, 'en')}\\s*Last day\\s*${calendarDay(last, 'en')}`);

/** Opens the page of who is away from the household's page. */
async function openAvailability(page: Page, household: string) {
  await page.getByRole('link', { name: 'Who’s away' }).click();
  await expect(page).toHaveURL(`/households/${household}/availability`);
  await expect(page).toHaveTitle('Who’s away · Householdr');
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a member plans days away, sees them, and removes them', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await openAvailability(page, id);
      const you = page.getByRole('region', { name: 'Robin (you)' });
      await expect(you).toContainText('No days away planned.');
      if (javaScriptEnabled) await expectAccessible(page);

      const [first, last] = [fromToday(7), fromToday(9)];
      await you.getByLabel('First day').fill(first);
      await you.getByLabel('Last day').fill(last);
      await you.getByRole('button', { name: 'Add' }).click();
      await expect(you.getByRole('status')).toHaveText('The days away are added.');
      const days = you.getByRole('list', { name: 'Robin (you)' }).getByRole('listitem');
      await expect(days).toHaveText([shown(first, last)]);
      // Each day is machine-readable too (UI-1).
      await expect(days.locator('time').first()).toHaveAttribute('datetime', first);
      await expect(days.locator('time').last()).toHaveAttribute('datetime', last);
      await expect(you.getByLabel('First day')).toHaveValue('');
      await expect(you.getByLabel('Last day')).toHaveValue('');
      if (javaScriptEnabled) await expectAccessible(page, 'days added');

      await days.getByRole('button', { name: 'Remove' }).click();
      await expect(you.getByRole('status')).toHaveText('The days away are removed.');
      await expect(you).toContainText('No days away planned.');
      // The button left with the days, so the focus goes to whose days they were (UI-7).
      if (javaScriptEnabled) await expect(you.getByRole('heading')).toBeFocused();
    });

    test('a head marks the whole household away, and removes it', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await openAvailability(page, id);
      const household = page.getByRole('region', { name: 'The whole household' });
      await expect(household).toContainText('No time away together planned.');
      const [first, last] = [fromToday(30), fromToday(37)];
      await household.getByLabel('First day').fill(first);
      await household.getByLabel('Last day').fill(last);
      await household.getByRole('button', { name: 'Add' }).click();
      await expect(household.getByRole('status')).toHaveText('The days away are added.');
      const days = household
        .getByRole('list', { name: 'The whole household' })
        .getByRole('listitem');
      await expect(days).toHaveText([shown(first, last)]);
      // Robin's own days are another matter.
      await expect(page.getByRole('region', { name: 'Robin (you)' })).toContainText(
        'No days away planned.',
      );
      if (javaScriptEnabled) await expectAccessible(page, 'household away');

      await days.getByRole('button', { name: 'Remove' }).click();
      await expect(household.getByRole('status')).toHaveText('The days away are removed.');
      await expect(household).toContainText('No time away together planned.');
      if (javaScriptEnabled) await expect(household.getByRole('heading')).toBeFocused();
    });

    test('says when the days won’t do, and keeps them', async ({ page, accounts, account }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await openAvailability(page, id);
      const you = page.getByRole('region', { name: 'Robin (you)' });
      // A last day before the first gets past the browser's checks, not the server's (CODE-12).
      const [first, last] = [fromToday(9), fromToday(7)];
      await you.getByLabel('First day').fill(first);
      await you.getByLabel('Last day').fill(last);
      await you.getByRole('button', { name: 'Add' }).click();
      const summary = page.getByRole('region', { name: 'Adding the days away didn’t work' });
      await expect(summary).toBeFocused();
      const problem = 'Choose a last day on or after the first day, up to a year from now.';
      const link = summary.getByRole('link', { name: problem });
      await expect(link).toHaveAttribute('href', /^#last-day-/);
      const lastDay = you.getByLabel('Last day');
      await expect(lastDay).toHaveAttribute('aria-invalid', 'true');
      await expect(lastDay).toHaveAccessibleDescription(problem);
      await expect(you.getByLabel('First day')).not.toHaveAttribute('aria-invalid');
      await expect(you.getByLabel('First day')).toHaveValue(first);
      await expect(lastDay).toHaveValue(last);
      await expect(you).toContainText('No days away planned.');
      if (javaScriptEnabled) await expectAccessible(page, 'days refused');
    });

    test('a head plans for an adult without an account; another adult sees only the dates', async ({
      page,
      browser,
      accounts,
      account,
    }, testInfo) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      const alex = { email: `${testInfo.testId}-alex@example.org`, password: account.password };
      await accounts.add(alex);
      await accounts.addMember(id, alex.email, 'Alex');

      // The head adds Sam, who has no account, and plans Sam's days away (ADR-0018 §4).
      await signIn(page, account, `/households/${id}`);
      await page.getByLabel('Name').fill('Sam');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Sam is added.');
      await openAvailability(page, id);
      const regions = page.getByRole('region');
      await expect(regions.getByRole('heading', { level: 2 })).toHaveText([
        'The whole household',
        'Robin (you)',
        'Alex',
        'Sam',
      ]);
      // Never for another adult with an account.
      const plan = page.getByRole('group', { name: 'Plan days away' });
      await expect(page.getByRole('region', { name: 'Alex' }).getByRole('group')).toHaveCount(0);
      await expect(plan).toHaveCount(2);
      const sam = page.getByRole('region', { name: 'Sam' });
      const [first, last] = [fromToday(3), fromToday(5)];
      await sam.getByLabel('First day').fill(first);
      await sam.getByLabel('Last day').fill(last);
      await sam.getByRole('button', { name: 'Add' }).click();
      await expect(sam.getByRole('status')).toHaveText('The days away are added.');
      await expect(sam.getByRole('listitem')).toHaveText([shown(first, last)]);
      // And the whole household is away for a weekend (ADR-0005 §5).
      const household = page.getByRole('region', { name: 'The whole household' });
      const [together, back] = [fromToday(20), fromToday(22)];
      await household.getByLabel('First day').fill(together);
      await household.getByLabel('Last day').fill(back);
      await household.getByRole('button', { name: 'Add' }).click();
      await expect(household.getByRole('status')).toHaveText('The days away are added.');

      // Alex, on a device of their own, sees that Sam is away, and when: nothing more.
      const { viewport, colorScheme, deviceScaleFactor, isMobile, hasTouch, userAgent } =
        testInfo.project.use;
      const theirs = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        extraHTTPHeaders: ownNetwork(`${testInfo.testId}-alex`),
        javaScriptEnabled,
        viewport,
        colorScheme,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        userAgent,
      });
      try {
        await forceFlags(theirs, testInfo.project.use.baseURL, flags);
        const other = await theirs.newPage();
        await signIn(other, alex, `/households/${id}`);
        await openAvailability(other, id);
        const samForAlex = other.getByRole('region', { name: 'Sam' });
        await expect(samForAlex.getByRole('listitem')).toHaveText([shown(first, last)]);
        await expect(samForAlex.getByRole('button')).toHaveCount(0);
        await expect(samForAlex.getByRole('group')).toHaveCount(0);
        // The household's time away too, which only heads plan.
        const householdForAlex = other.getByRole('region', { name: 'The whole household' });
        await expect(householdForAlex.getByRole('listitem')).toHaveText([shown(together, back)]);
        await expect(householdForAlex.getByRole('button')).toHaveCount(0);
        await expect(householdForAlex.getByRole('group')).toHaveCount(0);
        await expect(other.getByRole('region', { name: 'Robin' }).getByRole('group')).toHaveCount(
          0,
        );
        await expect(
          other.getByRole('region', { name: 'Alex (you)' }).getByRole('group', {
            name: 'Plan days away',
          }),
        ).toBeVisible();
        if (javaScriptEnabled) await expectAccessible(other, 'another adult’s view');
      } finally {
        await theirs.close();
      }
    });
  });
}

test('is not found while its flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, availability: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Who’s away' })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/availability`))?.status()).toBe(404);
});
