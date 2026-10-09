import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { connect, inHousehold, refuseBypass, type Database } from './connection';
import { accounts } from './auth-schema';
import { households, members, parentalConsents, profileGuardians } from './schema';
import { refusal, refusedByRowSecurity, testDatabase, testServerUrl } from './testing';

// Row-level security keeps every household to its own rows (ADR-0008 §9, CODE-17), as a role
// without superuser rights, the way the app connects.

let db: Database;
let owner: Database;
let close: () => Promise<void>;
const ash = '00000000-0000-4000-8000-00000000000a';
const birch = '00000000-0000-4000-8000-00000000000b';
const household = (id: string, name: string) => ({
  id,
  name,
  country: 'BE',
  language: 'nl',
  timeZone: 'Europe/Brussels',
  weekStartDay: 1 as const,
});

beforeAll(async () => {
  ({ db, owner, close } = await testDatabase());
  for (const [id, name, head] of [
    [ash, 'Ash Lane', 'Robin'],
    [birch, 'Birch Court', 'Sam'],
  ] as const) {
    await inHousehold(db, id, async (tx) => {
      await tx.insert(households).values(household(id, name));
      await tx.insert(members).values({ householdId: id, name: head, role: 'head' });
    });
  }
});
afterAll(() => close());

describe('inHousehold (ADR-0008 §9)', () => {
  it('sees only its own household and members', async () => {
    const seen = await inHousehold(db, ash, async (tx) => ({
      households: await tx.select({ name: households.name }).from(households),
      members: await tx.select({ name: members.name }).from(members),
    }));
    expect(seen).toEqual({ households: [{ name: 'Ash Lane' }], members: [{ name: 'Robin' }] });
  });

  it('cannot add a member to another household', async () => {
    expect(
      await refusal(
        inHousehold(db, ash, (tx) =>
          tx.insert(members).values({ householdId: birch, name: 'Alex', role: 'adult' }),
        ),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('cannot move a member to another household, or change one it cannot see', async () => {
    expect(
      await refusal(inHousehold(db, ash, (tx) => tx.update(members).set({ householdId: birch }))),
    ).toBe(refusedByRowSecurity);
    const renamed = await inHousehold(db, ash, (tx) =>
      tx.update(members).set({ name: 'Taken' }).where(eq(members.name, 'Sam')).returning(),
    );
    expect(renamed).toEqual([]);
  });

  it('cannot delete another household', async () => {
    const deleted = await inHousehold(db, ash, (tx) =>
      tx.delete(households).where(eq(households.id, birch)).returning(),
    );
    expect(deleted).toEqual([]);
  });

  it('ends with its transaction: outside it, nothing is seen or written', async () => {
    await inHousehold(db, ash, (tx) => tx.select().from(members));
    expect(await db.select().from(members)).toEqual([]);
    expect(await db.select().from(households)).toEqual([]);
    expect(
      await refusal(db.insert(members).values({ householdId: ash, name: 'Alex', role: 'adult' })),
    ).toBe(refusedByRowSecurity);
  });

  it('rolls back what it wrote when its work fails', async () => {
    await expect(
      inHousehold(db, ash, async (tx) => {
        await tx.insert(members).values({ householdId: ash, name: 'Alex', role: 'adult' });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    const names = await inHousehold(db, ash, (tx) =>
      tx.select({ name: members.name }).from(members),
    );
    expect(names).toEqual([{ name: 'Robin' }]);
  });

  it('refuses an id that is not a household id', async () => {
    await expect(
      inHousehold(db, "x' or 1=1 --", (tx) => tx.select().from(members)),
    ).rejects.toThrow(RangeError);
  });
});

describe('connect (ADR-0008 §9)', () => {
  it('refuses a superuser, whom row-level security does not bind', async () => {
    await expect(connect(testServerUrl())).rejects.toThrow('bypasses row-level security');
  });

  it('refuses the owner of the tables, whom row-level security does not bind', async () => {
    await expect(refuseBypass(owner.$client)).rejects.toThrow('householdr_test owns the tables');
  });

  // The server's own superuser also has BYPASSRLS, so each attribute gets a role of its own.
  it.each([
    ['a superuser without BYPASSRLS', 'householdr_test_superuser', 'superuser nobypassrls'],
    ['a role with BYPASSRLS', 'householdr_test_bypass', 'nosuperuser bypassrls'],
  ])('refuses %s', async (_, role, attributes) => {
    const admin = new pg.Client({ connectionString: testServerUrl() });
    await admin.connect();
    try {
      await admin.query(`drop role if exists ${role}`);
      await admin.query(`create role ${role} nologin ${attributes}`);
      const pool = new pg.Pool({ connectionString: testServerUrl(), options: `-c role=${role}` });
      try {
        await expect(refuseBypass(pool)).rejects.toThrow(`${role} bypasses`);
      } finally {
        await pool.end();
      }
    } finally {
      await admin.query(`drop role if exists ${role}`);
      await admin.end();
    }
  });
});

describe('every household-owned table (CODE-17)', () => {
  it('has a household id, row-level security and a policy', async () => {
    const { rows } = await db.execute<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
      scoped: boolean;
    }>(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
        c.relname = 'households' or exists (
          select from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped
        ) as scoped
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`);
    expect(rows.map((r) => r.table)).toEqual([
      'activity_log',
      'households',
      'invitations',
      'members',
      'parental_consents',
      'profile_guardians',
    ]);
    for (const row of rows) {
      // Not forced: it binds the app's role, not the owner (ADR-0008 §9, clarification).
      expect(row).toEqual({
        table: row.table,
        enabled: true,
        forced: false,
        policies: 1,
        scoped: true,
      });
    }
  });
});

describe('the two roles (ADR-0008 §9, clarification)', () => {
  it('leave the owner, which runs the migrations, unbound by row-level security', async () => {
    const names = await owner.select({ name: members.name }).from(members).orderBy(members.name);
    expect(names).toEqual([{ name: 'Robin' }, { name: 'Sam' }]);
  });

  it('let the app read and write data, but never change the schema', async () => {
    for (const statement of [
      sql`create table extra (id uuid)`,
      sql`alter table members add column extra text`,
      sql`alter table members disable row level security`,
      sql`drop table auth.rate_limits`,
    ]) {
      // PostgreSQL's code for a missing privilege: here, owning the table or schema.
      expect(await refusal(db.execute(statement))).toBe('42501');
    }
  });
});

describe('tables outside a household (ADR-0008 §9, clarification)', () => {
  it('are the account tables, rate-limit counts and account e-mails in auth, and no others', async () => {
    // `drizzle` holds the list of migrations that have run, and `pgboss` the job queue, whose jobs
    // carry IDs only (ADR-0014 §7, clarification) and whose tables change with pg-boss itself.
    const { rows } = await db.execute<{ name: string }>(sql`
      select n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('public', 'drizzle', 'pgboss', 'pg_catalog', 'information_schema')
        and n.nspname not like 'pg_toast%'
      order by name`);
    expect(rows.map((r) => r.name)).toEqual([
      'auth.account_emails',
      'auth.accounts',
      'auth.credentials',
      'auth.passkeys',
      'auth.rate_limits',
      'auth.sessions',
      'auth.verifications',
    ]);
  });
});

describe('guardians and consents of children’s profiles (ADR-0010 §9, ADR-0008 §9)', () => {
  // Two more households, each with a child whose guardian consented, so the rows above stay as
  // they are.
  const cedar = '00000000-0000-4000-8000-00000000000c';
  const dogwood = '00000000-0000-4000-8000-00000000000d';
  const children = new Map<string, { memberId: string; accountId: string }>();
  const theirs = (id: string) => {
    const child = children.get(id);
    if (!child) throw new Error('No child');
    return child;
  };
  const consent = (householdId: string, { memberId, accountId }: ReturnType<typeof theirs>) => ({
    householdId,
    memberId,
    givenBy: accountId,
    givenAt: new Date('2026-10-08T08:00:00Z'),
    text: 'I have parental responsibility for this child, and I agree to them using Householdr.',
    language: 'en',
  });

  beforeAll(async () => {
    for (const [id, name] of [
      [cedar, 'Cedar Row'],
      [dogwood, 'Dogwood Way'],
    ] as const) {
      const [account] = await db
        .insert(accounts)
        .values({ name: 'Robin', email: `robin-${id}@example.org`, culture: 'en-BE' })
        .returning({ id: accounts.id });
      if (!account) throw new Error('No account');
      const memberId = await inHousehold(db, id, async (tx) => {
        await tx.insert(households).values(household(id, name));
        const [child] = await tx
          .insert(members)
          .values({ householdId: id, name: 'Kim', role: 'child', birthDate: '2016-03-01' })
          .returning({ id: members.id });
        if (!child) throw new Error('No child');
        return child.id;
      });
      children.set(id, { memberId, accountId: account.id });
      await inHousehold(db, id, async (tx) => {
        await tx
          .insert(profileGuardians)
          .values({ householdId: id, memberId, accountId: account.id });
        await tx.insert(parentalConsents).values(consent(id, theirs(id)));
      });
    }
  });

  it('are seen only in their own household', async () => {
    const seen = await inHousehold(db, cedar, async (tx) => ({
      guardians: await tx.select({ memberId: profileGuardians.memberId }).from(profileGuardians),
      consents: await tx.select({ memberId: parentalConsents.memberId }).from(parentalConsents),
    }));
    const { memberId } = theirs(cedar);
    expect(seen).toEqual({ guardians: [{ memberId }], consents: [{ memberId }] });
  });

  it('cannot be added to another household', async () => {
    const other = theirs(dogwood);
    const guardian = { householdId: dogwood, ...other };
    expect(
      await refusal(inHousehold(db, cedar, (tx) => tx.insert(profileGuardians).values(guardian))),
    ).toBe(refusedByRowSecurity);
    expect(
      await refusal(
        inHousehold(db, cedar, (tx) => tx.insert(parentalConsents).values(consent(dogwood, other))),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('cannot be changed, moved or deleted from another household', async () => {
    const { memberId } = theirs(dogwood);
    const touched = await inHousehold(db, cedar, async (tx) => [
      ...(await tx
        .update(parentalConsents)
        .set({ text: 'Changed.' })
        .where(eq(parentalConsents.memberId, memberId))
        .returning()),
      ...(await tx
        .delete(profileGuardians)
        .where(eq(profileGuardians.memberId, memberId))
        .returning()),
    ]);
    expect(touched).toEqual([]);
    expect(
      await refusal(
        inHousehold(db, cedar, (tx) => tx.update(parentalConsents).set({ householdId: dogwood })),
      ),
    ).toBe(refusedByRowSecurity);
  });

  it('are nothing outside a household', async () => {
    expect(await db.select().from(profileGuardians)).toEqual([]);
    expect(await db.select().from(parentalConsents)).toEqual([]);
  });
});
