/**
 * The keys that encrypt the secrets of authenticator apps and the recovery codes, by version, and
 * the version that encrypts new ones (ADR-0017 §7). A key is rotated by adding a new version and
 * making it current; the old one stays until nothing encrypted with it is left (.env.example).
 */
export interface TotpKeys {
  current: number;
  keys: ReadonlyMap<number, string>;
}

const version = /^\d+$/;

/**
 * The keys of `TOTP_ENCRYPTION_KEYS`, written `version:key` and separated by commas, with the
 * version `TOTP_ENCRYPTION_KEY_CURRENT` names as current. Errors never repeat a key.
 */
export function totpKeys(list: string, current: string): TotpKeys {
  const keys = new Map<number, string>();
  for (const entry of list.split(',')) {
    const separator = entry.indexOf(':');
    const number = entry.slice(0, Math.max(separator, 0)).trim();
    const key = entry.slice(separator + 1).trim();
    if (!version.test(number) || !key) {
      throw new Error(
        'Write TOTP_ENCRYPTION_KEYS as version:key, separated by commas (.env.example).',
      );
    }
    if (keys.has(Number(number)))
      throw new Error(`TOTP_ENCRYPTION_KEYS has version ${number} twice.`);
    keys.set(Number(number), key);
  }
  const chosen = current.trim();
  if (!version.test(chosen) || !keys.has(Number(chosen))) {
    throw new Error(
      'Set TOTP_ENCRYPTION_KEY_CURRENT to a version in TOTP_ENCRYPTION_KEYS (.env.example).',
    );
  }
  return { current: Number(chosen), keys };
}
