import n from 'eslint-plugin-n'
import tseslint from 'typescript-eslint'

// Minimal lint focused on ONE job: keep src within the Node 14 runtime API
// baseline. Syntax is intentionally NOT restricted — tsdown down-levels new
// syntax to the node14 target, so source may use it freely. But new runtime
// APIs (Object.hasOwn, structuredClone, Array.prototype.at, …) are not
// down-levelled or polyfilled, so using one in src would crash on Node 14.
// These two rules catch that at lint time, before the Node 14 smoke test.
export default [
  {
    files: ['src/**/*.ts'],
    plugins: { n },
    languageOptions: {
      parser: tseslint.parser,
      sourceType: 'module',
    },
    rules: {
      'n/no-unsupported-features/es-builtins': ['error', { version: '>=14.0.0' }],
      'n/no-unsupported-features/node-builtins': ['error', { version: '>=14.0.0' }],
    },
  },
]
