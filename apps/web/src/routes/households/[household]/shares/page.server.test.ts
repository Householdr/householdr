import { addAdult, createHousehold, membership } from '@householdr/application';
import { createTestAccount, testSignInContext } from '@householdr/auth/testing';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

// The shares page maps the shares the member may see, and changes to them, to the page, a failure
// or a status (TEST-4), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
vi.mock('#lib/server/auth.js', () => ({ authContext: () => Promise.resolve(test.context) }));
beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** A household with Robin, its head with two factors, and Sam, an adult's profile. */
const headOf = async () => {
  const accountId = await createTestAccount(test.context.auth, {
    email: `robin-${crypto.randomUUID()}@example.org`,
    password: 'correct horse battery staple',
  });
  const created = await createHousehold(
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
  if (!created.ok) throw new Error('No household');
  const member = await membership(test.context, accountId, created.householdId);
  if (!member) throw new Error('Not a member');
  const head = { ...member, twoFactor: true };
  const { db, clock } = test.context;
  await addAdult({ db, clock, householdId: created.householdId, member: head }, { name: 'Sam' });
  return {
    flags: { shares: true },
    membership: { householdId: created.householdId, member: head },
  };
};

const opened = async (locals: object) => {
  try {
    return await load({ locals } as unknown as Parameters<typeof load>[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

const changed = async (locals: object, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request('https://householdr.example.org/', { method: 'POST', body });
  try {
    return await actions.change({ locals, request } as unknown as Parameters<
      typeof actions.change
    >[0]);
  } catch (thrown) {
    if (isHttpError(thrown)) return thrown.status;
    throw thrown;
  }
};

/** Sam's id, from the page. */
const samIn = async (locals: object) => {
  const page = await opened(locals);
  const sam = typeof page === 'object' ? page.shares.find(({ name }) => name === 'Sam') : undefined;
  if (!sam) throw new Error('No Sam');
  return sam.id;
};

describe('the shares page (ADR-0001 §4, ADR-0018 §4)', () => {
  it('shows a head every share, which they may change, between none and a full share', async () => {
    const head = await headOf();
    expect(await opened(head)).toEqual({
      shares: [
        expect.objectContaining({ name: 'Robin', percent: 100, set: null }),
        expect.objectContaining({ name: 'Sam', percent: 100, set: null }),
      ],
      mayChange: true,
      range: { min: 0, max: 100 },
      you: head.membership.member.id,
    });
  });

  it('isn’t there while its flag is off (CODE-20), and shows anyone else their own share', async () => {
    const head = await headOf();
    expect(await opened({ ...head, flags: { shares: false } })).toBe(404);
    const adult = {
      ...head,
      membership: { ...head.membership, member: { ...head.membership.member, role: 'adult' } },
    };
    expect(await opened(adult)).toMatchObject({
      shares: [{ name: 'Robin' }],
      mayChange: false,
    });
    const sam = await samIn(head);
    expect(await changed(adult, { member: sam, percent: '50', version: '1' })).toBe(403);
    expect(await changed(head, { member: crypto.randomUUID(), percent: '50', version: '1' })).toBe(
      404,
    );
  });

  it('saves a share and puts it back to the default, and says so', async () => {
    const head = await headOf();
    const sam = await samIn(head);
    expect(await changed(head, { member: sam, percent: ' 50 ', version: '1' })).toEqual({
      saved: { id: sam, name: 'Sam' },
    });
    expect(await opened(head)).toMatchObject({
      shares: [{ name: 'Robin' }, { name: 'Sam', percent: 50, set: 50, version: 2 }],
    });
    // Whatever is in the field, the default button saves none (ADR-0001 §4).
    expect(await changed(head, { member: sam, percent: '', use: 'default', version: '2' })).toEqual(
      { saved: { id: sam, name: 'Sam' } },
    );
    expect(await opened(head)).toMatchObject({
      shares: [{ name: 'Robin' }, { name: 'Sam', percent: 100, set: null, version: 3 }],
    });
  });

  it('keeps what was entered when it isn’t a whole percent up to 100 (UI-10)', async () => {
    const head = await headOf();
    const sam = await samIn(head);
    for (const percent of ['', '101', '12.5', 'half']) {
      const refused = await changed(head, { member: sam, percent, version: '1' });
      expect(isActionFailure(refused) && refused).toMatchObject({
        status: 400,
        data: { member: sam, entered: percent, invalid: true },
      });
    }
    expect(await opened(head)).toMatchObject({ shares: [{}, { name: 'Sam', set: null }] });
  });

  it('keeps what was entered on a conflict, with the share now (ADR-0019 §5)', async () => {
    const head = await headOf();
    const sam = await samIn(head);
    await changed(head, { member: sam, percent: '50', version: '1' });
    const late = await changed(head, { member: sam, percent: '70', version: '1' });
    expect(isActionFailure(late) && late).toMatchObject({
      status: 409,
      data: { member: sam, entered: '70', conflict: { id: sam, percent: 50, set: 50, version: 2 } },
    });
  });
});
