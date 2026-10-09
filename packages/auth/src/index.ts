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
export { totpKeys, type TotpKeys } from './totp-keys';
export {
  createHouseholdWithPasskey,
  householdPasskeyOptions,
  type HouseholdSignUpContext,
  type HouseholdSignUpField,
} from './household-sign-up';
export {
  invitationPasskeyOptions,
  joinWithPasskey,
  type InvitationSignUpContext,
  type InvitationSignUpField,
} from './invitation-sign-up';
export { confirmWithPasskey, passkeyChallenge, signInWithPasskey } from './passkey-sign-in';
export { type Terms } from './passkey-sign-up';
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
  resetLink,
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
  accountTwoFactor,
  finishTwoFactor,
  replaceRecoveryCodes,
  startTwoFactor,
  turnOffTwoFactor,
  type TwoFactorContext,
  type TwoFactorSetup,
} from './two-factor';
export { codeAwaited, signInWithCode, type CodeResult } from './two-factor-sign-in';
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
