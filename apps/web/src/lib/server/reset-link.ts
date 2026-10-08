/**
 * The cookie that holds a reset link's token, once it has left the address bar (ADR-0017 §4): for
 * this site only, for the 30 minutes the link works (ADR-0010 §8).
 */
export const resetCookie = {
  name: '__Host-householdr.reset',
  options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 60 },
} as const;
