import { addAdult, createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The page of who is away maps its use cases' results to the page, form errors or a status (TEST-4),
// against a real database (TEST-11), on Thursday 8 October 2026 (the test context's clock).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

const on = { availability: true };

/**
 * A household and its founding head, as the guard leaves them in the request (ADR-0017 §2), with
 * Sam, an adult's profile without an account, whose availability heads manage (ADR-0018 §4).
 */
const founded = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const result = await createHousehold(
    {
      db: test.context.db,
      actor: { account: accountId, twoFactor: true },
      account: { id: accountId, managed: false, guardians: [] },
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
  if (!result.ok) throw new Error(`No household: ${result.error}`);
  const member = await membership(test.context, accountId, result.householdId);
  if (!member) throw new Error('Not a member');
  const head = {
    householdId: result.householdId,
    // Signed in with two factors, as the guard finds them once their account has a passkey.
    member: { ...member, twoFactor: true },
  };
  const sam = await addAdult({ ...test.context, ...head }, { name: 'Sam' });
  if (!sam.ok) throw new Error('No profile');
  return { head, sam: sam.memberId };
};

type Event = Parameters<typeof load>[0];

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Event);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends action `name`'s form with `fields`. */
const send = async (name: keyof typeof actions, locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions[name]({ locals, request } as unknown as Parameters<
      (typeof actions)[typeof name]
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

describe('the page of who is away (ADR-0005 §2, ADR-0018 §3)', () => {
  it('lists every member with their days away, and whose the member opening it manages', async () => {
    const { head, sam } = await founded();
    const locals = { flags: on, membership: head };
    const days = { member: sam, firstDay: '2026-10-12', lastDay: '2026-10-16' };
    expect(await send('add', locals, days)).toEqual({ done: 'added', member: sam });
    const page = await opened(locals);
    expect(page).toEqual({
      household: { periods: [], mayManage: true },
      members: [
        { id: head.member.id, name: 'Robin', role: 'head', absences: [], mayManage: true },
        {
          id: sam,
          name: 'Sam',
          role: 'adult',
          absences: [{ id: expect.any(String) as string, from: '2026-10-12', to: '2026-10-16' }],
          mayManage: true,
        },
      ],
      plannable: { from: '2026-10-08', to: '2027-10-08' },
      you: head.member.id,
    });
  });

  it('is not found until its flag is on (CODE-20), or outside a household', async () => {
    const { head, sam } = await founded();
    const off = { flags: { availability: false }, membership: head };
    expect(await opened(off)).toBe(404);
    expect(await opened({ flags: on, membership: null })).toBe(404);
    const days = { member: sam, firstDay: '2026-10-12', lastDay: '2026-10-16' };
    expect(await send('add', off, days)).toBe(404);
    expect(await send('remove', off, { absence: crypto.randomUUID(), member: sam })).toBe(404);
  });

  it('is forbidden to a member who can’t view it', async () => {
    const { head } = await founded();
    const profile = { ...head, member: { ...head.member, hasAccount: false } };
    expect(await opened({ flags: on, membership: profile })).toBe(403);
  });
});

describe('adding days away', () => {
  it('keeps days that won’t do in the form, and names the fields (UI-10)', async () => {
    const { head, sam } = await founded();
    const days = { member: sam, firstDay: '2026-10-16', lastDay: '2026-10-12' };
    const refused = await send('add', { flags: on, membership: head }, days);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: { ...days, invalid: ['lastDay'] },
    });
    const past = { member: sam, firstDay: '2026-10-07', lastDay: '' };
    const again = await send('add', { flags: on, membership: head }, past);
    expect(isActionFailure(again) && again.data).toEqual({
      ...past,
      invalid: ['firstDay', 'lastDay'],
    });
  });

  it('is forbidden for a member whose days the member acting doesn’t manage (ADR-0018 §4)', async () => {
    const { head, sam } = await founded();
    const withoutTwoFactor = { ...head, member: { ...head.member, twoFactor: false } };
    const days = { member: sam, firstDay: '2026-10-12', lastDay: '2026-10-16' };
    expect(await send('add', { flags: on, membership: withoutTwoFactor }, days)).toBe(403);
    const other = await founded();
    const elsewhere = { ...days, member: other.sam };
    expect(await send('add', { flags: on, membership: head }, elsewhere)).toBe(404);
  });
});

describe('removing days away', () => {
  /** Sam's days away, added by the head; returns their id. */
  const planned = async ({ head, sam }: Awaited<ReturnType<typeof founded>>) => {
    const days = { member: sam, firstDay: '2026-10-12', lastDay: '2026-10-16' };
    await send('add', { flags: on, membership: head }, days);
    const page = await opened({ flags: on, membership: head });
    if (typeof page === 'number') throw new Error('Not opened');
    const id = page.members.find((m) => m.id === sam)?.absences[0]?.id;
    if (!id) throw new Error('Not planned');
    return id;
  };

  it('removes them, and says so; again, says they were already removed', async () => {
    const household = await founded();
    const absence = await planned(household);
    const locals = { flags: on, membership: household.head };
    const fields = { absence, member: household.sam };
    expect(await send('remove', locals, fields)).toEqual({
      done: 'removed',
      member: household.sam,
    });
    expect(await send('remove', locals, fields)).toEqual({
      done: 'already-removed',
      member: household.sam,
    });
    expect(await opened(locals)).toMatchObject({ members: [{}, { absences: [] }] });
  });

  it('is forbidden to a member who doesn’t manage them (ADR-0018 §4)', async () => {
    const household = await founded();
    const absence = await planned(household);
    const withoutTwoFactor = {
      ...household.head,
      member: { ...household.head.member, twoFactor: false },
    };
    const fields = { absence, member: household.sam };
    expect(await send('remove', { flags: on, membership: withoutTwoFactor }, fields)).toBe(403);
    expect(await opened({ flags: on, membership: household.head })).toMatchObject({
      members: [{}, { absences: [{ id: absence }] }],
    });
  });
});

describe('the household away together (ADR-0005 §5)', () => {
  it('adds and removes a period for a head, and says so', async () => {
    const { head } = await founded();
    const locals = { flags: on, membership: head };
    const days = { member: 'household', firstDay: '2026-12-24', lastDay: '2027-01-02' };
    expect(await send('addAway', locals, days)).toEqual({ done: 'added', member: 'household' });
    const page = await opened(locals);
    const periods = typeof page === 'object' ? page.household.periods : [];
    expect(periods).toEqual([
      { id: expect.any(String) as string, from: '2026-12-24', to: '2027-01-02' },
    ]);
    const period = periods[0]?.id ?? '';
    expect(await send('removeAway', locals, { period, member: 'household' })).toEqual({
      done: 'removed',
      member: 'household',
    });
    expect(await send('removeAway', locals, { period, member: 'household' })).toEqual({
      done: 'already-removed',
      member: 'household',
    });
  });

  it('keeps days that won’t do in the form, and names the fields (UI-10)', async () => {
    const { head } = await founded();
    const days = { member: 'household', firstDay: '2026-10-01', lastDay: '2026-09-30' };
    const refused = await send('addAway', { flags: on, membership: head }, days);
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 400,
      data: {
        member: 'household',
        firstDay: '2026-10-01',
        lastDay: '2026-09-30',
        invalid: ['firstDay', 'lastDay'],
      },
    });
  });

  it('is forbidden to anyone but a head (ADR-0005 §5)', async () => {
    const { head } = await founded();
    const adult = { ...head, member: { ...head.member, role: 'adult' } };
    const locals = { flags: on, membership: adult };
    const days = { member: 'household', firstDay: '2026-12-24', lastDay: '2027-01-02' };
    expect(await send('addAway', locals, days)).toBe(403);
    expect(await opened(locals)).toMatchObject({ household: { mayManage: false } });
    expect(
      await send('removeAway', locals, { period: crypto.randomUUID(), member: 'household' }),
    ).toBe(403);
  });
});
