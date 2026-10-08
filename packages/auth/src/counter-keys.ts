import { createHmac, hkdfSync } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/** What a count is for, and what it counts by. */
export type CounterKind = 'sign-in:email' | 'sign-in:address' | 'emails:hour' | 'emails:day';

/** The key a count is stored under, for one kind and value. */
export type CounterKey = (kind: CounterKind, value: string) => string;

/**
 * Keys counts by a keyed hash of what they count, never the e-mail or IP address itself
 * (ADR-0017 §5, clarification). The hash key is derived from the app's secret, for this use only.
 */
export function counterKeys(secret: string): CounterKey {
  const key = Buffer.from(hkdfSync('sha256', secret, '', 'householdr rate-limit counts', 32));
  return (kind, value) => createHmac('sha256', key).update(`${kind}\n${value}`).digest('base64url');
}

/**
 * The part of an IP address a count goes by: an IPv4 address whole, an IPv6 address by its /64
 * prefix, since one connection usually gets a whole /64 (ADR-0017 §5, clarification).
 */
export function addressPrefix(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mapped && isIPv4(mapped)) return mapped;
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) throw new Error('Not an IP address.');
  const [head = '', tail] = address.toLowerCase().split('::');
  const groups = (part = '') => (part ? part.split(':') : []);
  const right = groups(tail);
  // An IPv4 address written at the end stands for two groups.
  const width = right.length + (right.at(-1)?.includes('.') ? 1 : 0);
  const left = groups(head);
  const all = [...left, ...Array<string>(8 - left.length - width).fill('0'), ...right];
  return `${all
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}
