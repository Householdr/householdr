import { describe, expect, it } from 'vitest';
import { authContext } from './auth';

describe('authContext (ADR-0008 §13)', () => {
  it('names a missing setting, and tries again on the next request', async () => {
    await expect(authContext({})).rejects.toThrow('Set DATABASE_URL');
    await expect(authContext({ DATABASE_URL: 'postgres://localhost/householdr' })).rejects.toThrow(
      'Set ORIGIN',
    );
  });

  it('takes the terms’ link and version together, or neither (ADR-0021 §5, clarification)', async () => {
    const settings = {
      DATABASE_URL: 'postgres://localhost/householdr',
      ORIGIN: 'https://householdr.example.org',
      SESSION_SECRET: 'a secret',
    };
    const both = 'Set both TERMS_URL and TERMS_VERSION, or neither';
    await expect(
      authContext({ ...settings, TERMS_URL: 'https://householdr.example.org/terms' }),
    ).rejects.toThrow(both);
    await expect(authContext({ ...settings, TERMS_VERSION: '2026-10-01' })).rejects.toThrow(both);
  });
});
