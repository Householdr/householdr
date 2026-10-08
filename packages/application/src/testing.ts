import type { Mail, Mailer } from './ports';

/** A mailer that keeps what it is asked to send, for use-case tests (TEST-11). */
export function recordingMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve();
    },
  };
}
