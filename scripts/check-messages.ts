// Checks the message catalogues and lists drafts that still need review (ADR-0016 §4). Run by
// Node directly, so the files it imports may import types only.
import { appendFileSync, readFileSync } from 'node:fs';
import { checkMessages, type Catalogue, type Notes } from './messages.ts';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const settings = read('project.inlang/settings.json') as { baseLocale: string; locales: string[] };
const catalogue = (locale: string): Catalogue => ({
  locale,
  messages: read(`messages/${locale}.json`) as Record<string, unknown>,
});

const { problems, needsReview } = checkMessages(
  catalogue(settings.baseLocale),
  settings.locales.filter((locale) => locale !== settings.baseLocale).map(catalogue),
  read('messages/notes.json') as Notes,
);

const report =
  needsReview.length === 0
    ? 'No message needs review.'
    : [
        '### Messages that still need review (none may remain in an offered language at release)',
        '',
        '| Message | Language |',
        '|---|---|',
        ...needsReview.map((r) => `| \`${r.key}\` | ${r.locale} |`),
      ].join('\n');
console.log(report);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, `${report}\n`);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
