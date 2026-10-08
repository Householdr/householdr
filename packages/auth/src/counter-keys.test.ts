import { describe, expect, it } from 'vitest';
import { addressPrefix, counterKeys } from './counter-keys';

// Counts are kept under a keyed hash, and IPv6 by its /64 (ADR-0017 §5, clarification).

describe('counterKeys', () => {
  const key = counterKeys('a secret of at least thirty-two bytes, for tests');

  it('never holds what it counts', () => {
    const made = key('sign-in:email', 'robin@example.org');
    expect(made).not.toContain('robin');
    expect(made).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gives the same value the same key, and other values or kinds another', () => {
    expect(key('sign-in:email', 'robin@example.org')).toBe(
      key('sign-in:email', 'robin@example.org'),
    );
    expect(key('sign-in:email', 'kim@example.org')).not.toBe(
      key('sign-in:email', 'robin@example.org'),
    );
    expect(key('sign-in:address', '192.0.2.1')).not.toBe(key('sign-in:email', '192.0.2.1'));
  });

  it('depends on the secret, so the keys can’t be worked out without it', () => {
    const other = counterKeys('another secret of at least thirty-two bytes, too');
    expect(other('sign-in:email', 'robin@example.org')).not.toBe(
      key('sign-in:email', 'robin@example.org'),
    );
  });
});

describe('addressPrefix', () => {
  it('keeps an IPv4 address whole', () => {
    expect(addressPrefix('192.0.2.1')).toBe('192.0.2.1');
    expect(addressPrefix('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('counts an IPv6 address by its /64, however it is written', () => {
    const prefix = '2001:db8:0:12::/64';
    expect(addressPrefix('2001:db8:0:12::1')).toBe(prefix);
    expect(addressPrefix('2001:0DB8:0000:0012:abcd:ef01:2345:6789')).toBe(prefix);
    expect(addressPrefix('2001:db8:0:12:1::')).toBe(prefix);
    expect(addressPrefix('2001:db8:0:12::192.0.2.1')).toBe(prefix);
    expect(addressPrefix('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(addressPrefix('::1')).toBe('0:0:0:0::/64');
  });

  it('tells neighbouring /64s apart', () => {
    expect(addressPrefix('2001:db8:0:13::1')).not.toBe(addressPrefix('2001:db8:0:12::1'));
  });

  it('refuses what isn’t an IP address', () => {
    expect(() => addressPrefix('example.org')).toThrow();
  });
});
