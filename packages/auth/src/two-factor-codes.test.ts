import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { testSignInContext } from './testing';
import { isAppCode } from './two-factor-codes';

// Where no password came first, such as with a reset link (ADR-0010 §8), the app's codes are
// checked without the library's step, and must be taken exactly as the library takes them at
// sign-in (§2). These pin the two together, at fixed times (TEST-2).

let test: Awaited<ReturnType<typeof testSignInContext>>;

beforeAll(async () => {
  test = await testSignInContext();
});
afterAll(async () => {
  await test.close();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Secrets of 32 letters and digits, as turning two-factor on makes them: fixed, and plainly not
 * real (TEST-2, TEST-8).
 */
const secret = 'abcd1234'.repeat(4);
const otherSecret = 'wxyz6789'.repeat(4);
const at = Temporal.Instant.from('2026-10-08T08:00:10Z');

/** The code the library makes for `secret` at `when`, which an app set up with it shows. */
async function libraryCode(when: Temporal.Instant) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(when.epochMilliseconds);
  try {
    return (await test.context.auth.api.generateTOTP({ body: { secret } })).code;
  } finally {
    vi.useRealTimers();
  }
}

describe('isAppCode (ADR-0010 §2, §8)', () => {
  it('takes the library’s code for now, and for the 30 seconds before and after', async () => {
    for (const seconds of [-30, 0, 19, 30]) {
      const code = await libraryCode(at.add({ seconds }));
      expect(await isAppCode(secret, code, at)).toBe(true);
    }
  });

  it('refuses codes from further away, another secret’s, and what isn’t a code', async () => {
    for (const seconds of [-60, -41, 50, 60]) {
      expect(await isAppCode(secret, await libraryCode(at.add({ seconds })), at)).toBe(false);
    }
    const now = await libraryCode(at);
    expect(await isAppCode(otherSecret, now, at)).toBe(false);
    for (const typed of ['', now.slice(0, 5), `${now}0`, 'abcdef']) {
      expect(await isAppCode(secret, typed, at)).toBe(false);
    }
  });
});
