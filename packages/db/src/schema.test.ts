import type { HouseholdCalendar } from '@householdr/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inHousehold, type Database } from './connection';
import { accounts, sessions } from './auth-schema';
import { households, members } from './schema';
import { refusal, testDatabase } from './testing';

// The database keeps to the domain's rules as a second line of defence (ADR-0006 §1, ADR-0012 §2).

let db: Database;
let close: () => Promise<void>;
let next = 0;
const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
type NewHousehold = Partial<typeof households.$inferInsert>;
const household = (id: string, fields: NewHousehold = {}) => ({
  id,
  name: 'Ash Lane',
  country: 'BE',
  language: 'nl',
  timeZone: 'Europe/Brussels',
  weekStartDay: 1 as const,
  ...fields,
});
// A day the domain's type rules out, to check the database refuses it too.
const outOfRange = (day: number) => day as HouseholdCalendar['weekStartDay'];
const addHousehold = (fields: NewHousehold = {}) => {
  const id = newId();
  return inHousehold(db, id, (tx) => tx.insert(households).values(household(id, fields)));
};
const addMember = (fields: Omit<typeof members.$inferInsert, 'householdId'>) => {
  const id = newId();
  return inHousehold(db, id, async (tx) => {
    await tx.insert(households).values(household(id));
    await tx.insert(members).values({ householdId: id, ...fields });
  });
};

beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(() => close());

describe('households', () => {
  it('stores a household with its settings, at version 1', async () => {
    const id = newId();
    const [row] = await inHousehold(db, id, (tx) =>
      tx.insert(households).values(household(id)).returning(),
    );
    expect(row).toEqual({
      ...household(id),
      weekStartChangeFrom: null,
      weekStartPreviousDay: null,
      version: 1,
    });
  });

  it('needs a name, a country code, a language code and a time zone', async () => {
    expect(await refusal(addHousehold({ name: '' }))).toBe('households_name');
    expect(await refusal(addHousehold({ country: 'Belgium' }))).toBe('households_country');
    expect(await refusal(addHousehold({ country: 'be' }))).toBe('households_country');
    expect(await refusal(addHousehold({ language: 'Dutch' }))).toBe('households_language');
    expect(await refusal(addHousehold({ timeZone: '' }))).toBe('households_time_zone');
  });

  it('starts weeks on a day from 1 (Monday) to 7 (Sunday)', async () => {
    expect(await refusal(addHousehold({ weekStartDay: 7 }))).toBeUndefined();
    expect(await refusal(addHousehold({ weekStartDay: outOfRange(0) }))).toBe(
      'households_week_start_day',
    );
    expect(await refusal(addHousehold({ weekStartDay: outOfRange(8) }))).toBe(
      'households_week_start_day',
    );
  });

  it('records a change of start day from a date on the previous start day (ADR-0006 §1)', async () => {
    // Monday 12 October 2026, from Monday weeks to Thursday weeks.
    const change = {
      weekStartDay: 4,
      weekStartChangeFrom: '2026-10-12',
      weekStartPreviousDay: 1,
    } as const;
    const broken = 'households_week_start_change';
    expect(await refusal(addHousehold(change))).toBeUndefined();
    expect(await refusal(addHousehold({ ...change, weekStartPreviousDay: null }))).toBe(broken);
    expect(await refusal(addHousehold({ ...change, weekStartChangeFrom: null }))).toBe(broken);
    // Monday weeks "changing" to Monday weeks, from a Monday: no change at all.
    expect(await refusal(addHousehold({ ...change, weekStartDay: 1 }))).toBe(broken);
    expect(await refusal(addHousehold({ ...change, weekStartChangeFrom: '2026-10-13' }))).toBe(
      broken,
    );
  });
});

describe('members', () => {
  it('gives a birth date to children and to nobody else (ADR-0012 §2)', async () => {
    expect(await refusal(addMember({ name: 'Robin', role: 'head' }))).toBeUndefined();
    expect(
      await refusal(addMember({ name: 'Kim', role: 'child', birthDate: '2016-03-01' })),
    ).toBeUndefined();
    expect(await refusal(addMember({ name: 'Kim', role: 'child' }))).toBe('members_birth_date');
    expect(await refusal(addMember({ name: 'Alex', role: 'adult', birthDate: '1990-01-01' }))).toBe(
      'members_birth_date',
    );
  });

  it('needs a name and a known role', async () => {
    expect(await refusal(addMember({ name: '', role: 'adult' }))).toBe('members_name');
    expect(await refusal(addMember({ name: 'Alex', role: 'owner' as 'adult' }))).toBe(
      'members_role',
    );
  });

  it('go with their household when it is deleted', async () => {
    const id = newId();
    const left = await inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      await tx.insert(members).values({ householdId: id, name: 'Robin', role: 'head' });
      await tx.delete(households);
      return tx.select().from(members);
    });
    expect(left).toEqual([]);
  });
});

describe('accounts and sessions (ADR-0010)', () => {
  const addAccount = (fields: Partial<typeof accounts.$inferInsert> = {}) =>
    db
      .insert(accounts)
      .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, ...fields })
      .returning();

  it('stores no profile picture (ADR-0012 §1)', async () => {
    expect(await refusal(addAccount())).toBeUndefined();
    expect(await refusal(addAccount({ image: 'https://example.org/robin.png' }))).toBe(
      'accounts_no_image',
    );
  });

  it('keeps one account per e-mail address (ADR-0010 §1)', async () => {
    expect(await refusal(addAccount({ email: 'kim@example.org' }))).toBeUndefined();
    expect(await refusal(addAccount({ email: 'kim@example.org' }))).toBe('accounts_email_unique');
  });

  it('stores no address or user agent on a session (ADR-0012 §2, clarification)', async () => {
    const [account] = await addAccount();
    if (!account) throw new Error('No account');
    const session = (fields: Partial<typeof sessions.$inferInsert>) =>
      db.insert(sessions).values({
        token: `token-${String(++next)}`,
        userId: account.id,
        expiresAt: new Date('2026-11-07T00:00:00Z'),
        ...fields,
      });
    expect(await refusal(session({}))).toBeUndefined();
    expect(await refusal(session({ ipAddress: '' }))).toBe('sessions_no_ip_address');
    expect(await refusal(session({ ipAddress: '203.0.113.9' }))).toBe('sessions_no_ip_address');
    expect(await refusal(session({ browser: 'Firefox', system: 'Linux' }))).toBeUndefined();
    expect(await refusal(session({ userAgent: '' }))).toBe('sessions_no_user_agent');
    expect(await refusal(session({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }))).toBe(
      'sessions_no_user_agent',
    );
  });
});
