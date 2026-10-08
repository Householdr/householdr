/**
 * What every request of the end-to-end tests carries. The test server runs on plain HTTP, which a
 * production instance only sees behind a proxy that says so; without it, SvelteKit takes requests
 * for HTTPS and refuses form posts as cross-site.
 */
export const proxyHeaders = { 'x-forwarded-proto': 'http' };

/** The test server's own setting for that header (`e2e/global-setup.ts`). */
export const protocolHeader = 'x-forwarded-proto';
