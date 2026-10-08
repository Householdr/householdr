import { defineConfig } from 'vite';

// The worker as one Node module, its workspace packages bundled in and their dependencies left to
// node_modules (ADR-0008, tooling).
export default defineConfig({
  build: { ssr: 'src/index.ts', outDir: 'build', target: 'node26' },
});
