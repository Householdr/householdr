import type { HouseholdSignUpContext } from '@householdr/auth';
import { signUpLinkTo, testSignInContext } from '@householdr/auth/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

// The first step of setting up a household knows whether the sign-up link still works (ADR-0010
// §1, clarification), and asks to accept the instance's terms only where it has them (ADR-0007
// §2, clarification), against a real database (TEST-11).

let test: Awaited<ReturnType<typeof testSignInContext>>;
let terms: HouseholdSignUpContext['terms'] = null;
vi.mock('#lib/server/auth.js', () => ({
  authContext: () => Promise.resolve({ ...test.context, terms }),
}));

beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(() => test.close());

/** Opens the page with `token` in the cookie, the flag on unless said otherwise. */
const open = (token: string | undefined, flags = { onboarding: true }) =>
  load({
    locals: { flags },
    cookies: {
      get: (name: string) => (name === '__Host-householdr.sign-up' ? token : undefined),
    },
  } as unknown as Parameters<typeof load>[0]);

describe('setting up a household, from a sign-up link (ADR-0007 §2)', () => {
  it('isn’t there while its flag is off (CODE-20)', async () => {
    await expect(open('a-token', { onboarding: false })).rejects.toMatchObject({ status: 404 });
  });

  it('knows the address the link confirmed, and offers the languages households can have (ADR-0016 §1)', async () => {
    const token = await signUpLinkTo(test.context, 'new@example.org');
    expect(await open(token)).toEqual({
      email: 'new@example.org',
      languages: ['en'],
      terms: null,
    });
  });

  it('says when there is no link, or one that doesn’t work', async () => {
    expect(await open(undefined)).toMatchObject({ email: null });
    expect(await open('made-up')).toMatchObject({ email: null });
  });

  it('links to the instance’s terms, where it has them (ADR-0021 §5, clarification)', async () => {
    terms = { url: 'https://householdr.example.org/terms', version: '2026-10-01' };
    const token = await signUpLinkTo(test.context, 'terms@example.org');
    expect(await open(token)).toMatchObject({ terms: 'https://householdr.example.org/terms' });
    terms = null;
    expect(await open(token)).toMatchObject({ terms: null });
  });
});
