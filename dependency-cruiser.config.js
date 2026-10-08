// Import rules that span files, which ESLint checks one file at a time can't see. The layer rules
// stay in eslint.config.js (CODE-4).

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-import-cycles',
      comment: 'A module imports, directly or through others, a module that imports it (CODE-27).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Type-only imports count too: a cycle of types is still a design cycle (CODE-27).
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)node_modules/', '(^|/)\\.svelte-kit/', '(^|/)build/'] },
    // Workspace packages resolve through their `exports` to their sources.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
    },
  },
};
