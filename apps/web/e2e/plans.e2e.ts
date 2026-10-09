import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// Each week's plan: heads see the draft and can publish it early, everyone sees the published plan,
// and each task says why it went to whoever has it (ADR-0006 §2, ADR-0007 §5). Behind its release
// flag (CODE-20). Until Start exists, the test helpers take the household out of setup and draft
// next week's plan as the scheduler would (ADR-0007 §2).

const flags = { 'sign-in': true, onboarding: true, plans: true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Opens the plan from the household's page. */
const openPlan = async (page: Page, id: string) => {
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await expect(page).toHaveURL(`/households/${id}/plan`);
  await expect(page).toHaveTitle('Plan · Ash Lane · Householdr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan');
};

/** Signs Alex in on a device of their own, as the test's project sets devices up. */
const alexDevice = async (browser: Browser, testInfo: TestInfo, javaScriptEnabled: boolean) => {
  const { viewport, colorScheme, deviceScaleFactor, isMobile, hasTouch, userAgent, baseURL } =
    testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: ownNetwork(`${testInfo.testId}-alex`),
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

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head sees next week’s draft and publishes it early; then everyone sees it', async ({
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
      await accounts.addTask(id, { name: 'Vacuum', duration: 30, frequency: 'weekly' });
      await accounts.addTask(id, { name: 'Dishes', duration: 20, frequency: 'daily' });
      await accounts.draftNextWeek(id);

      // Only heads see the draft (ADR-0006 §2, clarification).
      const theirs = await alexDevice(browser, testInfo, javaScriptEnabled);
      try {
        const other = await theirs.newPage();
        await signIn(other, alex, `/households/${id}`);
        await openPlan(other, id);
        await expect(other.getByText('There’s no plan to show yet.')).toBeVisible();

        await signIn(page, account, `/households/${id}`);
        await openPlan(page, id);
        const week = page.getByRole('region', { name: /^Next week: / });
        await expect(week.getByText(/^This is a draft\. Only heads see it until/)).toBeVisible();
        const members = week.getByRole('region');
        await expect(members.getByRole('heading', { level: 3 })).toHaveText([
          'Robin (you)',
          'Alex',
        ]);
        // Eight tasks between the two, each saying why it went where it did (ADR-0007 §5).
        const tasks = week.getByRole('listitem');
        await expect(tasks).toHaveCount(8);
        await expect(tasks.filter({ hasText: /Why\s*(You|Alex) had the least to do/ })).toHaveCount(
          8,
        );
        // Points for one's own tasks only (ADR-0003 §5).
        const robins = week.getByRole('region', { name: 'Robin (you)' }).getByRole('listitem');
        const alexs = week.getByRole('region', { name: 'Alex' }).getByRole('listitem');
        await expect(robins.filter({ hasText: 'Points' })).toHaveCount(await robins.count());
        await expect(alexs.filter({ hasText: 'Points' })).toHaveCount(0);
        if (javaScriptEnabled) await expectAccessible(page, 'a head’s draft');

        await week.getByRole('button', { name: 'Publish now' }).click();
        await expect(week.getByRole('status')).toHaveText(
          'The plan is published: everyone in the household sees it now.',
        );
        await expect(week.getByRole('button', { name: 'Publish now' })).toHaveCount(0);
        await expect(week.getByText(/^This is a draft/)).toHaveCount(0);
        if (javaScriptEnabled) {
          await expect(week.getByRole('heading', { level: 2 })).toBeFocused();
          await expectAccessible(page, 'published');
        }

        await other.reload();
        const published = other.getByRole('region', { name: /^Next week: / });
        await expect(published.getByRole('listitem')).toHaveCount(8);
        await expect(published.getByRole('button')).toHaveCount(0);
        await expect(
          published.getByRole('region', { name: 'Alex (you)' }).getByRole('listitem').first(),
        ).toContainText(/Points\s*\d+ points?/);
        if (javaScriptEnabled) await expectAccessible(other, 'a member’s plan');
      } finally {
        await theirs.close();
      }
    });
  });
}

test('shows heads what nobody could take, and why', async ({ page, accounts, account }) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await accounts.addTask(id, { name: 'Vacuum', duration: 30, frequency: 'weekly' });
  const today = Temporal.Now.plainDateISO('Europe/Brussels');
  const monday = today.subtract({ days: today.dayOfWeek - 1 }).add({ weeks: 1 });
  await accounts.absent(id, account.email, monday.toString(), monday.add({ days: 6 }).toString());
  await accounts.draftNextWeek(id);
  await signIn(page, account, `/households/${id}`);
  await openPlan(page, id);
  const nobody = page.getByRole('region', { name: 'Not given to anyone' });
  await expect(nobody.getByRole('listitem')).toHaveText([
    /^\s*Vacuum\s*Day\s*.+\s*Why\s*Nobody can do it then: everyone is away, or not allowed to do it\.\s*$/,
  ]);
  await expect(page.getByRole('region', { name: 'Robin (you)' })).toContainText(
    'Nothing this week.',
  );
  await expectAccessible(page, 'unassigned');
});

test('a task from an earlier week can be done any day of the week it is in (ADR-0004 §4)', async ({
  page,
  accounts,
  account,
}) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  // A monthly task floats: its first time, dated today, goes into the first plan, next week's.
  await accounts.addTask(id, { name: 'Clean the windows', duration: 60, frequency: 'monthly' });
  await accounts.draftNextWeek(id);
  await signIn(page, account, `/households/${id}`);
  await openPlan(page, id);
  const week = page.getByRole('region', { name: /^Next week: / });
  const task = week.getByRole('listitem').filter({ hasText: 'Clean the windows' });
  await expect(task).toContainText(/Day\s*Any day next week/);
  await expect(task.locator('time')).toHaveCount(0);
  await expectAccessible(page, 'any day');
});

test('a head publishes only the draft they saw (ADR-0019 §5)', async ({
  page,
  accounts,
  account,
}) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await accounts.draftNextWeek(id);
  await signIn(page, account, `/households/${id}`);
  await openPlan(page, id);
  const week = page.getByRole('region', { name: /^Next week: / });
  // Drafted again by someone else in the meantime: the version the page holds is behind.
  await week.locator('input[name="version"]').evaluate((input: HTMLInputElement) => {
    input.value = String(Number(input.value) + 1);
  });
  await week.getByRole('button', { name: 'Publish now' }).click();
  const summary = page.getByRole('region', { name: 'Publishing didn’t work' });
  await expect(summary).toBeFocused();
  await expect(summary).toContainText(
    'The draft changed since you opened it. Check it, then publish again.',
  );
  await expect(week.getByText(/^This is a draft/)).toBeVisible();
  await expectAccessible(page, 'publishing refused');
});

test('the plan isn’t there while its flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, plans: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Plan', exact: true })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/plan`))?.status()).toBe(404);
});

test('a household’s plan is not found for anyone outside it', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const other = { email: `${testInfo.testId}-other@example.org`, password: account.password };
  await accounts.add(other);
  const theirs = await accounts.addHousehold(other.email, 'Cedar Row');
  await signIn(page, account, '/');
  expect((await page.goto(`/households/${theirs}/plan`))?.status()).toBe(404);
});
