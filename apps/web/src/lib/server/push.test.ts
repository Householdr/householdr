import { describe, expect, it } from 'vitest';
import { pushPublicKey } from './push';

// The VAPID public key from the instance's settings (ADR-0014 §7, clarification).

const key =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';

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
