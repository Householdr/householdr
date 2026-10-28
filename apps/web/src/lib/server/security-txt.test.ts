import { describe, expect, it } from 'vitest';
import { securityTxt } from './security-txt';

// The instance's security.txt (ADR-0017 §11, RFC 9116).

const now = Temporal.Instant.from('2026-10-08T08:00:00.123Z');

describe('securityTxt', () => {
  it('names the contact, when it expires, the policy and where it lives', () => {
    expect(
      securityTxt(
        {
          SECURITY_CONTACT: 'mailto:security@example.org',
          SECURITY_POLICY_URL: 'https://example.org/security',
          ORIGIN: 'https://householdr.example.org',
        },
        now,
      ),
    ).toBe(
      [
        'Contact: mailto:security@example.org',
        'Expires: 2027-04-06T08:00:00Z',
        'Policy: https://example.org/security',
        'Preferred-Languages: en, nl',
        'Canonical: https://householdr.example.org/.well-known/security.txt',
        '',
      ].join('\n'),
    );
  });

  it('leaves out what isn’t set, and is nothing without a contact', () => {
    expect(securityTxt({ SECURITY_CONTACT: 'mailto:security@example.org' }, now)).toBe(
      'Contact: mailto:security@example.org\nExpires: 2027-04-06T08:00:00Z\nPreferred-Languages: en, nl\n',
    );
    expect(securityTxt({}, now)).toBeNull();
  });
});
