/**
 * An e-mail to one person (ADR-0014 §6): a plain-text part and an accessible HTML part, written in
 * the recipient's culture. Who it comes from is the mailer's setting.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends e-mail: over SMTP in the app, recorded in tests (ADR-0023 §3). */
export interface Mailer {
  send: (mail: Mail) => Promise<void>;
}
