import { paraglideVitePlugin } from '@inlang/paraglide-js';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { writePseudoProject } from './pseudo-locale.ts';
import { contentSecurityPolicy } from './src/security.ts';

export default defineConfig(({ mode }) => {
  // The dev server and the test build add the pseudo-locale, chosen by Paraglide's locale cookie
  // (ADR-0016 §5); a production build never has it (ADR-0009 §5, clarification).
  const production = mode === 'production';
  return {
    plugins: [
      // Messages compile into typed functions (ADR-0008 §6). Everyone reads English for now: Dutch
      // is maintained but sits behind a release flag until it is offered (ADR-0016 §1), so the
      // locale follows the base language until flags and accounts can choose it.
      paraglideVitePlugin({
        project: production ? '../../project.inlang' : writePseudoProject('../..', '.pseudo'),
        outdir: './src/lib/paraglide',
        strategy: production ? ['baseLocale'] : ['cookie', 'baseLocale'],
      }),
      sveltekit({
        // Runes only, everywhere except in dependencies (CODE-7).
        compilerOptions: {
          runes: ({ filename }) =>
            filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
        },
        // A plain Node server keeps the container simple (ADR-0008 §4, §13). The test build goes
        // elsewhere, so it never takes the production build's place.
        adapter: adapter({ out: mode === 'test' ? 'build-test' : 'build' }),
        // A nonce per request for SvelteKit's own scripts (ADR-0017 §4).
        csp: { mode: 'nonce', directives: contentSecurityPolicy },
      }),
    ],
  };
});
