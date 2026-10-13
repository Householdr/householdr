type Environment = Record<string, string | undefined>;

/** A P-256 public key, uncompressed (65 bytes, the first 4), in base64url. */
const publicKeyShape = /^B[\w-]{86}$/;

/**
 * The instance's VAPID public key, which a browser subscribes with (ADR-0014 §7, clarification;
 * .env.example), or null without one: the instance then offers no push, and members get e-mail as
 * members without push do (§5). A key that isn't a P-256 public key, uncompressed and in base64url,
 * is a mistake in the settings.
 */
export function pushPublicKey(env: Environment = process.env): string | null {
  const key = env.VAPID_PUBLIC_KEY;
  if (!key) return null;
  if (!publicKeyShape.test(key)) {
    throw new Error('Set VAPID_PUBLIC_KEY to a P-256 public key in base64url, or leave it empty.');
  }
  return key;
}
