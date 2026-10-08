/** One language's messages, by key (ADR-0016 §4). */
export interface Catalogue {
  locale: string;
  messages: Record<string, unknown>;
}

/** A note for translators per message, and the languages whose text is still a draft. */
export type Notes = Record<string, { note: string; needsReview?: string[] }>;

export interface MessagesReport {
  problems: string[];
  needsReview: { key: string; locale: string }[];
}

const placeholder = /\{\s*([A-Za-z_]\w*)\s*\}/g;

function placeholders(value: unknown) {
  return [...new Set([...JSON.stringify(value).matchAll(placeholder)].map((match) => match[1]))]
    .sort()
    .join(', ');
}

function keys(catalogue: Catalogue) {
  return Object.keys(catalogue.messages).filter((key) => key !== '$schema');
}

/**
 * Checks that every maintained language has every message of the base language, with the same
 * placeholders, and that every message has a note for translators (ADR-0016 §3, §4).
 */
export function checkMessages(
  base: Catalogue,
  others: readonly Catalogue[],
  notes: Notes,
): MessagesReport {
  const problems: string[] = [];
  const baseKeys = keys(base);
  for (const other of others) {
    const otherKeys = new Set(keys(other));
    for (const key of baseKeys) {
      if (!otherKeys.has(key)) {
        problems.push(`${other.locale} has no "${key}".`);
      } else if (placeholders(base.messages[key]) !== placeholders(other.messages[key])) {
        problems.push(
          `${other.locale} "${key}" has placeholders {${placeholders(other.messages[key])}}, ` +
            `${base.locale} has {${placeholders(base.messages[key])}}.`,
        );
      }
    }
    for (const key of otherKeys) {
      if (!baseKeys.includes(key))
        problems.push(`${other.locale} has "${key}", which ${base.locale} hasn't.`);
    }
  }
  const locales = new Set([base.locale, ...others.map((o) => o.locale)]);
  const needsReview: MessagesReport['needsReview'] = [];
  for (const key of baseKeys) {
    if (!notes[key]?.note) problems.push(`"${key}" has no note for translators.`);
  }
  for (const [key, entry] of Object.entries(notes)) {
    if (!baseKeys.includes(key)) problems.push(`The note for "${key}" has no message.`);
    for (const locale of entry.needsReview ?? []) {
      if (locales.has(locale)) needsReview.push({ key, locale });
      else problems.push(`"${key}" needs review in ${locale}, which is not a maintained language.`);
    }
  }
  return { problems, needsReview };
}
