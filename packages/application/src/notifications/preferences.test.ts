import { accounts, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeNotificationPreferences, notificationPreferencesOf } from './preferences';

// An account's notification preferences (ADR-0014 §3, clarifications), on a real database
// (TEST-11). Invented accounts (TEST-8).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;
/** An account of its own for each test, as its context. */
const signedIn = async () => {
  const [row] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!row) throw new Error('No account');
  return { db, account: row.id };
};

const time = (text: string) => Temporal.PlainTime.from(text);

/** What the form sends: every category, the quiet hours, the fallback, and the version it saw. */
const form = {
  'plan.published': 'push-and-email',
  'plan.drafted': 'app',
  quietStart: '22:15',
  quietEnd: '06:45',
  emailFallback: false,
  version: 0,
};

describe('notificationPreferencesOf (ADR-0014 §3)', () => {
  it('gives an account that never chose the defaults: push, 21:30 to 07:30, the fallback on', async () => {
    expect(await notificationPreferencesOf(await signedIn())).toEqual({
      ok: true,
      preferences: {
        channels: { 'plan.published': 'push', 'plan.drafted': 'push' },
        quietHours: { start: time('21:30'), end: time('07:30') },
        emailFallback: true,
        version: 0,
      },
    });
  });
});

describe('changeNotificationPreferences (ADR-0014 §3, ADR-0019 §5)', () => {
  it('saves a channel for each category, the quiet hours and the fallback', async () => {
    const context = await signedIn();
    expect(await changeNotificationPreferences(context, form)).toEqual({ ok: true });
    expect(await notificationPreferencesOf(context)).toEqual({
      ok: true,
      preferences: {
        channels: { 'plan.published': 'push-and-email', 'plan.drafted': 'app' },
        quietHours: { start: time('22:15'), end: time('06:45') },
        emailFallback: false,
        version: 1,
      },
    });
    // And again, from the version it saw.
    const again = { ...form, 'plan.published': 'email', emailFallback: true, version: 1 };
    expect(await changeNotificationPreferences(context, again)).toEqual({ ok: true });
    expect(await notificationPreferencesOf(context)).toMatchObject({
      preferences: {
        channels: { 'plan.published': 'email', 'plan.drafted': 'app' },
        emailFallback: true,
        version: 2,
      },
    });
  });

  it('keeps each account’s apart', async () => {
    const [robin, sam] = [await signedIn(), await signedIn()];
    await changeNotificationPreferences(robin, form);
    expect(await notificationPreferencesOf(sam)).toMatchObject({
      preferences: { channels: { 'plan.published': 'push' }, version: 0 },
    });
  });

  it('says which fields aren’t valid, and saves nothing', async () => {
    const context = await signedIn();
    const wrong = {
      ...form,
      'plan.published': 'sms',
      quietStart: '25:00',
      emailFallback: 'on',
    };
    expect(await changeNotificationPreferences(context, wrong)).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['plan.published', 'quietStart', 'emailFallback'],
    });
    expect(await changeNotificationPreferences(context, { ...form, quietEnd: '7:30' })).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['quietEnd'],
    });
    expect(await notificationPreferencesOf(context)).toMatchObject({
      preferences: { version: 0 },
    });
  });

  it('refuses quiet hours that start when they end (clarification)', async () => {
    const context = await signedIn();
    const equal = { ...form, quietStart: '07:30', quietEnd: '07:30' };
    expect(await changeNotificationPreferences(context, equal)).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['quietEnd'],
    });
  });

  it('saves nothing over a change made since, and gives the current values', async () => {
    const context = await signedIn();
    // Two devices load the defaults; the first saves.
    expect(await changeNotificationPreferences(context, form)).toEqual({ ok: true });
    const other = { ...form, 'plan.drafted': 'email', quietStart: '23:00' };
    expect(await changeNotificationPreferences(context, other)).toEqual({
      ok: false,
      error: 'conflict',
      current: {
        channels: { 'plan.published': 'push-and-email', 'plan.drafted': 'app' },
        quietHours: { start: time('22:15'), end: time('06:45') },
        emailFallback: false,
        version: 1,
      },
    });
    expect(await changeNotificationPreferences(context, { ...other, version: 3 })).toMatchObject({
      ok: false,
      error: 'conflict',
    });
    // From the current version, it saves.
    expect(await changeNotificationPreferences(context, { ...other, version: 1 })).toEqual({
      ok: true,
    });
  });
});
