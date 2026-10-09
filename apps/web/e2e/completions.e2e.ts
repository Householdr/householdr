import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// Marking the tasks of this week's published plan done, and undoing it (ADR-0006 §4): one tap for
// one's own, a choice of who did it for anything else, the day for others and the time for those
// it credits only (ADR-0018 §3), and the activity log's "to whom" (ADR-0018 §5). Two members at
// once (TEST-10). Behind its release flag (CODE-20). The test helpers publish this week's plan as
// starting now and publishing it do (`start.e2e.ts`).

const flags = {
  'sign-in': true,
  onboarding: true,
  plans: true,
  completions: true,
  'activity-log': true,
};

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Another person's device, as the test's project sets devices up, from a network of its own. */
const deviceOf = async (
  browser: Browser,
  testInfo: TestInfo,
  who: string,
  javaScriptEnabled = true,
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

/** Opens the plan from the household's page, and returns this week's. */
const thisWeek = async (page: Page, id: string) => {
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await expect(page).toHaveURL(`/households/${id}/plan`);
  return page.getByRole('region', { name: /^This week: / });
};

/**
 * Ash Lane, whose head Robin, the test's account, has every task of this week's published plan,
 * dishes every day from today: Alex, the other member with an account, has a share of 0.
 */
const household = async (
  accounts: Parameters<Parameters<typeof test>[2]>[0]['accounts'],
  email: string,
  testInfo: TestInfo,
  password: string,
) => {
  await accounts.addSecondFactor(email);
  const id = await accounts.addHousehold(email, 'Ash Lane');
  const alex = { email: `${testInfo.testId}-alex@example.org`, password };
  await accounts.add(alex);
  await accounts.addMember(id, alex.email, 'Alex');
  await accounts.setShare(id, alex.email, 0);
  await accounts.addTask(id, { name: 'Dishes', duration: 20, frequency: 'daily' });
  await accounts.publishThisWeek(id);
  return { id, alex };
};

// The day of a completion, as “Friday, October 9”, and its time, as “6:30 PM”, in the browser's
// language.
const day = String.raw`[\w ,]+?`;
const time = String.raw`\d{1,2}:\d{2}(?:\s?[AP]M)?`;

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a member marks their own task done with one tap, another sees the day only, and it is undone', async ({
      page,
      browser,
      accounts,
      account,
    }, testInfo) => {
      const { id, alex } = await household(accounts, account.email, testInfo, account.password);
      await signIn(page, account, `/households/${id}`);
      const week = await thisWeek(page, id);
      const own = week.getByRole('region', { name: 'Robin (you)' }).getByRole('listitem').first();
      const done = own.getByRole('button', { name: /^Done: Dishes, / });
      if (javaScriptEnabled) await expectAccessible(page, 'this week, to do');
      await done.click();

      await expect(week.getByRole('status')).toHaveText('Dishes is marked done.');
      // The time for whom it credits (ADR-0018 §3).
      await expect(own).toContainText(new RegExp(`Done on ${day} at ${time} by you\\.`));
      await expect(own.getByRole('button', { name: /^Done: / })).toHaveCount(0);
      const undo = own.getByRole('button', { name: /^Undo: Dishes, / });
      await expect(undo).toBeVisible();
      if (javaScriptEnabled) {
        await expect(undo).toBeFocused();
        await expectAccessible(page, 'done');
      }

      // Another member sees the day it was done, never the time, and can't undo it.
      const theirs = await deviceOf(browser, testInfo, 'alex', javaScriptEnabled);
      try {
        const other = await theirs.newPage();
        await signIn(other, alex, `/households/${id}`);
        const seen = (await thisWeek(other, id))
          .getByRole('region', { name: 'Robin' })
          .getByRole('listitem')
          .first();
        await expect(seen).toContainText(new RegExp(`Done on ${day} by Robin\\.`));
        await expect(seen).not.toContainText(new RegExp(` at ${time}`));
        await expect(seen.getByRole('button')).toHaveCount(0);
        if (javaScriptEnabled) await expectAccessible(other, 'done, as another member sees it');
      } finally {
        await theirs.close();
      }

      await undo.click();
      await expect(week.getByRole('status')).toHaveText('Dishes is open again.');
      await expect(own).not.toContainText('Done on');
      await expect(done).toBeVisible();
      if (javaScriptEnabled) {
        await expect(done).toBeFocused();
        await expectAccessible(page, 'undone');
      }
    });

    test('a member marks a task done with someone else, which the activity log shows', async ({
      page,
      browser,
      accounts,
      account,
    }, testInfo) => {
      const { id, alex } = await household(accounts, account.email, testInfo, account.password);
      await signIn(page, account, `/households/${id}`);
      const week = await thisWeek(page, id);
      const own = week.getByRole('region', { name: 'Robin (you)' }).getByRole('listitem').first();
      // A disclosure's summary has no role of its own to find it by (TEST-3).
      await own.getByText('Done together, or by someone else?', { exact: true }).click();
      const who = own.getByRole('group', { name: 'Who did it?' });
      await expect(who.getByRole('checkbox', { name: 'Robin (you)' })).toBeChecked();
      await expect(who.getByRole('checkbox', { name: 'Alex' })).not.toBeChecked();

      // Nobody ticked: the choice says what is missing (UI-10).
      await who.getByRole('checkbox', { name: 'Robin (you)' }).uncheck();
      await own.getByRole('button', { name: /^Mark as done: Dishes, / }).click();
      const summary = page.getByRole('region', { name: 'Marking it done didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('Tick who did Dishes.');
      await expect(who).toHaveAccessibleDescription('Tick who did it.');
      if (javaScriptEnabled) await expectAccessible(page, 'nobody ticked');

      await who.getByRole('checkbox', { name: 'Robin (you)' }).check();
      await who.getByRole('checkbox', { name: 'Alex' }).check();
      await own.getByRole('button', { name: /^Mark as done: Dishes, / }).click();
      await expect(week.getByRole('status')).toHaveText('Dishes is marked done.');
      await expect(own).toContainText(new RegExp(`Done on ${day} at ${time} by Alex and you\\.`));
      await expect(own).toContainText('Logged by you.');

      // Alex is credited too, so sees the time, and may undo it (ADR-0006 §4, clarification).
      const theirs = await deviceOf(browser, testInfo, 'alex', javaScriptEnabled);
      try {
        const other = await theirs.newPage();
        await signIn(other, alex, `/households/${id}`);
        const seen = (await thisWeek(other, id))
          .getByRole('region', { name: 'Robin' })
          .getByRole('listitem')
          .first();
        await expect(seen).toContainText(
          new RegExp(`Done on ${day} at ${time} by you and Robin\\.`),
        );
        await expect(seen).toContainText('Logged by Robin.');
        await expect(seen.getByRole('button', { name: /^Undo: Dishes, / })).toBeVisible();
        // Who did what to whom, never a value (ADR-0018 §5).
        await other.goto(`/households/${id}/activity`);
        const entry = other.getByRole('listitem');
        await expect(entry).toHaveCount(1);
        await expect(entry).toContainText('Robin marked a task done for Alex.');
        await expect(entry).not.toContainText(/\d+ points?|\d{2}:\d{2}/);
        if (javaScriptEnabled) await expectAccessible(other, 'activity');
      } finally {
        await theirs.close();
      }
    });
  });
}

test('of two members marking a task done at once, the second is told who did it (TEST-10)', async ({
  page,
  browser,
  accounts,
  account,
}, testInfo) => {
  const { id, alex } = await household(accounts, account.email, testInfo, account.password);
  await signIn(page, account, `/households/${id}`);
  const week = await thisWeek(page, id);
  const own = week.getByRole('region', { name: 'Robin (you)' }).getByRole('listitem').first();
  await expect(own.getByRole('button', { name: /^Done: Dishes, / })).toBeVisible();

  // Alex picks it up on a device of their own, while Robin's page still shows it open.
  const theirs = await deviceOf(browser, testInfo, 'alex');
  try {
    const other = await theirs.newPage();
    await signIn(other, alex, `/households/${id}`);
    const seen = (await thisWeek(other, id))
      .getByRole('region', { name: 'Robin' })
      .getByRole('listitem')
      .first();
    // A disclosure's summary has no role of its own to find it by (TEST-3).
    await seen.getByText('Someone did it?', { exact: true }).click();
    const who = seen.getByRole('group', { name: 'Who did it?' });
    await who.getByRole('checkbox', { name: 'Robin' }).uncheck();
    await who.getByRole('checkbox', { name: 'Alex (you)' }).check();
    await seen.getByRole('button', { name: /^Mark as done: Dishes, / }).click();
    await expect(seen).toContainText(new RegExp(`Done on ${day} at ${time} by you\\.`));
  } finally {
    await theirs.close();
  }

  await own.getByRole('button', { name: /^Done: Dishes, / }).click();
  const summary = page.getByRole('region', { name: 'Marking it done didn’t work' });
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Dishes is done already, by Alex.');
  // The page now shows it done by Alex, on the day only, which a head may still undo.
  await expect(own).toContainText(new RegExp(`Done on ${day} by Alex\\.`));
  await expect(own.getByRole('button', { name: /^Undo: Dishes, / })).toBeVisible();
  await expectAccessible(page, 'done by someone else first');

  // It became Alex's work, which the activity log shows (ADR-0018 §5, clarification).
  await page.goto(`/households/${id}/activity`);
  const entry = page.getByRole('listitem');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('Alex picked up a task of Robin’s.');
  await expect(entry).not.toContainText(/Dishes|\d+ points?/);
});

test('what next week’s draft takes over is still this week’s to do, and done shows there (ADR-0002 §2)', async ({
  page,
  accounts,
  account,
}) => {
  // Robin alone, with dishes every day and the windows every two weeks from today.
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await accounts.addTask(id, { name: 'Dishes', duration: 20, frequency: 'daily' });
  await accounts.addTask(id, { name: 'Windows', duration: 15, frequency: 'biweekly' });
  await accounts.publishThisWeek(id);
  // Next week's draft: its own dishes replace this week's, and the windows carry over.
  await accounts.draftNextWeek(id);
  await signIn(page, account, `/households/${id}`);
  const week = await thisWeek(page, id);
  const next = page.getByRole('region', { name: /^Next week: / });
  // Every task left this week can still be marked done.
  const tasks = week.getByRole('listitem');
  await expect(week.getByRole('button', { name: /^Done: / })).toHaveCount(await tasks.count());
  const carried = next.getByRole('listitem').filter({ hasText: 'Windows' });
  await expect(carried).toContainText('Points');

  await week.getByRole('button', { name: /^Done: Windows, / }).click();
  await expect(week.getByRole('status')).toHaveText('Windows is marked done.');
  // Next week shows it done, and as no work of its own there.
  await expect(carried).toContainText(new RegExp(`Done on ${day} at ${time} by you\\.`));
  await expect(carried).not.toContainText('Points');
  await expect(carried.getByRole('button', { name: /^Done: / })).toHaveCount(0);
  await expect(next.getByRole('listitem').filter({ hasText: 'Dishes' }).first()).toContainText(
    'Points',
  );
  await expectAccessible(page, 'carried over and done');
});

test('nothing can be marked done while its flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}, testInfo) => {
  await forceFlags(context, baseURL, { ...flags, completions: false });
  const { id } = await household(accounts, account.email, testInfo, account.password);
  await signIn(page, account, `/households/${id}`);
  const week = await thisWeek(page, id);
  await expect(week.getByRole('listitem').first()).toBeVisible();
  await expect(week.getByRole('button')).toHaveCount(0);
  await expect(week.getByText('Someone did it?')).toHaveCount(0);
});
