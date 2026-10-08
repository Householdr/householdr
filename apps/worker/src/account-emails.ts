import type { Mail, Mailer } from '@householdr/application';
import {
  accountEmailSent,
  prepareAccountEmail,
  type AccountEmail,
  type AccountEmailContext,
} from '@householdr/auth';
import { m } from './lib/paraglide/messages.js';
import { baseLocale, type Locale } from './lib/paraglide/runtime.js';

/** What delivering an account e-mail needs. */
export interface DeliveryContext extends AccountEmailContext {
  mailer: Mailer;
}

/**
 * Sends the account e-mail of the row `id`, with a fresh link, and deletes the row (ADR-0014 §7,
 * clarification). Nothing happens for a row that is gone; one whose sending fails is kept, for the
 * job to try again.
 */
export async function deliverAccountEmail(context: DeliveryContext, id: string) {
  const email = await prepareAccountEmail(context, id);
  if (!email) return;
  await context.mailer.send(written(email));
  await accountEmailSent(context, id);
}

/** What an e-mail says: its subject, and paragraphs, of which one may be a link. */
interface Content {
  subject: string;
  paragraphs: (string | { text: string; link: string })[];
}

/** What each account e-mail says, in `locale`. */
function content(email: AccountEmail, locale: Locale): Content {
  const say = { locale };
  if (email.kind === 'password-changed') {
    return {
      subject: m['email.password-changed.subject']({}, say),
      paragraphs: [
        m['email.password-changed.done']({}, say),
        m['email.password-changed.not-you']({}, say),
      ],
    };
  }
  return {
    subject: m['email.password-reset.subject']({}, say),
    paragraphs: [
      m['email.password-reset.request']({}, say),
      { text: m['email.password-reset.action']({}, say), link: email.link },
      m['email.password-reset.expiry']({}, say),
      m['email.password-reset.not-you']({}, say),
    ],
  };
}

/**
 * The e-mail in the recipient's language, as plain text and as accessible HTML (ADR-0014 §6). Until
 * accounts have a culture, everyone reads the base language (ADR-0016 §1).
 */
export function written(email: AccountEmail): Mail {
  const locale = baseLocale;
  const { subject, paragraphs } = content(email, locale);
  return {
    to: email.to,
    subject,
    text: paragraphs
      .map((paragraph) =>
        typeof paragraph === 'string' ? paragraph : `${paragraph.text}:\n${paragraph.link}`,
      )
      .join('\n\n'),
    html: [
      '<!doctype html>',
      `<html lang="${escape(locale)}">`,
      `<head><meta charset="utf-8"><title>${escape(subject)}</title></head>`,
      '<body>',
      ...paragraphs.map((paragraph) =>
        typeof paragraph === 'string'
          ? `<p>${escape(paragraph)}</p>`
          : `<p><a href="${escape(paragraph.link)}">${escape(paragraph.text)}</a></p>`,
      ),
      '</body>',
      '</html>',
    ].join('\n'),
  };
}

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text as it may stand in HTML, in an element or an attribute. */
function escape(text: string) {
  return text.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}
