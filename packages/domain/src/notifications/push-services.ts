/**
 * The push services of the browsers people use, by host (ADR-0017 §6, clarification): Apple,
 * Google and Mozilla by name, and Microsoft's, which give each subscription a host of its own under
 * `notify.windows.com`.
 */
const knownHosts = new Set([
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
]);
const knownDomains = ['.notify.windows.com'];

/** An `https` address's host, with no user, password or port before its path. */
const httpsHost = /^https:\/\/([a-z\d.-]+)(?:[/?#]|$)/i;

/**
 * Whether `endpoint`, a subscription's address, is on one of the known push services, over
 * `https`: no other is saved or sent to (ADR-0017 §6, ADR-0014 §7).
 */
export function isKnownPushService(endpoint: string): boolean {
  const host = httpsHost.exec(endpoint)?.[1]?.toLowerCase();
  if (host === undefined) return false;
  return knownHosts.has(host) || knownDomains.some((domain) => host.endsWith(domain));
}
