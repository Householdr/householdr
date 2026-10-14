import { createECDH } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pushPublicKey } from './push';

// The VAPID public key from the instance's settings (ADR-0014 §7, clarification).

// A P-256 public key of the test's own.
const key = createECDH('prime256v1').generateKeys().toString('base64url');

describe('pushPublicKey', () => {
  it('is the key set, or nothing without one, so the instance offers no push', () => {
    expect(pushPublicKey({ VAPID_PUBLIC_KEY: key })).toBe(key);
    expect(pushPublicKey({})).toBeNull();
    expect(pushPublicKey({ VAPID_PUBLIC_KEY: '' })).toBeNull();
  });

  it('refuses a key that isn’t a P-256 public key', () => {
    expect(() => pushPublicKey({ VAPID_PUBLIC_KEY: 'change-me' })).toThrow('VAPID_PUBLIC_KEY');
    expect(() => pushPublicKey({ VAPID_PUBLIC_KEY: key.slice(0, 40) })).toThrow();
  });
});
