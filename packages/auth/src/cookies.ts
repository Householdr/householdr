import { parseSetCookieHeader } from 'better-auth/cookies';

/** A cookie for the web app to set through its framework, with the attributes the library chose. */
export interface Cookie {
  name: string;
  value: string;
  options: {
    path: string;
    maxAge?: number;
    expires?: Date;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  };
}

/**
 * The cookies the library sets in `headers`, such as a new session's (ADR-0017 §4). The web app sets
 * them through SvelteKit's cookies, which won't pass on a `Set-Cookie` header as it is.
 */
export function cookiesFrom(headers: Headers): Cookie[] {
  return headers.getSetCookie().flatMap((header) =>
    Array.from(parseSetCookieHeader(header), ([name, attributes]) => ({
      name,
      value: attributes.value,
      options: {
        path: attributes.path ?? '/',
        maxAge: attributes['max-age'],
        expires: attributes.expires,
        secure: attributes.secure,
        httpOnly: attributes.httponly,
        sameSite: attributes.samesite,
      },
    })),
  );
}
