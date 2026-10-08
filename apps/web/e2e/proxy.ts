import { createHash } from 'node:crypto';

/**
 * The header the test server takes a request's IP address from, as a production instance behind a
 * proxy does (.env.example).
 */
export const addressHeader = 'x-forwarded-for';

/**
 * What every request of the end-to-end tests carries. The test server runs on plain HTTP, which a
 * production instance only sees behind a proxy that says so; without it, SvelteKit takes requests
 * for HTTPS and refuses form posts as cross-site. The proxy also says where a request comes from.
 */
export const proxyHeaders = { 'x-forwarded-proto': 'http', [addressHeader]: '2001:db8::1' };

/** The test server's own setting for the first of those headers (`e2e/global-setup.ts`). */
export const protocolHeader = 'x-forwarded-proto';

/**
 * The headers of a test's own requests: from an IPv6 network of its own, so that what is limited per
 * IP address (ADR-0017 §5) never carries over from one test to another.
 */
export function ownNetwork(testId: string) {
  const hash = createHash('sha256').update(testId).digest('hex');
  const network = `2001:db8:${hash.slice(0, 4)}:${hash.slice(4, 8)}`;
  return { ...proxyHeaders, [addressHeader]: `${network}::1` };
}
