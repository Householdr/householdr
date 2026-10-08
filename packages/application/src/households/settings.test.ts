import { accounts, activityLog, inHousehold, passkeys, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settableClock } from '../testing';
import { householdActivity } from './activity';
import { createHousehold } from './create-household';
import { membership } from './membership';
import { changeHouseholdSettings, householdSettings } from './settings';

// Changing the household's settings (ADR-0007 §2) from the version a head saw (ADR-0019 §5), and
// the activity log that shows it (ADR-0018 §5), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

let next = 0;

/** A household founded by Robin, a head with two factors, at a clock of its own. */
const household = async () => {
  const [account] = await db
    .insert(accounts)
    .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
    .returning({ id: accounts.id });
  if (!account) throw new Error('No account');
  await db.insert(passkeys).values({
    userId: account.id,
    publicKey: 'a-key',
    credentialID: `credential-${String(++next)}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  const created = await createHousehold(
    {
      db,
      actor: { account: account.id, twoFactor: true },
      account: { id: account.id, managed: false, guardians: [] },
    },
    {
      name: 'Ash Lane',
      headName: 'Robin',
      country: 'BE',
      timeZone: 'Europe/Brussels',
      language: 'en',
      weekStartDay: 1,
      adult: true,
    },
  );
  if (!created.ok) throw new Error('No household');
  const member = await membership({ db }, account.id, created.householdId);
  if (!member) throw new Error('Not a member');
  const clock = settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z'));
  return { db, clock, householdId: created.householdId, member };
};

const settings = { name: 'Ash Lane', country: 'BE', timeZone: 'Europe/Brussels', language: 'en' };

describe('householdSettings and changeHouseholdSettings (ADR-0007 §2)', () => {
  it('shows a head the settings at version 1, and saves a change, which moves it on', async () => {
    const head = await household();
    expect(await householdSettings(head)).toEqual({
      ok: true,
      settings: { ...settings, version: 1 },
    });
    const changed = {
      ...settings,
      name: 'Birch Court',
      country: 'ES',
      timeZone: 'Atlantic/Canary',
    };
    expect(await changeHouseholdSettings(head, { ...changed, version: 1 })).toEqual({ ok: true });
    expect(await householdSettings(head)).toEqual({
      ok: true,
      settings: { ...changed, version: 2 },
    });
  });

  it('logs each setting that changed, by whom and when, and nothing for an unchanged save', async () => {
    const head = await household();
    await changeHouseholdSettings(head, { ...settings, version: 1 });
    expect(await householdActivity(head)).toMatchObject({ entries: [] });
    head.clock.advance({ hours: 1 });
    await changeHouseholdSettings(head, {
      ...settings,
      name: 'Birch Court',
      country: 'NL',
      timeZone: 'Europe/Amsterdam',
      version: 1,
    });
    const activity = await householdActivity(head);
    expect(activity).toEqual({
      ok: true,
      timeZone: 'Europe/Amsterdam',
      entries: expect.arrayContaining([
        expect.objectContaining({ actor: 'Robin', action: 'household.name' }),
        expect.objectContaining({ actor: 'Robin', action: 'household.country' }),
        expect.objectContaining({ actor: 'Robin', action: 'household.timeZone' }),
      ]) as unknown,
    });
    if (!activity.ok) throw new Error('No activity');
    expect(activity.entries).toHaveLength(3);
    expect(activity.entries[0]?.at).toEqual(Temporal.Instant.from('2026-10-08T09:00:00Z'));
  });

  it('saves nothing from a version that has moved on, and says who changed it last', async () => {
    const head = await household();
    await changeHouseholdSettings(head, { ...settings, name: 'Birch Court', version: 1 });
    const stale = await changeHouseholdSettings(head, {
      ...settings,
      name: 'Cedar Row',
      version: 1,
    });
    expect(stale).toEqual({
      ok: false,
      error: 'conflict',
      current: { ...settings, name: 'Birch Court', version: 2 },
      changedBy: 'Robin',
    });
    expect(await householdSettings(head)).toMatchObject({ settings: { name: 'Birch Court' } });
  });

  it('says which fields aren’t valid, with a time zone that must be the country’s', async () => {
    const head = await household();
    const refused = await changeHouseholdSettings(head, {
      name: ' ',
      country: 'US',
      timeZone: 'Europe/Brussels',
      language: 'xx',
      version: 1,
    });
    expect(refused).toEqual({
      ok: false,
      error: 'invalid',
      fields: ['name', 'country', 'language'],
    });
    expect(
      await changeHouseholdSettings(head, { ...settings, timeZone: 'Europe/Paris', version: 1 }),
    ).toEqual({ ok: false, error: 'invalid', fields: ['timeZone'] });
  });

  it('is for heads with two factors only (ADR-0010 §3)', async () => {
    const head = await household();
    const adult = { ...head, member: { ...head.member, role: 'adult' as const } };
    const withoutTwoFactor = { ...head, member: { ...head.member, twoFactor: false } };
    for (const someone of [adult, withoutTwoFactor]) {
      expect(await householdSettings(someone)).toEqual({ ok: false, error: 'not-allowed' });
      expect(
        await changeHouseholdSettings(someone, { ...settings, name: 'Birch', version: 1 }),
      ).toEqual({ ok: false, error: 'not-allowed' });
    }
    expect(await householdSettings(head)).toMatchObject({ settings: { name: 'Ash Lane' } });
  });
});

describe('householdActivity (ADR-0018 §5)', () => {
  it('shows every member the log, newest first, and a former member without a name', async () => {
    const head = await household();
    await changeHouseholdSettings(head, { ...settings, name: 'Birch Court', version: 1 });
    head.clock.advance({ hours: 24 });
    await changeHouseholdSettings(head, { ...settings, name: 'Cedar Row', version: 2 });
    await inHousehold(db, head.householdId, (tx) =>
      tx.insert(activityLog).values({
        householdId: head.householdId,
        at: new Date('2026-10-10T08:00:00Z'),
        actorId: null,
        action: 'household.language',
      }),
    );
    const adult = { ...head, member: { ...head.member, role: 'adult' as const, twoFactor: false } };
    expect(await householdActivity(adult)).toMatchObject({
      entries: [
        { actor: null, action: 'household.language' },
        {
          actor: 'Robin',
          action: 'household.name',
          at: Temporal.Instant.from('2026-10-09T08:00:00Z'),
        },
        {
          actor: 'Robin',
          action: 'household.name',
          at: Temporal.Instant.from('2026-10-08T08:00:00Z'),
        },
      ],
    });
  });

  it('shows nothing to a profile without an account, which can’t act (ADR-0018 §4)', async () => {
    const head = await household();
    const profile = { ...head, member: { ...head.member, hasAccount: false } };
    expect(await householdActivity(profile)).toEqual({ ok: false, error: 'not-allowed' });
  });
});
