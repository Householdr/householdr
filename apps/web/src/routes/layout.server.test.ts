import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

const loaded = (locals: object) => load({ locals } as unknown as Parameters<typeof load>[0]);
const flags = { 'sign-in': true };

// Every page is in English for now (ADR-0016 §1).
describe('the layout data', () => {
  it('passes the request’s flags to every page (ADR-0015 §3)', async () => {
    expect(await loaded({ flags, session: null })).toEqual({ flags, locale: 'en' });
  });

  it('writes values in the page’s language with the account’s conventions (ADR-0008 §6)', async () => {
    const session = { id: 'session', accountId: 'account', culture: 'nl-BE' };
    expect(await loaded({ flags, session })).toEqual({ flags, locale: 'en-BE' });
  });
});
