import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pseudoLocale, pseudoMessage, pseudoText, writePseudoProject } from './pseudo-locale';

// The pseudo-locale of ADR-0016 §5.

describe('pseudoText', () => {
  it('accents every letter and wraps the text in brackets', () => {
    expect(pseudoText('Plan published')).toBe('[Ƥĺàñ ƥűƀĺîšĥèð ·····]');
  });

  it('changes every ASCII letter, so none can pass for English', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const accented = pseudoText(letters).slice(1).split(' ')[0] ?? '';
    // eslint-disable-next-line e18e/prefer-spread-syntax -- Splits a string into its characters, which typescript-eslint's no-misused-spread forbids doing with a spread.
    expect(Array.from(accented)).toHaveLength(letters.length);
    // eslint-disable-next-line e18e/prefer-spread-syntax -- Splits a string into its characters, which typescript-eslint's no-misused-spread forbids doing with a spread.
    Array.from(accented).forEach((char, i) => {
      expect(char).not.toBe(letters[i]);
    });
  });

  it('makes text at least 30% longer', () => {
    for (const text of ['Ok', 'Householdr', 'Put the PMD bin out tonight']) {
      // eslint-disable-next-line e18e/prefer-spread-syntax -- Splits a string into its characters, which typescript-eslint's no-misused-spread forbids doing with a spread.
      expect(Array.from(pseudoText(text)).length).toBeGreaterThanOrEqual(text.length * 1.3);
    }
  });

  it('leaves placeholders as they are', () => {
    expect(pseudoText('Hi {name}, {count} tasks')).toBe('[Ĥî {name}, {count} ţàšķš ····]');
  });
});

describe('pseudoMessage', () => {
  it('changes the text of each variant, not its selectors or declarations', () => {
    const message = [
      {
        declarations: ['input count', 'local countPlural = count: plural'],
        selectors: ['countPlural'],
        match: { 'countPlural=one': 'One task', 'countPlural=other': '{count} tasks' },
      },
    ];
    expect(pseudoMessage(message)).toEqual([
      {
        declarations: ['input count', 'local countPlural = count: plural'],
        selectors: ['countPlural'],
        match: { 'countPlural=one': '[Öñè ţàšķ ···]', 'countPlural=other': '[{count} ţàšķš ··]' },
      },
    ]);
  });

  it('refuses what isn’t a message', () => {
    expect(() => pseudoMessage(42)).toThrow();
  });
});

describe('writePseudoProject', () => {
  let root: string;
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies the project with the pseudo-locale added, leaving the original alone', () => {
    root = mkdtempSync(join(tmpdir(), 'pseudo-'));
    const settings = {
      baseLocale: 'en',
      locales: ['en', 'nl'],
      modules: ['./node_modules/plugin.js'],
      'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' },
    };
    mkdirSync(join(root, 'project.inlang'));
    mkdirSync(join(root, 'messages'));
    writeFileSync(join(root, 'project.inlang/settings.json'), JSON.stringify(settings));
    writeFileSync(
      join(root, 'messages/en.json'),
      JSON.stringify({ $schema: 's', 'app.name': 'Hi' }),
    );
    writeFileSync(
      join(root, 'messages/nl.json'),
      JSON.stringify({ $schema: 's', 'app.name': 'Hoi' }),
    );

    const project = writePseudoProject(root, join(root, 'out'));
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;

    expect(read(join(project, 'settings.json'))).toEqual({
      ...settings,
      locales: ['en', 'nl', pseudoLocale],
      modules: [join(root, 'node_modules/plugin.js')],
      'plugin.inlang.messageFormat': { pathPattern: join(root, 'out/messages/{locale}.json') },
    });
    expect(read(join(root, 'out/messages/en-XA.json'))).toEqual({
      $schema: 's',
      'app.name': '[Ĥî ·]',
    });
    expect(read(join(root, 'out/messages/nl.json'))).toEqual({ $schema: 's', 'app.name': 'Hoi' });
    expect(read(join(root, 'project.inlang/settings.json'))).toEqual(settings);
  });
});
