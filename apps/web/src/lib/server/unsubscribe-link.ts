/**
 * The cookie that holds an unsubscribe link's token, once it has left the address bar (ADR-0017
 * §4, clarification): for this site only, for the hour it takes to press the button.
 */
export const unsubscribeCookie = {
  name: '__Host-householdr.unsubscribe',
  options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 },
} as const;
