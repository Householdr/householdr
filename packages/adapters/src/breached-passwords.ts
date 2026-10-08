import { createHash } from 'node:crypto';
import { guardedRequest, type OutboundRequest, type OutboundResult } from './guarded-client';

/** Whether a password is in a known breach; `unknown` when the list can't be reached. */
export type BreachCheck = 'breached' | 'not-breached' | 'unknown';

/**
 * Checks a password against Have I Been Pwned's breached-password list (ADR-0010 §2). Only the
 * first 5 characters of its SHA-1 hash leave the server, never the password or whose it is, and
 * the answer is padded so its size gives nothing away. The caller decides what `unknown` means:
 * for setting a password, accept it and log the miss (ADR-0010 §2, clarification).
 */
export async function checkBreachedPassword(
  password: string,
  request: (request: OutboundRequest) => Promise<OutboundResult> = guardedRequest,
): Promise<BreachCheck> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const result = await request({
    url: `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
    headers: { 'add-padding': 'true' },
    maxBytes: 128 * 1024,
    accept: 'text/plain',
  });
  if (result.kind !== 'response' || result.status !== 200) return 'unknown';
  const suffix = hash.slice(5);
  for (const line of result.body.toString('utf8').split('\n')) {
    const [candidate, count] = line.trim().split(':');
    // Padding lines have a count of 0: they are no breach.
    if (candidate === suffix && Number(count) > 0) return 'breached';
  }
  return 'not-breached';
}
