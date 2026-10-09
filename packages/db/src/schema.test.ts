import type { HouseholdCalendar } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inHousehold, type Database } from './connection';
import { accountEmails, accounts, sessions } from './auth-schema';
import { households, members, parentalConsents, profileGuardians } from './schema';
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

  it('link an account to one profile per household, kept when the account goes (ADR-0010 §5, §10)', async () => {
    const [account] = await db
      .insert(accounts)
      .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
      .returning();
    if (!account) throw new Error('No account');
    const id = newId();
    const linked = (name: string) => ({
      householdId: id,
      name,
      role: 'adult' as const,
      accountId: account.id,
    });
    await inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      await tx.insert(members).values(linked('Robin'));
    });
    expect(
      await refusal(inHousehold(db, id, (tx) => tx.insert(members).values(linked('Twice')))),
    ).toBe('members_account');
    expect(
      await refusal(addMember({ name: 'Elsewhere', role: 'adult', accountId: account.id })),
    ).toBeUndefined();
    await db.delete(accounts).where(eq(accounts.id, account.id));
    const left = await inHousehold(db, id, (tx) =>
      tx.select({ name: members.name, accountId: members.accountId }).from(members),
    );
    expect(left).toEqual([{ name: 'Robin', accountId: null }]);
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

describe('guardians and consents of a child’s profile (ADR-0010 §9)', () => {
  /** A household with a child's profile, and an account to be its guardian. */
  const withChild = async () => {
    const [account] = await db
      .insert(accounts)
      .values({ name: 'Robin', email: `robin-${String(++next)}@example.org`, culture: 'en-BE' })
      .returning({ id: accounts.id });
    if (!account) throw new Error('No account');
    const householdId = newId();
    const [child] = await inHousehold(db, householdId, async (tx) => {
      await tx.insert(households).values(household(householdId));
      return tx
        .insert(members)
        .values({ householdId, name: 'Kim', role: 'child', birthDate: '2016-03-01' })
        .returning({ id: members.id });
    });
    if (!child) throw new Error('No child');
    return { householdId, memberId: child.id, accountId: account.id };
  };
  type Child = Awaited<ReturnType<typeof withChild>>;
  const consentOf = (
    { householdId, memberId, accountId }: Child,
    fields: Partial<typeof parentalConsents.$inferInsert> = {},
  ) =>
    inHousehold(db, householdId, (tx) =>
      tx.insert(parentalConsents).values({
        householdId,
        memberId,
        givenBy: accountId,
        givenAt: new Date('2026-10-08T08:00:00Z'),
        text: 'I have parental responsibility for this child, and I agree to them using Householdr.',
        language: 'en',
        ...fields,
      }),
    );
  const guardianOf = ({ householdId, memberId, accountId }: Child) =>
    inHousehold(db, householdId, (tx) =>
      tx.insert(profileGuardians).values({ householdId, memberId, accountId }),
    );

  it('keep the consent’s text, and its language as a language tag', async () => {
    const child = await withChild();
    for (const language of ['nl', 'en', 'nl-BE', 'fil', 'en-XA']) {
      expect(await refusal(consentOf(child, { language }))).toBeUndefined();
    }
    for (const language of ['', 'Dutch', 'NL', 'nl_BE', 'nl-be', 'nl-BE-x']) {
      expect(await refusal(consentOf(child, { language }))).toBe('parental_consents_language');
    }
    expect(await refusal(consentOf(child, { text: '' }))).toBe('parental_consents_text');
  });

  it('are about a profile of their own household (ADR-0008 §9)', async () => {
    const child = await withChild();
    const elsewhere = await withChild();
    // Row-level security takes the household id; the profile is another household's.
    const crossed = { ...child, memberId: elsewhere.memberId };
    expect(await refusal(consentOf(crossed))).toBe('parental_consents_member');
    expect(await refusal(guardianOf(crossed))).toBe('profile_guardians_member');
  });

  it('give a profile each guardian once', async () => {
    const child = await withChild();
    expect(await refusal(guardianOf(child))).toBeUndefined();
    expect(await refusal(guardianOf(child))).toBe('profile_guardians_account');
  });

  it('end a guardianship with the profile, or with the guardian’s account', async () => {
    const guardians = ({ householdId }: Child) =>
      inHousehold(db, householdId, (tx) => tx.select().from(profileGuardians));
    const child = await withChild();
    await guardianOf(child);
    await db.delete(accounts).where(eq(accounts.id, child.accountId));
    expect(await guardians(child)).toEqual([]);
    const other = await withChild();
    await guardianOf(other);
    await inHousehold(db, other.householdId, (tx) =>
      tx.delete(members).where(eq(members.id, other.memberId)),
    );
    expect(await guardians(other)).toEqual([]);
  });

  it('keep a consent: nothing deletes it along with what it is about (ADR-0012 §5)', async () => {
    // The record outlives the profile by a year, which the code deleting profiles, households and
    // accounts will see to; until then the database refuses to lose it on the way.
    const child = await withChild();
    await consentOf(child);
    expect(
      await refusal(
        inHousehold(db, child.householdId, (tx) =>
          tx.delete(members).where(eq(members.id, child.memberId)),
        ),
      ),
    ).toBe('parental_consents_member');
    expect(await refusal(inHousehold(db, child.householdId, (tx) => tx.delete(households)))).toBe(
      'parental_consents_member',
    );
    expect(await refusal(db.delete(accounts).where(eq(accounts.id, child.accountId)))).toBe(
      'parental_consents_given_by_accounts_id_fk',
    );
  });
});

describe('accounts and sessions (ADR-0010)', () => {
  const addAccount = (fields: Partial<typeof accounts.$inferInsert> = {}) =>
    db
      .insert(accounts)
      .values({
        name: 'Robin',
        email: `robin-${String(++next)}@example.org`,
        culture: 'en-BE',
        ...fields,
      })
      .returning();

  it('stores no profile picture (ADR-0012 §1)', async () => {
    expect(await refusal(addAccount())).toBeUndefined();
    expect(await refusal(addAccount({ image: 'https://example.org/robin.png' }))).toBe(
      'accounts_no_image',
    );
  });

  it('keeps a culture: a language and a country (ADR-0008 §6)', async () => {
    for (const culture of ['nl-BE', 'en-IE', 'fil-PH']) {
      expect(await refusal(addAccount({ culture }))).toBeUndefined();
    }
    for (const culture of ['', 'nl', 'BE', 'nl-be', 'NL-BE', 'nl_BE', 'nl-BEL', 'nl-BE-x']) {
      expect(await refusal(addAccount({ culture }))).toBe('accounts_culture');
    }
    const without = db.$client.query('insert into auth.accounts (name, email) values ($1, $2)', [
      'Robin',
      `robin-${String(++next)}@example.org`,
    ]);
    await expect(without).rejects.toMatchObject({ code: '23502', column: 'culture' });
  });

  it('keeps the version of the terms accepted together with when (ADR-0012 §2)', async () => {
    const at = new Date('2026-10-08T08:00:00Z');
    expect(await refusal(addAccount())).toBeUndefined();
    expect(
      await refusal(addAccount({ termsVersion: '2026-10-01', termsAcceptedAt: at })),
    ).toBeUndefined();
    expect(await refusal(addAccount({ termsVersion: '2026-10-01' }))).toBe('accounts_terms');
    expect(await refusal(addAccount({ termsAcceptedAt: at }))).toBe('accounts_terms');
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

  it('sends a sign-up’s e-mail to an address, and every other one to an account (ADR-0014 §7)', async () => {
    const [account] = await addAccount();
    if (!account) throw new Error('No account');
    const email = (fields: Omit<typeof accountEmails.$inferInsert, 'kind'>, kind = 'sign-up') =>
      db.insert(accountEmails).values({ kind: kind as 'sign-up', ...fields });
    expect(await refusal(email({ email: 'kim@example.org' }))).toBeUndefined();
    expect(await refusal(email({ accountId: account.id }, 'password-reset'))).toBeUndefined();
    expect(await refusal(email({}))).toBe('account_emails_recipient');
    expect(await refusal(email({ accountId: account.id }))).toBe('account_emails_recipient');
    expect(await refusal(email({ accountId: account.id, email: 'kim@example.org' }))).toBe(
      'account_emails_recipient',
    );
    expect(await refusal(email({ email: 'kim@example.org' }, 'password-reset'))).toBe(
      'account_emails_recipient',
    );
    expect(await refusal(email({ email: 'kim@example.org' }, 'newsletter'))).toBe(
      'account_emails_kind',
    );
  });
});
