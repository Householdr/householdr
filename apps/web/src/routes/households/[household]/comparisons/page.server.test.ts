import { addTask, createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The comparison game's page maps the next pair and the member's own burdens as an order to the
// page, or to a status, and an answer to its result (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
/** The draw that orders the next pair the page shows: 0 keeps the domain's order (TEST-2). */
let draw = 0;
vi.mock('#lib/server/auth.js', () => ({
  authContext: () => Promise.resolve({ ...test.context, random: { next: () => draw } }),
}));
beforeAll(async () => {
  test = await testSignInContext();
});
beforeEach(() => {
  draw = 0;
});
afterAll(() => test.close());

/**
 * A household in Brussels and its founding head, as the guard leaves them in the request (ADR-0017
 * §2), with two factors, and its tasks with ids by name.
 */
const founded = async (...names: string[]) => {
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
  const found = await membership(test.context, accountId, result.householdId);
  if (!found) throw new Error('Not a member');
  const member = { ...found, twoFactor: true };
  const head = { db: test.context.db, clock: test.context.clock, householdId: result.householdId };
  const tasks: Record<string, string> = {};
  for (const name of names) {
    const added = await addTask(
      { ...head, member },
      { name, duration: 20, frequency: 'weekly', onMiss: 'roll over' },
    );
    if (!added.ok) throw new Error(`Not added: ${added.error}`);
    tasks[name] = added.taskId;
  }
  return { membership: { householdId: result.householdId, member }, tasks };
};

const on = { flags: { comparisons: true } };

/** Opens the page, after `skipped` pairs if given. */
const opened = async (locals: object, skipped?: string) => {
  const url = new URL('https://householdr.example.org/');
  if (skipped !== undefined) url.searchParams.set('skipped', skipped);
  try {
    return await load({ locals, url } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sends an answer: the pair `tasks`, and `harder`. */
const answer = async (locals: object, tasks: string[], harder: string) => {
  const body = new FormData();
  for (const task of tasks) body.append('tasks', task);
  body.set('harder', harder);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.answer({ locals, request } as unknown as Parameters<
      typeof actions.answer
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** The page's pair, by name. */
const pairOf = (page: Awaited<ReturnType<typeof opened>>) =>
  typeof page === 'number' ? page : page.pair?.map((task) => task.name);

describe('the comparison game’s page (ADR-0003 §3a, §5)', () => {
  it('asks about two tasks, and shows that nothing was answered yet', async () => {
    const { membership: member, tasks } = await founded('Dishes', 'Ironing');
    expect(await opened({ ...on, membership: member })).toEqual({
      household: 'Ash Lane',
      pair: [
        { id: tasks.Dishes, name: 'Dishes' },
        { id: tasks.Ironing, name: 'Ironing' },
        // The task with the lower id first, which a draw of 0 keeps.
      ].sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : 1)),
      skipped: 0,
      answered: false,
      hardestFirst: [
        { id: tasks.Dishes, name: 'Dishes' },
        { id: tasks.Ironing, name: 'Ironing' },
      ],
    });
  });

  it('shows the pair in the order the draw says, and saves the task chosen from either (ADR-0003 §3a, clarification)', async () => {
    const { membership: member, tasks } = await founded('Dishes', 'Ironing');
    const { Dishes = '', Ironing = '' } = tasks;
    const shown = async (chosen: number) => {
      draw = chosen;
      const page = await opened({ ...on, membership: member });
      if (typeof page === 'number' || !page.pair) throw new Error('No pair');
      return page.pair.map((task) => task.id);
    };
    const kept = await shown(0.25);
    const swapped = await shown(0.75);
    expect(swapped).toEqual(kept.toReversed());
    for (const pair of [kept, swapped]) {
      // As the page sends it, in the order shown, and in the other order, as a changed page might.
      for (const sent of [pair, pair.toReversed()]) {
        expect(await answer({ ...on, membership: member }, sent, Ironing)).toEqual({
          answered: { harder: 'Ironing', easier: 'Dishes' },
        });
      }
    }
    expect(await answer({ ...on, membership: member }, swapped, Dishes)).toEqual({
      answered: { harder: 'Dishes', easier: 'Ironing' },
    });
    expect(await opened({ ...on, membership: member })).toMatchObject({
      hardestFirst: [{ name: 'Ironing' }, { name: 'Dishes' }],
    });
  });

  it('asks nothing while the household has fewer than two tasks', async () => {
    const { membership: member } = await founded('Dishes');
    expect(await opened({ ...on, membership: member })).toMatchObject({ pair: null });
  });

  it('saves an answer, says which, and shows what it changes as an order, without figures', async () => {
    const { membership: member, tasks } = await founded('Dishes', 'Ironing');
    const { Dishes = '', Ironing = '' } = tasks;
    expect(await answer({ ...on, membership: member }, [Dishes, Ironing], Ironing)).toEqual({
      answered: { harder: 'Ironing', easier: 'Dishes' },
    });
    const page = await opened({ ...on, membership: member });
    expect(page).toMatchObject({ answered: true });
    // Exactly the tasks, by name: nothing else about them reaches the page (ADR-0003 §5,
    // clarification).
    expect(typeof page === 'number' ? page : page.hardestFirst).toEqual([
      { id: Ironing, name: 'Ironing' },
      { id: Dishes, name: 'Dishes' },
    ]);
  });

  it('asks another pair after a skip, and refuses a skip that isn’t a number', async () => {
    const { membership: member } = await founded('Dishes', 'Ironing', 'Vacuum');
    const asked = [
      pairOf(await opened({ ...on, membership: member })),
      pairOf(await opened({ ...on, membership: member }, '1')),
      pairOf(await opened({ ...on, membership: member }, '2')),
    ];
    expect(new Set(asked.map(String)).size).toBe(3);
    expect(await opened({ ...on, membership: member }, '1')).toMatchObject({ skipped: 1 });
    for (const skipped of ['-1', 'one', '1.5']) {
      expect(await opened({ ...on, membership: member }, skipped)).toBe(400);
    }
  });

  it('says an answer wasn’t saved when it isn’t two of the household’s tasks', async () => {
    const { membership: member, tasks } = await founded('Dishes', 'Ironing');
    const { Dishes = '', Ironing = '' } = tasks;
    const elsewhere = await founded('Windows', 'Vacuum');
    const { Windows = '' } = elsewhere.tasks;
    for (const [pair, harder] of [
      [[Dishes, Dishes], Dishes],
      [[Dishes, Windows], Windows],
      [[Dishes], Dishes],
      [[Dishes, Ironing], ''],
    ] as const) {
      const refused = await answer({ ...on, membership: member }, [...pair], harder);
      expect(isActionFailure(refused) && refused).toMatchObject({
        status: 400,
        data: { refused: true },
      });
    }
    expect(await opened({ ...on, membership: member })).toMatchObject({ answered: false });
  });

  it('shows each member only their own answers, heads’ included', async () => {
    const { membership: head, tasks } = await founded('Dishes', 'Ironing');
    const { Dishes = '', Ironing = '' } = tasks;
    // Another member of the household, as the guard would find them.
    const adult = { ...head, member: { ...head.member, id: crypto.randomUUID(), role: 'adult' } };
    expect(await answer({ ...on, membership: head }, [Dishes, Ironing], Ironing)).toMatchObject({
      answered: {},
    });
    expect(await opened({ ...on, membership: adult })).toMatchObject({
      answered: false,
      hardestFirst: [{ name: 'Dishes' }, { name: 'Ironing' }],
    });
  });

  it('is forbidden to a profile without an account', async () => {
    const { membership: member, tasks } = await founded('Dishes', 'Ironing');
    const { Dishes = '', Ironing = '' } = tasks;
    const profile = { ...member, member: { ...member.member, hasAccount: false } };
    expect(await opened({ ...on, membership: profile })).toBe(403);
    expect(await answer({ ...on, membership: profile }, [Dishes, Ironing], Ironing)).toBe(403);
  });

  it('is not found until the game’s flag is on (CODE-20), or outside a household', async () => {
    const { membership: member, tasks } = await founded('Dishes', 'Ironing');
    const { Dishes = '', Ironing = '' } = tasks;
    const off = { flags: { comparisons: false } };
    expect(await opened({ ...off, membership: member })).toBe(404);
    expect(await answer({ ...off, membership: member }, [Dishes, Ironing], Ironing)).toBe(404);
    expect(await opened({ ...on, membership: null })).toBe(404);
    expect(await answer({ ...on, membership: null }, [Dishes, Ironing], Ironing)).toBe(404);
  });
});
