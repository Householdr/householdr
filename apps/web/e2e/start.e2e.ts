import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// Start, the last step of setting up a household (ADR-0007 §2 step 7, §3): a head starts now and
// publishes this week's draft for the days left, or starts on the week start day and is told when
// the first plan comes; the activity log shows who started it, with what was set for others
// before, never a value (ADR-0018 §5). Behind the plans' release flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, plans: true, 'activity-log': true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Another person's device, as the test's project sets devices up, from a network of its own. */
const deviceOf = async (browser: Browser, testInfo: TestInfo, who: string) => {
  const { viewport, colorScheme, deviceScaleFactor, isMobile, hasTouch, userAgent, baseURL } =
    testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: ownNetwork(`${testInfo.testId}-${who}`),
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

/** Opens the Start page from the household's page, where a head in setup is led to it. */
const openStart = async (page: Page, id: string) => {
  const ready = page.getByRole('region', { name: 'Ready to start?' });
  await ready.getByRole('link', { name: 'Start the household' }).click();
  await expect(page).toHaveURL(`/households/${id}/start`);
  await expect(page).toHaveTitle('Start · Householdr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start your household');
};

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head starts now, then publishes this week’s draft for the days left', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await accounts.addTask(id, { name: 'Dishes', duration: 20, frequency: 'daily' });
      await signIn(page, account, `/households/${id}`);
      if (javaScriptEnabled) await expectAccessible(page, 'household in setup');
      await openStart(page, id);

      // Start now is chosen unless the head picks otherwise (ADR-0007 §2).
      const choices = page.getByRole('group', { name: 'When do you want to start?' });
      await expect(choices.getByRole('radio', { name: 'Start now' })).toBeChecked();
      await expect(choices.getByRole('radio', { name: /^Start on / })).not.toBeChecked();
      await expect(choices.getByRole('radio', { name: 'Start now' })).toHaveAccessibleDescription(
        /^This week is planned right away, from today to /,
      );
      if (javaScriptEnabled) await expectAccessible(page, 'start');
      await page.getByRole('button', { name: 'Start', exact: true }).click();

      // This week's draft, for the days left: dishes every day from today, in Brussels.
      await expect(page).toHaveURL(`/households/${id}/plan`);
      const week = page.getByRole('region', { name: /^This week: / });
      await expect(
        week.getByText('This is a draft. Only heads see it until one of them publishes it.'),
      ).toBeVisible();
      const today = Temporal.Now.plainDateISO('Europe/Brussels');
      await expect(week.getByRole('listitem')).toHaveCount(8 - today.dayOfWeek);
      if (javaScriptEnabled) await expectAccessible(page, 'this week’s draft');
      await week.getByRole('button', { name: 'Publish now' }).click();
      await expect(week.getByRole('status')).toHaveText(
        'The plan is published: everyone in the household sees it now.',
      );
      await expect(week.getByText(/^This is a draft/)).toHaveCount(0);

      // Once started, Start is gone, and the activity log says who started it.
      await page.getByRole('link', { name: 'Back to Ash Lane' }).click();
      await expect(page.getByRole('region', { name: 'Ready to start?' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Start the household' })).toHaveCount(0);
      await page.getByRole('link', { name: 'Activity' }).click();
      await expect(page.getByRole('listitem')).toHaveText([/^\s*Robin started the household\./]);
      expect((await page.goto(`/households/${id}/start`))?.status()).toBe(200);
      await expect(page.getByText('Your household has started.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
    });

    test('a head starts on the week start day, and is told when the first plan comes', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await openStart(page, id);
      const weekStart = page.getByRole('radio', { name: /^Start on / });
      await expect(weekStart).toHaveAccessibleDescription(
        /^The first plan is for the full week from that day\. You can check its draft from .+; everyone sees it from .+\.$/,
      );
      await weekStart.check();
      await page.getByRole('button', { name: 'Start', exact: true }).click();

      await expect(page).toHaveURL(`/households/${id}?started`);
      await expect(page.getByRole('status')).toHaveText(
        /^Your household has started\. Its first plan is for the week from Monday\b.+: you can check its draft from .+, and everyone sees it from .+\.$/,
      );
      await expect(page.getByRole('link', { name: 'Start the household' })).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page, 'started on the week start day');
    });

    test('a second start is refused, and the summary of why takes the focus', async ({
      page,
      context,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await openStart(page, id);
      // Started meanwhile, from another tab.
      const other = await context.newPage();
      await other.goto(`/households/${id}/start`);
      await other.getByRole('radio', { name: /^Start on / }).check();
      await other.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(other).toHaveURL(`/households/${id}?started`);
      await other.close();

      await page.getByRole('button', { name: 'Start', exact: true }).click();
      const summary = page.getByRole('region', { name: 'Starting didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary).toContainText(
        'Someone else started the household just now, so nothing changed.',
      );
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page, 'start refused');
    });
  });
}

test('the activity log lists what was set before the start, the head’s own share too, never a value', async ({
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
  await accounts.setShare(id, alex.email, 60);
  // The starting head's own share is listed too (ADR-0018 §4, clarification).
  await accounts.setShare(id, account.email, 80);
  const today = Temporal.Now.plainDateISO('Europe/Brussels');
  const away = [today.add({ weeks: 2 }).toString(), today.add({ weeks: 2, days: 2 }).toString()];
  await accounts.addProfile(id, 'Sam', { away: [away[0] ?? '', away[1] ?? ''] });
  await accounts.addProfile(id, 'Kim', { share: 50 });
  await signIn(page, account, `/households/${id}`);
  await openStart(page, id);
  await page.getByRole('radio', { name: /^Start on / }).check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(`/households/${id}?started`);

  // Every member sees it, by name, and no share or day (ADR-0018 §5).
  const theirs = await deviceOf(browser, testInfo, 'alex');
  try {
    const other = await theirs.newPage();
    await signIn(other, alex, `/households/${id}`);
    await other.getByRole('link', { name: 'Activity' }).click();
    const entry = other.getByRole('listitem');
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('Robin started the household.');
    // The list is the reader's language's, with or without a comma before "and".
    await expect(entry).toContainText(
      /Set before the start: shares for Alex, Kim,? and Robin; days away for Sam\./,
    );
    await expect(entry).not.toContainText(/%|\b60\b|\b50\b|\b80\b/);
    await expectAccessible(other, 'start entry');
  } finally {
    await theirs.close();
  }
});

test('only heads are led to Start, and its page is forbidden to anyone else', async ({
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
  await signIn(page, alex, `/households/${id}`);
  await expect(page.getByRole('region', { name: 'Ready to start?' })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/start`))?.status()).toBe(403);
  // A head without a second factor isn't led there either (ADR-0010 §3).
  const noSecondFactor = {
    email: `${testInfo.testId}-sam@example.org`,
    password: account.password,
  };
  await accounts.add(noSecondFactor);
  const theirs = await accounts.addHousehold(noSecondFactor.email, 'Birch Court');
  const context = await deviceOf(browser, testInfo, 'sam');
  try {
    const other = await context.newPage();
    await signIn(other, noSecondFactor, `/households/${theirs}`);
    await expect(other.getByRole('region', { name: 'Ready to start?' })).toHaveCount(0);
    expect((await other.goto(`/households/${theirs}/start`))?.status()).toBe(403);
  } finally {
    await context.close();
  }
});

test('Start isn’t there while the plans’ flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, plans: false });
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Start the household' })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/start`))?.status()).toBe(404);
});
