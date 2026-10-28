/**
 * What a push carries (ADR-0014 §6, clarification): a title naming the household, the
 * notification's sentence, and the page of the app it opens. Nothing else.
 */
export interface PushMessage {
  title: string;
  body: string;
  /** A path on this site, such as `/households/…/plan`. */
  path: string;
}

/**
 * The push message in `data`, the decrypted body of a push, or null for anything else. Its page
 * must be a path on this site, so a push can never open another one.
 */
export function pushMessageOf(data: unknown): PushMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { title, body, path } = data as Record<string, unknown>;
  if (typeof title !== 'string' || typeof body !== 'string' || typeof path !== 'string') {
    return null;
  }
  // `//host` and `/\host` would leave the site.
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  return { title, body, path };
}
