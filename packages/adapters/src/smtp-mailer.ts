import type { Mailer } from '@householdr/application';
import { createTransport } from 'nodemailer';

export interface SmtpSettings {
  host: string;
  port: number;
  /** Absent for a local test server without accounts, such as Mailpit. */
  auth?: { user: string; password: string };
  /** The sender, such as `Householdr <householdr@example.org>`. */
  from: string;
  /** Refuse to send unless the connection is encrypted. Off only for a local test server. */
  requireTls: boolean;
}

/**
 * The mailer of ADR-0014 §7: SMTP to the transactional e-mail provider, or to the self-hoster's own
 * server. Messages carry only what the caller wrote: no tracking, and no file or URL is ever read
 * to build them.
 */
export function smtpMailer(settings: SmtpSettings): Mailer {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    // Port 465 speaks TLS from the first byte (RFC 8314); other ports upgrade with STARTTLS.
    secure: settings.port === 465,
    requireTLS: settings.requireTls,
    auth: settings.auth && { user: settings.auth.user, pass: settings.auth.password },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    send: async (mail) => {
      await transport.sendMail({
        from: settings.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    },
  };
}
