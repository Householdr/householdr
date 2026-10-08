import { describe, expect, it } from 'vitest';
import { totpKeys } from './totp-keys';

// The versioned keys that encrypt two-factor secrets, from the environment (ADR-0017 §7).

describe('totpKeys (ADR-0017 §7)', () => {
  it('reads every version and the current one', () => {
    const keys = totpKeys(' 1:first-key , 2:second:key ', '2');
    expect(keys.current).toBe(2);
    expect([...keys.keys]).toEqual([
      [1, 'first-key'],
      [2, 'second:key'],
    ]);
  });

  it('refuses a list it can’t read, without repeating any key in the error', () => {
    for (const list of ['', 'first-key', ':first-key', 'one:first-key', '1:', '1:first-key,']) {
      expect(() => totpKeys(list, '1')).toThrow(
        'Write TOTP_ENCRYPTION_KEYS as version:key, separated by commas',
      );
    }
    expect(() => totpKeys('1:first-key,1:second-key', '1')).toThrow('version 1 twice');
    try {
      totpKeys('1:first-key,1:second-key', '1');
    } catch (error) {
      expect(String(error)).not.toMatch(/first-key|second-key/);
    }
  });

  it('needs the current version to be one of the list', () => {
    for (const current of ['', '3', 'two', '-1']) {
      expect(() => totpKeys('1:first-key,2:second-key', current)).toThrow(
        'Set TOTP_ENCRYPTION_KEY_CURRENT to a version in TOTP_ENCRYPTION_KEYS',
      );
    }
  });
});
