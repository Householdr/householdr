import type { Flag } from './flag';

/**
 * Every flag the app uses (ADR-0015 §4). Code reads flags only through this registry, so a misspelt
 * key is a type error and deleting an entry shows every remaining use (CODE-21).
 */
export const flags = {
  'sign-in': {
    kind: 'release',
    description: 'Signing in with a password (ADR-0010 §2).',
    owner: 'Jens',
    expires: '2027-03-31',
  },
} as const satisfies Record<string, Flag>;

export type FlagKey = keyof typeof flags;
