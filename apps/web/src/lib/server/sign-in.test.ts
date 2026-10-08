import { describe, expect, it } from 'vitest';
import { signInContext } from './sign-in';

describe('signInContext (ADR-0008 §13)', () => {
  it('names a missing setting, and tries again on the next request', async () => {
    await expect(signInContext({})).rejects.toThrow('Set DATABASE_URL');
    await expect(
      signInContext({ DATABASE_URL: 'postgres://localhost/householdr' }),
    ).rejects.toThrow('Set ORIGIN');
  });
});
