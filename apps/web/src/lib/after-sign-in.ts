/**
 * Where signing in leads: back to the invitation it came from (ADR-0010 §5), or else to the
 * account's households (ADR-0005 §1). Only these two, so no address can send anyone elsewhere.
 */
export const afterSignIn = (url: { searchParams: Pick<URLSearchParams, 'get'> }) =>
  url.searchParams.get('next') === 'invitation' ? '/invitation' : '/';
