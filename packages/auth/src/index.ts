// Sign-in, sessions and cookies, between the application and the web app (ADR-0023 §2, clarification).
export {
  accountEmailSent,
  prepareAccountEmail,
  type AccountEmail,
  type AccountEmailContext,
} from './account-emails';
export { createAuth, type Auth, type AuthSettings } from './auth';
export { type Cookie } from './cookies';
export { counterKeys, type CounterKey } from './counter-keys';
export { confirmWithPasskey, passkeyChallenge, signInWithPasskey } from './passkey-sign-in';
export {
  accountPasskeys,
  addPasskey,
  confirmWithPassword,
  passkeyOptions,
  removePasskey,
  signedInRecently,
  type PasskeysContext,
} from './passkeys';
export {
  passwordResetRequest,
  requestPasswordReset,
  resetLinkWorks,
  setNewPassword,
  type NewPasswordResult,
  type PasswordResetContext,
} from './password-reset';
export {
  passwordSignIn,
  signInWithPassword,
  type Client,
  type SignInContext,
  type SignInResult,
} from './sign-in';
export {
  deleteExpiredSignUpLinks,
  requestSignUp,
  signUpLinkAddress,
  signUpRequest,
  type SignUpContext,
} from './sign-up';
export {
  currentSession,
  deviceToSignOut,
  sessionCookie,
  signedInDevices,
  signOut,
  signOutDevice,
  signOutOtherDevices,
  type Device,
  type Session,
  type SessionsContext,
  type SignOutDeviceResult,
} from './sessions';
