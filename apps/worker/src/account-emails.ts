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

/**
 * The e-mails with a link: their subject, why it came, the link, how long it works, and what to do
 * if it wasn't you.
 */
const links = {
  'sign-up': [
    m['email.sign-up.subject'],
    m['email.sign-up.request'],
    m['email.sign-up.action'],
    m['email.sign-up.expiry'],
    m['email.sign-up.not-you'],
  ],
  'password-reset': [
    m['email.password-reset.subject'],
    m['email.password-reset.request'],
    m['email.password-reset.action'],
    m['email.password-reset.expiry'],
    m['email.password-reset.not-you'],
  ],
} as const;

/**
 * The notices that a way of signing in changed (ADR-0014 §2): their subject, what happened, and
 * what to do if it wasn't you.
 */
const notices = {
  'password-changed': [
    m['email.password-changed.subject'],
    m['email.password-changed.done'],
    m['email.password-changed.not-you'],
  ],
  'passkey-added': [
    m['email.passkey-added.subject'],
    m['email.passkey-added.done'],
    m['email.passkey-added.not-you'],
  ],
  'passkey-removed': [
    m['email.passkey-removed.subject'],
    m['email.passkey-removed.done'],
    m['email.passkey-removed.not-you'],
  ],
  'two-factor-on': [
    m['email.two-factor-on.subject'],
    m['email.two-factor-on.done'],
    m['email.two-factor-on.not-you'],
  ],
  'two-factor-off': [
    m['email.two-factor-off.subject'],
    m['email.two-factor-off.done'],
    m['email.two-factor-off.not-you'],
  ],
  'recovery-codes-changed': [
    m['email.recovery-codes-changed.subject'],
    m['email.recovery-codes-changed.done'],
    m['email.recovery-codes-changed.not-you'],
  ],
} as const;

/** What each account e-mail says, in `locale`. */
function content(email: AccountEmail, locale: Locale): Content {
  const say = { locale };
  if ('link' in email) {
    const [subject, request, action, expiry, notYou] = links[email.kind];
    return {
      subject: subject({}, say),
      paragraphs: [
        request({}, say),
        { text: action({}, say), link: email.link },
        expiry({}, say),
        notYou({}, say),
      ],
    };
  }
  const [subject, done, notYou] = notices[email.kind];
  return { subject: subject({}, say), paragraphs: [done({}, say), notYou({}, say)] };
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
