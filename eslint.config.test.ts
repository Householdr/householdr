import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { boundaries } from './eslint.config.js';

const eslint = new ESLint({
  cwd: import.meta.dirname,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...boundaries,
  ],
});

async function ruleIds(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe('layer boundaries (CODE-4, CODE-5, CODE-26)', () => {
  it.each([
    ['packages/domain/src/x.ts', "import '@householdr/db';"],
    ['packages/domain/src/x.ts', "import { readFile } from 'node:fs/promises';"],
    ['packages/db/src/x.ts', "import '@householdr/application';"],
    ['packages/application/src/x.ts', "import '@householdr/worker';"],
    ['packages/application/src/x.ts', "import { redirect } from '@sveltejs/kit';"],
    ['packages/application/src/x.ts', "import { env } from '$env/dynamic/private';"],
    ['apps/worker/src/x.ts', "import '@householdr/db';"],
    ['apps/worker/src/x.ts', "import '@householdr/domain';"],
  ])('%s rejects %s', async (filePath, code) => {
    expect(await ruleIds(filePath, code)).toEqual(['no-restricted-imports']);
  });

  it.each([
    ['packages/db/src/x.ts', "import '@householdr/domain';"],
    ['packages/application/src/x.ts', "import '@householdr/domain';"],
    ['packages/application/src/x.ts', "import '@householdr/db';"],
    ['apps/worker/src/x.ts', "import '@householdr/application';"],
  ])('%s allows %s', async (filePath, code) => {
    expect(await ruleIds(filePath, code)).toEqual([]);
  });

  it.each([
    ['Date.now()', 'no-restricted-properties'],
    ['new Date()', 'no-restricted-syntax'],
    ['Math.random()', 'no-restricted-properties'],
    ['Temporal.Now.instant()', 'no-restricted-properties'],
    ['process.env.X', 'no-restricted-globals'],
    ["fetch('https://example.org')", 'no-restricted-globals'],
    ['crypto.randomUUID()', 'no-restricted-globals'],
  ])('the domain package rejects %s', async (code, ruleId) => {
    expect(await ruleIds('packages/domain/src/x.ts', `${code};`)).toEqual([ruleId]);
  });

  it('use cases cannot read the environment', async () => {
    expect(await ruleIds('packages/application/src/x.ts', 'process.env.X;')).toEqual([
      'no-restricted-globals',
    ]);
  });
});
