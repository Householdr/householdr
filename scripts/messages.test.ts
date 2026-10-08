import { describe, expect, it } from 'vitest';
import { checkMessages, type Catalogue } from './messages';

const en: Catalogue = {
  locale: 'en',
  messages: {
    $schema: 'https://inlang.com/schema/inlang-message-format',
    'app.name': 'Householdr',
    'plan.published.title': 'Your plan for the week of {week} is ready',
  },
};
const nl = (messages: Record<string, unknown>): Catalogue => ({ locale: 'nl', messages });
const notes = {
  'app.name': { note: 'The product name.' },
  'plan.published.title': { note: 'Title of the notification; {week} is a date.' },
};

describe('checkMessages (ADR-0016 §4)', () => {
  it('passes complete catalogues', () => {
    const complete = nl({
      'app.name': 'Householdr',
      'plan.published.title': 'Je plan voor de week van {week} staat klaar',
    });
    expect(checkMessages(en, [complete], notes)).toEqual({ problems: [], needsReview: [] });
  });

  it('finds a missing and an extra message', () => {
    const { problems } = checkMessages(en, [nl({ 'app.name': 'Householdr', extra: 'x' })], {
      ...notes,
    });
    expect(problems).toEqual([
      'nl has no "plan.published.title".',
      'nl has "extra", which en hasn\'t.',
    ]);
  });

  it('finds placeholders that differ', () => {
    const { problems } = checkMessages(
      en,
      [nl({ 'app.name': 'Householdr', 'plan.published.title': 'Je plan voor {weekStart}' })],
      notes,
    );
    expect(problems).toEqual([
      'nl "plan.published.title" has placeholders {weekStart}, en has {week}.',
    ]);
  });

  it('wants a note for translators on every message', () => {
    const { problems } = checkMessages(en, [], { 'app.name': { note: 'The product name.' } });
    expect(problems).toEqual(['"plan.published.title" has no note for translators.']);
  });

  it('lists drafts that need review, and refuses unknown languages', () => {
    const report = checkMessages(en, [nl({ ...en.messages })], {
      ...notes,
      'app.name': { note: 'The product name.', needsReview: ['nl', 'fr'] },
    });
    expect(report.needsReview).toEqual([{ key: 'app.name', locale: 'nl' }]);
    expect(report.problems).toEqual([
      '"app.name" needs review in fr, which is not a maintained language.',
    ]);
  });
});
