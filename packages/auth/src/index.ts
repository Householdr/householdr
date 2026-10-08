// Sign-in, sessions and cookies, between the application and the web app (ADR-0023 §2, clarification).
export { createAuth, type Auth, type AuthSettings } from './auth';
export { counterKeys, type CounterKey } from './counter-keys';
export {
  passwordSignIn,
  signInWithPassword,
  type SignInContext,
  type SignInResult,
} from './sign-in';
