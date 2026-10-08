/**
 * The cookie that holds a sign-up link's token, once it has left the address bar (ADR-0017 §4):
 * for this site only, for the 30 minutes the link works (ADR-0010 §1, clarification).
 */
export const signUpCookie = {
  name: '__Host-householdr.sign-up',
  options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 60 },
} as const;
