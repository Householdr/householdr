import { defineConfig } from 'drizzle-kit';

// Generates the versioned SQL migrations from the schema: `pnpm --filter @householdr/db generate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', './src/auth-schema.ts'],
  out: './migrations',
  casing: 'snake_case',
});
