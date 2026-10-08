import type { HouseholdCalendar } from '@householdr/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inHousehold, type Database, type Transaction } from './connection';
import { accountEmails, accounts, sessions, twoFactors } from './auth-schema';
import {
  absences,
  comparisons,
  households,
  members,
  parentalConsents,
  profileGuardians,
  schedules,
  tasks,
  temporaryShares,
  type StoredRule,
} from './schema';
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

  it('keeps a share a head set within none to a full one (ADR-0001 §4)', async () => {
    expect(
      await refusal(addMember({ name: 'Alex', role: 'adult', sharePercent: 0 })),
    ).toBeUndefined();
    expect(
      await refusal(addMember({ name: 'Alex', role: 'adult', sharePercent: 100 })),
    ).toBeUndefined();
    expect(await refusal(addMember({ name: 'Alex', role: 'adult', sharePercent: 101 }))).toBe(
      'members_share_percent',
    );
    expect(await refusal(addMember({ name: 'Alex', role: 'adult', sharePercent: -1 }))).toBe(
      'members_share_percent',
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

describe('schedules and tasks (ADR-0001 §1, ADR-0004)', () => {
  type NewSchedule = Omit<typeof schedules.$inferInsert, 'householdId'>;
  type NewTask = Omit<typeof tasks.$inferInsert, 'householdId' | 'scheduleId'>;
  const weekly: StoredRule = { rrule: 'FREQ=WEEKLY', start: '2026-10-08' };
  const vacuum = { name: 'Vacuum', duration: 30, timing: 'flexible', onMiss: 'roll over' } as const;
  /** A schedule in a household of its own. */
  const addSchedule = (fields: NewSchedule) => {
    const id = newId();
    return inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      return tx
        .insert(schedules)
        .values({ householdId: id, ...fields })
        .returning();
    });
  };
  /** A task on a weekly schedule, in a household of its own. */
  const addTask = (fields: Partial<NewTask> = {}) => {
    const id = newId();
    return inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      const [schedule] = await tx
        .insert(schedules)
        .values({ householdId: id, rules: [weekly] })
        .returning();
      if (!schedule) throw new Error('No schedule');
      return tx
        .insert(tasks)
        .values({ householdId: id, scheduleId: schedule.id, ...vacuum, ...fields })
        .returning();
    });
  };

  it('stores a schedule with its rules and dates, at version 1 (ADR-0004 §2)', async () => {
    const pmd: StoredRule = {
      rrule: 'FREQ=MONTHLY;BYDAY=2TU,4TU',
      start: '2026-01-01',
      season: { from: '09-01', to: '06-30' },
    };
    const [row] = await addSchedule({
      rules: [pmd, weekly],
      extraDates: ['2026-12-24'],
      exceptionDates: ['2026-12-22'],
    });
    expect(row).toMatchObject({
      rules: [pmd, weekly],
      extraDates: ['2026-12-24'],
      exceptionDates: ['2026-12-22'],
      version: 1,
    });
  });

  it('keeps rules well formed: an RRULE, a start date and both ends of a season', async () => {
    const broken = 'schedules_rules';
    const rules = (value: unknown) => ({ rules: value as StoredRule[] });
    for (const value of [
      { rrule: 'FREQ=WEEKLY', start: '2026-10-08' },
      ['FREQ=WEEKLY'],
      [{ start: '2026-10-08' }],
      [{ rrule: '', start: '2026-10-08' }],
      [{ rrule: 42, start: '2026-10-08' }],
      [{ rrule: 'FREQ=WEEKLY' }],
      [{ rrule: 'FREQ=WEEKLY', start: '8 October 2026' }],
      [{ ...weekly, season: { from: '07-01' } }],
      [{ ...weekly, season: { from: '07-01', to: 'August' } }],
      [weekly, { rrule: 'FREQ=DAILY' }],
    ]) {
      expect(await refusal(addSchedule(rules(value)))).toBe(broken);
    }
  });

  it('produces dates: from a rule, or from extra dates only', async () => {
    expect(await refusal(addSchedule({ rules: [] }))).toBe('schedules_dates');
    expect(await refusal(addSchedule({ rules: [], exceptionDates: ['2026-12-22'] }))).toBe(
      'schedules_dates',
    );
    expect(await refusal(addSchedule({ rules: [], extraDates: ['2026-12-24'] }))).toBeUndefined();
  });

  it('stores a task on its schedule, at version 1', async () => {
    const [row] = await addTask();
    expect(row).toMatchObject({ ...vacuum, version: 1 });
  });

  it('needs a name, a duration from a minute to a day, a timing and an on-miss policy', async () => {
    expect(await refusal(addTask({ name: '' }))).toBe('tasks_name');
    for (const duration of [1, 1440]) expect(await refusal(addTask({ duration }))).toBeUndefined();
    for (const duration of [0, -30, 1441]) {
      expect(await refusal(addTask({ duration }))).toBe('tasks_duration');
    }
    expect(await refusal(addTask({ timing: 'floating' }))).toBeUndefined();
    // Fixed windows come with the columns for their times (ADR-0004 §4).
    for (const timing of ['fixed', 'sometimes']) {
      expect(await refusal(addTask({ timing: timing as 'flexible' }))).toBe('tasks_timing');
    }
    expect(await refusal(addTask({ onMiss: 'lapse' }))).toBeUndefined();
    expect(await refusal(addTask({ onMiss: 'skip' as 'lapse' }))).toBe('tasks_on_miss');
  });

  it('keeps a schedule while a task uses it, and both go with their household', async () => {
    const id = newId();
    const left = await inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      const [schedule] = await tx
        .insert(schedules)
        .values({ householdId: id, rules: [weekly] })
        .returning();
      if (!schedule) throw new Error('No schedule');
      await tx.insert(tasks).values({ householdId: id, scheduleId: schedule.id, ...vacuum });
      await tx.delete(households);
      return { schedules: await tx.select().from(schedules), tasks: await tx.select().from(tasks) };
    });
    expect(left).toEqual({ schedules: [], tasks: [] });
    const [task] = await addTask();
    if (!task) throw new Error('No task');
    expect(await refusal(inHousehold(db, task.householdId, (tx) => tx.delete(schedules)))).toBe(
      'tasks_schedule',
    );
  });
});

describe('comparisons (ADR-0003 §3a, ADR-0012 §5)', () => {
  const answeredAt = new Date('2026-10-08T08:00:00Z');
  /**
   * A household of its own with a member, Robin, and two tasks, Dishes and Ironing, and an answer
   * of Robin's that ironing is harder.
   */
  const answered = async () => {
    const id = newId();
    return inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      const [member] = await tx
        .insert(members)
        .values({ householdId: id, name: 'Robin', role: 'head' })
        .returning();
      const [schedule] = await tx
        .insert(schedules)
        .values({ householdId: id, rules: [{ rrule: 'FREQ=WEEKLY', start: '2026-10-08' }] })
        .returning();
      if (!member || !schedule) throw new Error('No member or schedule');
      const task = { householdId: id, scheduleId: schedule.id, duration: 30 } as const;
      const [dishes, ironing] = await tx
        .insert(tasks)
        .values(
          ['Dishes', 'Ironing'].map((name) => ({
            ...task,
            name,
            timing: 'flexible' as const,
            onMiss: 'roll over' as const,
          })),
        )
        .returning();
      if (!dishes || !ironing) throw new Error('No tasks');
      const [row] = await tx
        .insert(comparisons)
        .values({
          householdId: id,
          memberId: member.id,
          harderTaskId: ironing.id,
          easierTaskId: dishes.id,
          answeredAt,
        })
        .returning();
      if (!row) throw new Error('No answer');
      return { id, member: member.id, dishes: dishes.id, ironing: ironing.id, row };
    });
  };
  /** What is left of household `id`'s answers once `work` ran in it. */
  const leftAfter = (id: string, work: (tx: Transaction) => Promise<unknown>) =>
    inHousehold(db, id, async (tx) => {
      await work(tx);
      return tx.select().from(comparisons);
    });

  it('stores which task is harder for whom, and when', async () => {
    const { member, dishes, ironing, row } = await answered();
    expect(row).toEqual({
      id: expect.any(String) as unknown,
      householdId: row.householdId,
      memberId: member,
      harderTaskId: ironing,
      easierTaskId: dishes,
      answeredAt,
    });
  });

  it('compares two different tasks', async () => {
    const { id, member, ironing } = await answered();
    expect(
      await refusal(
        inHousehold(db, id, (tx) =>
          tx.insert(comparisons).values({
            householdId: id,
            memberId: member,
            harderTaskId: ironing,
            easierTaskId: ironing,
            answeredAt,
          }),
        ),
      ),
    ).toBe('comparisons_two_tasks');
  });

  it('go with the member’s profile, with either task and with the household', async () => {
    const byMember = await answered();
    expect(
      await leftAfter(byMember.id, (tx) =>
        tx.delete(members).where(eq(members.id, byMember.member)),
      ),
    ).toEqual([]);
    for (const task of ['dishes', 'ironing'] as const) {
      const byTask = await answered();
      expect(
        await leftAfter(byTask.id, (tx) => tx.delete(tasks).where(eq(tasks.id, byTask[task]))),
      ).toEqual([]);
    }
    const byHousehold = await answered();
    expect(await leftAfter(byHousehold.id, (tx) => tx.delete(households))).toEqual([]);
  });
});

describe('absences (ADR-0005 §2)', () => {
  /** A household with one member, Robin, and `days` as their absences. Returns its id. */
  const away = async (...days: { firstDay: string; lastDay: string }[]) => {
    const id = newId();
    await inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      const [robin] = await tx
        .insert(members)
        .values({ householdId: id, name: 'Robin', role: 'head' })
        .returning({ id: members.id });
      if (!robin) throw new Error('No member');
      for (const each of days) {
        await tx.insert(absences).values({ householdId: id, memberId: robin.id, ...each });
      }
    });
    return id;
  };
  const daysOf = (id: string) =>
    inHousehold(db, id, (tx) =>
      tx.select({ firstDay: absences.firstDay, lastDay: absences.lastDay }).from(absences),
    );

  it('are whole days, the last not before the first, both included', async () => {
    const id = await away(
      { firstDay: '2026-10-12', lastDay: '2026-10-16' },
      { firstDay: '2026-10-20', lastDay: '2026-10-20' },
    );
    expect(await daysOf(id)).toEqual([
      { firstDay: '2026-10-12', lastDay: '2026-10-16' },
      { firstDay: '2026-10-20', lastDay: '2026-10-20' },
    ]);
    expect(await refusal(away({ firstDay: '2026-10-16', lastDay: '2026-10-15' }))).toBe(
      'absences_days',
    );
  });

  it('store no reason, place or detail (ADR-0012 §2, ADR-0018 §3)', async () => {
    const { rows } = await db.execute<{ name: string }>(sql`
      select column_name as name from information_schema.columns
      where table_schema = 'public' and table_name = 'absences' order by ordinal_position`);
    expect(rows.map((r) => r.name)).toEqual([
      'id',
      'household_id',
      'member_id',
      'first_day',
      'last_day',
    ]);
  });

  it('go with their member’s profile, and with their household', async () => {
    const id = await away({ firstDay: '2026-10-12', lastDay: '2026-10-16' });
    await inHousehold(db, id, (tx) => tx.delete(members));
    expect(await daysOf(id)).toEqual([]);
    const other = await away({ firstDay: '2026-10-12', lastDay: '2026-10-16' });
    await inHousehold(db, other, (tx) => tx.delete(households));
    expect(await daysOf(other)).toEqual([]);
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

  it('keeps two factors encrypted, one per account (ADR-0012 §4, ADR-0017 §7)', async () => {
    const [account] = await addAccount();
    if (!account) throw new Error('No account');
    const twoFactor = (fields: Partial<typeof twoFactors.$inferInsert>) =>
      db.insert(twoFactors).values({
        userId: account.id,
        secret: '$ba$1$0123abcd',
        backupCodes: '$ba$1$4567cdef',
        ...fields,
      });
    expect(await refusal(twoFactor({ secret: 'JBSWY3DPEHPK3PXP' }))).toBe(
      'two_factors_secret_encrypted',
    );
    expect(await refusal(twoFactor({ backupCodes: '["abcde-12345"]' }))).toBe(
      'two_factors_backup_codes_encrypted',
    );
    expect(await refusal(twoFactor({}))).toBeUndefined();
    expect(await refusal(twoFactor({}))).toBe('two_factors_userId_unique');
    const [row] = await db.select().from(twoFactors).where(eq(twoFactors.userId, account.id));
    // Not set up until the first code was right.
    expect(row?.verified).toBe(false);
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

describe('temporary_shares', () => {
  const addTemporaryShare = (
    fields: Pick<typeof temporaryShares.$inferInsert, 'firstDay' | 'lastDay' | 'percent'>,
  ) => {
    const id = newId();
    return inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id));
      const [member] = await tx
        .insert(members)
        .values({ householdId: id, name: 'Sam', role: 'adult' })
        .returning({ id: members.id });
      if (!member) throw new Error('No member');
      await tx.insert(temporaryShares).values({ householdId: id, memberId: member.id, ...fields });
    });
  };

  it('covers at least a day, both included, at a share from none to a full one (ADR-0001 §4)', async () => {
    const week = { firstDay: '2026-10-12', lastDay: '2026-10-18' };
    expect(await refusal(addTemporaryShare({ ...week, percent: 0 }))).toBeUndefined();
    expect(
      await refusal(
        addTemporaryShare({ firstDay: '2026-10-12', lastDay: '2026-10-12', percent: 100 }),
      ),
    ).toBeUndefined();
    expect(
      await refusal(
        addTemporaryShare({ firstDay: '2026-10-12', lastDay: '2026-10-11', percent: 50 }),
      ),
    ).toBe('temporary_shares_days');
    expect(await refusal(addTemporaryShare({ ...week, percent: 101 }))).toBe(
      'temporary_shares_percent',
    );
    expect(await refusal(addTemporaryShare({ ...week, percent: -1 }))).toBe(
      'temporary_shares_percent',
    );
  });
});
