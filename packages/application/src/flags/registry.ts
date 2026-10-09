import type { Flag } from './flag';

/**
 * Every flag the app uses (ADR-0015 §4). Code reads flags only through this registry, so a misspelt
 * key is a type error and deleting an entry shows every remaining use (CODE-21).
 */
export const flags = {
  'sign-in': {
    kind: 'release',
    description:
      'Signing in with a password, and the signed-in devices on the security page (ADR-0010 §2, §6).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
  'password-reset': {
    kind: 'release',
    description: 'Choosing a new password with a link by e-mail (ADR-0010 §8).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
  onboarding: {
    kind: 'release',
    description:
      'Signing up with a confirmed e-mail address, and setting up a new household (ADR-0007 §2, ADR-0010 §1).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
  passkeys: {
    kind: 'release',
    description: 'Adding and removing passkeys on the security page (ADR-0010 §2).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
  'household-settings': {
    kind: 'release',
    description: "Changing a household's name, country, time zone and language (ADR-0007 §2).",
    owner: 'Jens',
    expires: '2027-03-31',
  },
  'activity-log': {
    kind: 'release',
    description: "A household's activity log, which every member sees (ADR-0018 §5).",
    owner: 'Jens',
    expires: '2027-03-31',
  },
  shares: {
    kind: 'release',
    description: "Members' shares, which heads set (ADR-0001 §4, ADR-0007 §2 step 6).",
    owner: 'Jens',
    expires: '2027-03-31',
  },
  'two-factor': {
    kind: 'release',
    description:
      'Two-factor codes from an authenticator app, with recovery codes, for accounts with a password: turning them on and off on the security page, and asking for a code after the password and with a new password from a reset link (ADR-0010 §2, §3, §8).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
  tasks: {
    kind: 'release',
    description:
      'A household’s tasks: the list, and heads adding custom tasks on a simple frequency (ADR-0001 §1, ADR-0004 §3–§4, ADR-0007 §2).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
  comparisons: {
    kind: 'release',
    description:
      'The comparison game, for a member’s own burdens, and what their answers change (ADR-0003 §3a, §5).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
} as const satisfies Record<string, Flag>;

export type FlagKey = keyof typeof flags;
