import type { Browser, TestInfo } from '@playwright/test';
import { calendarDays } from '../src/lib/intl';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// A member's own notifications from a household, newest first, each a link to the plan it is
// about, which nobody else sees (ADR-0014 §7, clarification): heads hear that a draft is ready,
// members with tasks that a plan is published (§2). Behind its release flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, plans: true, notifications: true };

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

/**
 * The days of the week starting on `start`, as the page writes them: in English with the test
 * accounts' Belgian conventions (ADR-0008 §6).
 */
const daysOf = (start: Temporal.PlainDate) =>
  calendarDays(start.toString(), start.add({ days: 6 }).toString(), 'en-BE');

test('a head hears that a draft is ready, a member that their plan is published, each only their own', async ({
  page,
  browser,
  accounts,
  account,
}, testInfo) => {
  // Ash Lane, whose head Robin, the test's account, has a share of 0, so Alex has every task.
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  const alex = { email: `${testInfo.testId}-alex@example.org`, password: account.password };
  await accounts.add(alex);
  await accounts.addMember(alex.email, id, 'Alex');
  await accounts.setShare(id, account.email, 0);
  await accounts.addTask(id, { name: 'Dishes', duration: 20, frequency: 'daily' });
  await accounts.publishThisWeek(id);
  const nextWeek = Temporal.PlainDate.from(await accounts.draftNextWeek(id));
  const thisWeek = nextWeek.subtract({ weeks: 1 });

  await signIn(page, account, `/households/${id}`);
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(page).toHaveURL(`/households/${id}/notifications`);
  await expect(page).toHaveTitle('Notifications · Ash Lane · Householdr');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  // Robin has no task this week, so only the drafts, which the scheduler made (ADR-0014 §2):
  // this week's, then next week's, newest first.
  const list = page.getByRole('list', { name: 'Notifications' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  const [next, current] = [list.getByRole('listitem').first(), list.getByRole('listitem').last()];
  await expect(next).toContainText('Today');
  await expect(
    current.getByRole('link', {
      name: `The draft plan for ${daysOf(thisWeek)} is ready for you to check.`,
    }),
  ).toBeVisible();
  const link = next.getByRole('link', {
    name: `The draft plan for ${daysOf(nextWeek)} is ready for you to check.`,
  });
  await expectAccessible(page, 'a head’s notifications');
  await link.click();
  await expect(page).toHaveURL(`/households/${id}/plan`);

  // Alex sees their own published plan, and nothing of the draft, which only heads see.
  const device = await deviceOf(browser, testInfo, 'alex');
  try {
    const other = await device.newPage();
    await signIn(other, alex, `/households/${id}`);
    await other.getByRole('link', { name: 'Notifications', exact: true }).click();
    const theirs = other.getByRole('list', { name: 'Notifications' }).getByRole('listitem');
    await expect(theirs).toHaveCount(1);
    await expect(
      theirs.getByRole('link', { name: `Your plan for ${daysOf(thisWeek)} is published.` }),
    ).toBeVisible();
    await expectAccessible(other, 'a member’s notifications');
  } finally {
    await device.close();
  }
});

test('with nothing yet, the page says so', async ({ page, accounts, account }) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/notifications`);
  await expect(page.getByRole('main')).toContainText('Nothing yet.');
  await expect(page.getByRole('list', { name: 'Notifications' })).toHaveCount(0);
  await expectAccessible(page, 'no notifications');
});

test('the notifications aren’t there while their flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, notifications: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/notifications`))?.status()).toBe(404);
});

test('a household’s notifications are not found for anyone outside it', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const other = { email: `${testInfo.testId}-other@example.org`, password: account.password };
  await accounts.add(other);
  const theirs = await accounts.addHousehold(other.email, 'Cedar Row');
  await signIn(page, account, '/');
  expect((await page.goto(`/households/${theirs}/notifications`))?.status()).toBe(404);
});
