import n from 'eslint-plugin-n'

// Minimal lint focused on ONE job: keep the shipped artifact within the Node 14
// runtime API baseline. Syntax is intentionally NOT restricted — tsdown
// down-levels new syntax to the node14 target, so source may use it freely. But
// new runtime APIs (Object.hasOwn, structuredClone, Array.prototype.at, …) are
// not down-levelled or polyfilled, so shipping one would crash on Node 14.
// Linting dist (plain JS, no TS parser needed) checks exactly what ships —
// including anything the build itself injects — before the Node 14 smoke test.
export default [
  {
    files: ['dist/**/*.{cjs,mjs}'],
    plugins: { n },
    rules: {
      'n/no-unsupported-features/es-builtins': ['error', { version: '>=14.0.0' }],
      'n/no-unsupported-features/node-builtins': ['error', { version: '>=14.0.0' }],
    },
  },
]
