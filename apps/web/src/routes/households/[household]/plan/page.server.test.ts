import {
  addAdult,
  addTask,
  createHousehold,
  draftPlan,
  membership,
  publishPlan,
} from '@householdr/application';
import { createTestAccount, startTestHousehold, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// A household's plan page maps the plans its members may see to the page, or to a status, and the
// form that publishes a draft early to its result (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** A household in Brussels, founded by Robin, a head with two factors. */
const founded = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const { db } = test.context;
  const result = await createHousehold(
    {
      db,
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
  const { householdId } = result;
  const member = await membership(test.context, accountId, householdId);
  if (!member) throw new Error('Not a member');
  return { householdId, member: { ...member, twoFactor: true } };
};

/**
 * A household in Brussels past setup, whose founding head has two factors and a weekly task, with
 * a draft for the week of Monday 12 October 2026: the test clock reads Thursday 8 October.
 */
const drafted = async () => {
  const head = await founded();
  const { householdId } = head;
  const { db, clock } = test.context;
  await addTask(
    { db, clock, ...head },
    { name: 'Vacuum', duration: 30, frequency: 'weekly', start: '2026-10-14', onMiss: 'roll over' },
  );
  await startTestHousehold(db, householdId, '2026-10-12');
  await draftPlan({ db, clock, householdId, member: 'scheduler' }, { week: '2026-10-12' });
  return head;
};

type Membership = Awaited<ReturnType<typeof drafted>>;
const on = { flags: { plans: true, completions: false } };
const asAdult = ({ householdId, member }: Membership) => ({
  householdId,
  member: { ...member, role: 'adult' as const },
});

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends the form that publishes a draft early, with `fields`. */
const publish = async (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.publish({ locals, request } as unknown as Parameters<
      typeof actions.publish
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

describe('a household’s plan page (ADR-0006 §2)', () => {
  it('shows a head next week’s draft, with when it is published and why each task went where', async () => {
    const membership = await drafted();
    expect(await opened({ ...on, membership })).toEqual({
      household: 'Ash Lane',
      timeZone: 'Europe/Brussels',
      thisWeek: null,
      nextWeek: {
        start: '2026-10-12',
        last: '2026-10-18',
        status: 'draft',
        version: 1,
        // Sunday 11 October, 12:00 in Brussels.
        publishAt: Date.parse('2026-10-11T10:00:00Z'),
        members: [
          {
            id: membership.member.id,
            name: 'Robin',
            assignments: [
              {
                id: expect.any(String) as unknown,
                occurrence: expect.any(String) as unknown,
                task: 'Vacuum',
                date: '2026-10-14',
                // A draft is never done from (ADR-0006 §4).
                completable: false,
                completion: null,
                cost: 30,
                reason: 'only eligible member',
              },
            ],
          },
        ],
        unassigned: [],
      },
      mayPublish: true,
      you: membership.member.id,
    });
  });

  it('shows other members no draft, then the plan once a head publishes it', async () => {
    const head = await drafted();
    const adult = asAdult(head);
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      nextWeek: null,
      mayPublish: false,
    });
    expect(await publish({ ...on, membership: adult }, { week: '2026-10-12', version: '1' })).toBe(
      403,
    );
    expect(
      await publish({ ...on, membership: head }, { week: '2026-10-12', version: '1' }),
    ).toEqual({ week: '2026-10-12', published: true });
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      nextWeek: { status: 'published', publishAt: null, members: [{ name: 'Robin' }] },
    });
  });

  it('publishes nothing a head hasn’t seen, and says which week (ADR-0019 §5)', async () => {
    const membership = await drafted();
    const refused = await publish({ ...on, membership }, { week: '2026-10-12', version: '2' });
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 409,
      data: { week: '2026-10-12', problem: 'conflict' },
    });
    const gone = await publish({ ...on, membership }, { week: '2026-10-19', version: '1' });
    expect(isActionFailure(gone) && gone).toMatchObject({
      status: 409,
      data: { week: '2026-10-19', problem: 'not-found' },
    });
    expect(await publish({ ...on, membership }, { week: 'next week', version: '1' })).toBe(400);
    expect(await opened({ ...on, membership })).toMatchObject({ nextWeek: { status: 'draft' } });
  });

  it('is forbidden to a member who can’t view it', async () => {
    const { householdId, member } = await drafted();
    const profile = { householdId, member: { ...member, hasAccount: false } };
    expect(await opened({ ...on, membership: profile })).toBe(403);
    expect(
      await publish({ ...on, membership: profile }, { week: '2026-10-12', version: '1' }),
    ).toBe(403);
  });

  it('is not found until the plans’ flag is on (CODE-20), or outside a household', async () => {
    const membership = await drafted();
    const off = { flags: { plans: false } };
    const fields = { week: '2026-10-12', version: '1' };
    expect(await opened({ ...off, membership })).toBe(404);
    expect(await publish({ ...off, membership }, fields)).toBe(404);
    expect(await opened({ ...on, membership: null })).toBe(404);
    expect(await publish({ ...on, membership: null }, fields)).toBe(404);
  });
});

/**
 * A household in Brussels started this week, Monday 5 October 2026, with dishes every day from
 * today, Thursday 8 October, shared between Robin, its head, and Kim, a profile without an account,
 * in a published plan (ADR-0006 §2).
 */
const published = async () => {
  const head = await founded();
  const { householdId } = head;
  const { db, clock } = test.context;
  const kim = await addAdult({ db, clock, ...head }, { name: 'Kim' });
  if (!kim.ok) throw new Error('No Kim');
  const task = await addTask(
    { db, clock, ...head },
    { name: 'Dishes', duration: 20, frequency: 'daily', start: '2026-10-08', onMiss: 'roll over' },
  );
  if (!task.ok) throw new Error(`No task: ${task.error}`);
  await startTestHousehold(db, householdId, '2026-10-05');
  const scheduler = { db, clock, householdId, member: 'scheduler' as const };
  await draftPlan(scheduler, { week: '2026-10-05' });
  await publishPlan(scheduler, { week: '2026-10-05' });
  return { head, kim: kim.memberId };
};

const withCompletions = { flags: { plans: true, completions: true } };

/** Sends the plan's form `action` with `fields`; a field given a list is sent once per value. */
const send = async (
  action: 'complete' | 'completeBy' | 'undo',
  locals: object,
  fields: Record<string, string | string[]>,
) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of [value].flat()) body.append(name, one);
  }
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions[action]({ locals, request } as unknown as Parameters<
      (typeof actions)[typeof action]
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** The items of this week's plan of `name`, as `locals` sees them. */
const itemsOf = async (locals: object, name: string) => {
  const page = await opened(locals);
  if (typeof page === 'number') throw new Error(`Status ${String(page)}`);
  return page.thisWeek?.members.find((member) => member.name === name)?.assignments ?? [];
};

describe('marking a task done, and undoing it (ADR-0006 §4)', () => {
  it('lets a member mark their own done with one tap, and undo it', async () => {
    const { head } = await published();
    const locals = { ...withCompletions, membership: head };
    const [item] = await itemsOf(locals, 'Robin');
    if (!item) throw new Error('Nothing for Robin');
    expect(item).toMatchObject({ completable: true, completion: null });
    const { occurrence } = item;
    expect(await send('complete', locals, { occurrence })).toEqual({ occurrence, completed: true });
    const [done] = await itemsOf(locals, 'Robin');
    expect(done).toMatchObject({
      occurrence,
      completable: false,
      completion: {
        // Thursday 8 October, 10:00 in Brussels: the time for whom it credits (ADR-0018 §3).
        day: '2026-10-08',
        at: Date.parse('2026-10-08T08:00:00Z'),
        doers: [{ id: head.member.id, name: 'Robin' }],
        loggedBy: { id: head.member.id, name: 'Robin' },
        mayUndo: true,
      },
    });
    const completion = done?.completion?.id ?? '';
    expect(await send('undo', locals, { occurrence, completion })).toEqual({
      occurrence,
      undone: true,
    });
    const refused = await send('undo', locals, { occurrence, completion });
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 409,
      data: { occurrence, problem: 'not-found' },
    });
    expect(await itemsOf(locals, 'Robin')).toContainEqual(
      expect.objectContaining({ occurrence, completable: true, completion: null }),
    );
  });

  it('lets a member mark done whom they choose, and shows others the day only', async () => {
    const { head, kim } = await published();
    const locals = { ...withCompletions, membership: head };
    const [item] = await itemsOf(locals, 'Kim');
    if (!item) throw new Error('Nothing for Kim');
    const { occurrence } = item;
    // Nobody chosen: the choice needs changing (UI-10).
    const none = await send('completeBy', locals, { occurrence });
    expect(isActionFailure(none) && none).toMatchObject({
      status: 400,
      data: { occurrence, problem: 'no-doers' },
    });
    expect(await send('completeBy', locals, { occurrence, doer: [kim] })).toEqual({
      occurrence,
      completed: true,
    });
    // Another member, Kim as if with an account, sees when it was done to the day only, here;
    // Kim's own completion shows the time to Kim.
    const other = { ...withCompletions, membership: asAdult(head) };
    expect(await itemsOf(other, 'Kim')).toContainEqual(
      expect.objectContaining({
        occurrence,
        completion: expect.objectContaining({ day: '2026-10-08', at: null }) as unknown,
      }),
    );
    const asKim = {
      ...withCompletions,
      membership: {
        householdId: head.householdId,
        member: { id: kim, role: 'adult' as const, hasAccount: true, twoFactor: false },
      },
    };
    expect(await itemsOf(asKim, 'Kim')).toContainEqual(
      expect.objectContaining({
        occurrence,
        completion: expect.objectContaining({
          at: Date.parse('2026-10-08T08:00:00Z'),
          mayUndo: true,
        }) as unknown,
      }),
    );
  });

  it('says who did it already, when someone else marked it done first (ADR-0019 §6)', async () => {
    const { head } = await published();
    const locals = { ...withCompletions, membership: head };
    const [item] = await itemsOf(locals, 'Robin');
    if (!item) throw new Error('Nothing for Robin');
    const { occurrence } = item;
    await send('complete', locals, { occurrence });
    const again = await send('completeBy', locals, { occurrence, doer: [head.member.id, ''] });
    expect(again).toBe(400);
    const refused = await send(
      'complete',
      { ...locals, membership: asAdult(head) },
      { occurrence },
    );
    // The same member, the same completion: changing nothing.
    expect(refused).toEqual({ occurrence, completed: true });
    const kimFirst = await published();
    const [kims] = await itemsOf({ ...withCompletions, membership: kimFirst.head }, 'Kim');
    if (!kims) throw new Error('Nothing for Kim');
    const kimsLocals = { ...withCompletions, membership: kimFirst.head };
    await send('completeBy', kimsLocals, { occurrence: kims.occurrence, doer: [kimFirst.kim] });
    const taken = await send('complete', kimsLocals, { occurrence: kims.occurrence });
    expect(isActionFailure(taken) && taken).toMatchObject({
      status: 409,
      data: {
        occurrence: kims.occurrence,
        problem: 'already-done',
        doers: [{ id: kimFirst.kim, name: 'Kim' }],
      },
    });
  });

  it('refuses what can’t be marked done, and a profile without an account (ADR-0018 §4)', async () => {
    const membership = await drafted();
    const locals = { ...withCompletions, membership };
    const draft = await opened(locals);
    if (typeof draft === 'number') throw new Error(`Status ${String(draft)}`);
    const occurrence = draft.nextWeek?.members[0]?.assignments[0]?.occurrence ?? '';
    const refused = await send('complete', locals, { occurrence });
    expect(isActionFailure(refused) && refused).toMatchObject({
      status: 409,
      data: { occurrence, problem: 'not-completable' },
    });
    expect(await send('complete', locals, { occurrence: 'the dishes' })).toBe(400);
    expect(await send('undo', locals, { occurrence, completion: 'the dishes' })).toBe(400);
    const profile = {
      ...withCompletions,
      membership: { ...membership, member: { ...membership.member, hasAccount: false } },
    };
    expect(await send('complete', profile, { occurrence })).toBe(403);
  });

  it('is not there until completions’ flag is on (CODE-20)', async () => {
    const { head } = await published();
    const [item] = await itemsOf({ ...on, membership: head }, 'Robin');
    expect(item).toMatchObject({ completable: false, completion: null });
    const occurrence = item?.occurrence ?? '';
    for (const action of ['complete', 'completeBy', 'undo'] as const) {
      expect(await send(action, { ...on, membership: head }, { occurrence })).toBe(404);
      expect(await send(action, { ...withCompletions, membership: null }, { occurrence })).toBe(
        404,
      );
    }
  });
});
