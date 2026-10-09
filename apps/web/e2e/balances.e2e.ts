import type { Browser, TestInfo } from '@playwright/test';
import type { TestAccount } from '@householdr/auth/testing';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// Every member's balance and what each settled week changed it by, which every member sees
// (ADR-0002 §6), once a week is over and settled (§1, §7). Behind its release flag (CODE-20). The
// test helper plans last week, has the members it names do their tasks, and settles it.

const flags = { 'sign-in': true, onboarding: true, balances: true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Another person's device, as the test's project sets devices up, from a network of its own. */
const deviceOf = async (
  browser: Browser,
  testInfo: TestInfo,
  who: string,
  javaScriptEnabled: boolean,
) => {
  const { viewport, colorScheme, deviceScaleFactor, isMobile, hasTouch, userAgent, baseURL } =
    testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: ownNetwork(`${testInfo.testId}-${who}`),
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

/**
 * Ash Lane, whose head Robin is the test's account, with Alex, an adult with an account. Last
 * week's plan had dishes every day and the bins once, 20 minutes each, half for each of them:
 * Robin did all of his and Alex none, so it settled Robin at 0 and Alex at −80 points.
 */
const household = async (
  accounts: Parameters<Parameters<typeof test>[2]>[0]['accounts'],
  account: TestAccount,
  testInfo: TestInfo,
) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  const alex = { email: `${testInfo.testId}-alex@example.org`, password: account.password };
  await accounts.add(alex);
  await accounts.addMember(id, alex.email, 'Alex');
  const week = await accounts.settleLastWeek(id, {
    tasks: [
      { name: 'Dishes', duration: 20, frequency: 'daily' },
      { name: 'Bins', duration: 20, frequency: 'weekly' },
    ],
    doneBy: [account.email],
  });
  return { id, alex, week };
};

/** The days of the week starting on `start`, as the page writes them in English. */
const daysOf = (start: string) => {
  const first = Temporal.PlainDate.from(start);
  const utc = (day: Temporal.PlainDate) => Date.UTC(day.year, day.month - 1, day.day);
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).formatRange(
    utc(first),
    utc(first.add({ days: 6 })),
  );
};

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('every member sees every balance and its history once a week is settled', async ({
      page,
      browser,
      accounts,
      account,
    }, testInfo) => {
      const { id, alex, week } = await household(accounts, account, testInfo);
      await signIn(page, account, `/households/${id}`);
      await page.getByRole('link', { name: 'Balances', exact: true }).click();
      await expect(page).toHaveURL(`/households/${id}/balances`);
      await expect(page.getByRole('heading', { level: 1, name: 'Balances' })).toBeVisible();
      const main = page.getByRole('main');
      await expect(main).toContainText('Positive means ahead of their fair portion');
      await expect(main).toContainText(
        'This household evens them out at a normal pace: over about a month.',
      );

      const robin = page.getByRole('region', { name: 'Robin (you)' });
      await expect(robin.getByRole('paragraph').first()).toHaveText('0 points');
      const theirs = page.getByRole('region', { name: 'Alex', exact: true });
      await expect(theirs.getByRole('paragraph').first()).toHaveText('-80 points');
      // What the week changed it by, and nothing else: no share, no task, no points owed.
      const history = theirs.getByRole('table', { name: 'Week by week' });
      await expect(history.getByRole('columnheader')).toHaveText(['Week', 'Change']);
      await expect(history.getByRole('row')).toHaveCount(2);
      await expect(history.getByRole('row').nth(1).getByRole('cell')).toHaveText([
        daysOf(week),
        '-80 points',
      ]);
      await expect(robin.getByRole('row').nth(1).getByRole('cell')).toHaveText([
        daysOf(week),
        '0 points',
      ]);
      if (javaScriptEnabled) await expectAccessible(page, 'balances, as a head sees them');

      // Alex sees the same, with "you" for himself (ADR-0012 §3).
      const device = await deviceOf(browser, testInfo, 'alex', javaScriptEnabled);
      try {
        const other = await device.newPage();
        await signIn(other, alex, `/households/${id}`);
        await other.goto(`/households/${id}/balances`);
        const own = other.getByRole('region', { name: 'Alex (you)' });
        await expect(own.getByRole('paragraph').first()).toHaveText('-80 points');
        await expect(
          other.getByRole('region', { name: 'Robin', exact: true }).getByRole('paragraph').first(),
        ).toHaveText('0 points');
        if (javaScriptEnabled)
          await expectAccessible(other, 'balances, as another member sees them');
      } finally {
        await device.close();
      }
    });
  });
}

test('a household with no week settled yet shows 0 for everyone, and says why', async ({
  page,
  accounts,
  account,
}) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/balances`);
  const robin = page.getByRole('region', { name: 'Robin (you)' });
  await expect(robin.getByRole('paragraph').first()).toHaveText('0 points');
  await expect(robin).toContainText('Nothing yet: a week counts once it’s over.');
  await expect(robin.getByRole('table')).toHaveCount(0);
  await expectAccessible(page, 'no week settled yet');
});

test('the balances aren’t there while their flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, balances: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Balances', exact: true })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/balances`))?.status()).toBe(404);
});

test('a household’s balances are not found for anyone outside it', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const other = { email: `${testInfo.testId}-other@example.org`, password: account.password };
  await accounts.add(other);
  const theirs = await accounts.addHousehold(other.email, 'Cedar Row');
  await signIn(page, account, '/');
  expect((await page.goto(`/households/${theirs}/balances`))?.status()).toBe(404);
});
