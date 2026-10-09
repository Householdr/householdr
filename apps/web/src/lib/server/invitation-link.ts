/**
 * The cookie that holds an invitation link's token once it has left the address bar (ADR-0017 §4):
 * for this site only, for the 7 days a link works at most (ADR-0010 §5).
 */
export const invitationCookie = {
  name: '__Host-householdr.invitation',
  options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 },
} as const;
