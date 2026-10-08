import type { Mail, Mailer } from '@householdr/application';
import {
  accountEmailSent,
  prepareAccountEmail,
  type AccountEmail,
  type AccountEmailContext,
} from '@householdr/auth';
import { m } from './lib/paraglide/messages.js';
import { baseLocale } from './lib/paraglide/runtime.js';

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

/**
 * The e-mail in the recipient's language, as plain text and as accessible HTML (ADR-0014 §6). Until
 * accounts have a culture, everyone reads the base language (ADR-0016 §1).
 */
export function written({ to, link }: AccountEmail): Mail {
  const locale = baseLocale;
  const say = { locale };
  const subject = m['email.password-reset.subject']({}, say);
  const lines = {
    request: m['email.password-reset.request']({}, say),
    action: m['email.password-reset.action']({}, say),
    expiry: m['email.password-reset.expiry']({}, say),
    notYou: m['email.password-reset.not-you']({}, say),
  };
  return {
    to,
    subject,
    text: [lines.request, `${lines.action}:\n${link}`, lines.expiry, lines.notYou].join('\n\n'),
    html: [
      '<!doctype html>',
      `<html lang="${escape(locale)}">`,
      `<head><meta charset="utf-8"><title>${escape(subject)}</title></head>`,
      '<body>',
      `<p>${escape(lines.request)}</p>`,
      `<p><a href="${escape(link)}">${escape(lines.action)}</a></p>`,
      `<p>${escape(lines.expiry)}</p>`,
      `<p>${escape(lines.notYou)}</p>`,
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
