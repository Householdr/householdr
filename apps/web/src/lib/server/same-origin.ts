import { error } from '@sveltejs/kit';

/**
 * Refuses a request from another site (ADR-0017 §4). Form actions have SvelteKit's own check;
 * endpoints, which take JSON, have this one.
 */
export function requireSameOrigin(request: Request, url: URL) {
  if (request.headers.get('origin') !== url.origin) error(403);
}
