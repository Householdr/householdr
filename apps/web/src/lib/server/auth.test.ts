import { describe, expect, it } from 'vitest';
import { authContext } from './auth';

describe('authContext (ADR-0008 §13)', () => {
  it('names a missing setting, and tries again on the next request', async () => {
    await expect(authContext({})).rejects.toThrow('Set DATABASE_URL');
    await expect(authContext({ DATABASE_URL: 'postgres://localhost/householdr' })).rejects.toThrow(
      'Set ORIGIN',
    );
  });
});
