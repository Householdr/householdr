import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { contentSecurityPolicy } from './src/security.ts';

export default defineConfig({
  plugins: [
    sveltekit({
      // Runes only, everywhere except in dependencies (CODE-7).
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      // A plain Node server keeps the container simple (ADR-0008 §4, §13).
      adapter: adapter(),
      // A nonce per request for SvelteKit's own scripts (ADR-0017 §4).
      csp: { mode: 'nonce', directives: contentSecurityPolicy },
    }),
  ],
});
