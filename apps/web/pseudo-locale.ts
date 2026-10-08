import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The pseudo-locale's code: `XA` is set aside for pseudo-accents. */
export const pseudoLocale = 'en-XA';

const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const accents = Array.from('àƀçðèƒĝĥîĵķĺɱñöƥʠŕšţűʋŵẋýžÀƁÇĐÈƑĜĤÎĴĶĹṀÑÖƤɊŔŠŢŰṼŴẊÝŽ');
const accented = new Map(Array.from(letters, (letter, i) => [letter, accents[i] ?? letter]));

/**
 * Text as the pseudo-locale shows it (ADR-0016 §5): every letter accented, about a third longer,
 * and in brackets, so text that skipped the catalogue and layouts too tight for longer languages
 * stand out. Placeholders such as `{name}` stay as they are.
 */
export function pseudoText(text: string): string {
  let visible = 0;
  const parts = text.split(/(\{[^}]*\})/).map((part) => {
    if (part.startsWith('{')) return part;
    visible += part.length;
    return part.replace(/[A-Za-z]/g, (letter) => accented.get(letter) ?? letter);
  });
  return `[${parts.join('')} ${'·'.repeat(Math.ceil(visible * 0.3))}]`;
}

/** A variant of a message with variants, as inlang's message format writes it. */
interface Variants {
  match: Record<string, string>;
  [rest: string]: unknown;
}

/**
 * A message in the pseudo-locale: a plain message's text, or each variant's text of a message
 * with variants; selectors and declarations stay as they are.
 */
export function pseudoMessage(message: unknown): unknown {
  if (typeof message === 'string') return pseudoText(message);
  if (Array.isArray(message)) {
    return (message as Variants[]).map((entry) => ({
      ...entry,
      match: Object.fromEntries(
        Object.entries(entry.match).map(([selector, text]) => [selector, pseudoText(text)]),
      ),
    }));
  }
  throw new Error(`A message is a string or a list of variants, not ${JSON.stringify(message)}.`);
}

/**
 * Writes a copy of the inlang project at `root` into `out`, with the pseudo-locale added, and
 * returns the copy's project folder. Only the dev server and the test build use it, so the
 * pseudo-locale never reaches a production build (ADR-0009 §5, clarification).
 */
export function writePseudoProject(root: string, out: string): string {
  const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
  const settings = read('project.inlang/settings.json') as {
    locales: string[];
    modules: string[];
    'plugin.inlang.messageFormat': { pathPattern: string };
  };
  const messages = join(resolve(out), 'messages');
  mkdirSync(messages, { recursive: true });
  for (const locale of settings.locales) {
    writeFileSync(
      join(messages, `${locale}.json`),
      JSON.stringify(read(`messages/${locale}.json`)),
    );
  }
  const english = read('messages/en.json') as Record<string, unknown>;
  const pseudo = Object.fromEntries(
    Object.entries(english).map(([key, message]) => [
      key,
      key === '$schema' ? message : pseudoMessage(message),
    ]),
  );
  writeFileSync(join(messages, `${pseudoLocale}.json`), JSON.stringify(pseudo));
  const project = join(resolve(out), 'project.inlang');
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, 'settings.json'),
    JSON.stringify({
      ...settings,
      locales: [...settings.locales, pseudoLocale],
      // The copy lives elsewhere, so its paths are made absolute.
      modules: settings.modules.map((module) => resolve(root, module)),
      'plugin.inlang.messageFormat': { pathPattern: join(messages, '{locale}.json') },
    }),
  );
  return project;
}
