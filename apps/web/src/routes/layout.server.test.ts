import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

describe('the layout data', () => {
  it('passes the request’s flags to every page (ADR-0015 §3)', async () => {
    const flags = { 'sign-in': true };
    const data = await load({ locals: { flags } } as unknown as Parameters<typeof load>[0]);
    expect(data).toEqual({ flags });
  });
});
