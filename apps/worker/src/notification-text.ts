import type { NotificationKind } from '@householdr/application';
import { m } from './lib/paraglide/messages.js';
import { baseLocale } from './lib/paraglide/runtime.js';

/** A culture's country, such as `BE` of `nl-BE`. */
const cultureCountry = /-([A-Z]{2})$/;

/**
 * The locale to write for an account of `culture` in. Until accounts choose their language,
 * everyone reads the base language, with their culture's conventions (ADR-0016 §1, ADR-0008 §6,
 * clarification).
 */
export function localeOf(culture: string) {
  const country = cultureCountry.exec(culture)?.[1];
  return country ? `${baseLocale}-${country}` : baseLocale;
}

/**
 * The days from `first` to `last` in `locale`, such as “12–18 October 2026”, as the app writes a
 * plan's week.
 */
const daysOf = (first: Temporal.PlainDate, last: Temporal.PlainDate, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).formatRange(
    Date.UTC(first.year, first.month - 1, first.day),
    Date.UTC(last.year, last.month - 1, last.day),
  );

/**
 * A notification's sentence, as its list says it, for an account of `culture` (ADR-0014 §6): what
 * a push says, and each line of a morning e-mail (§5, clarification).
 */
export function sentence(
  notification: {
    kind: NotificationKind;
    week: { first: Temporal.PlainDate; last: Temporal.PlainDate };
  },
  culture: string,
) {
  const days = daysOf(notification.week.first, notification.week.last, localeOf(culture));
  const say = { locale: baseLocale };
  return notification.kind === 'plan.drafted'
    ? m['notifications.plan-drafted']({ days }, say)
    : m['notifications.plan-published']({ days }, say);
}
