import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    // Layer 1 — business logic, tested against the TypeScript source (fast feedback).
    // The dist contract suite (Layer 2) has its own config and needs a fresh build,
    // so it is excluded here to keep the default source run build-independent.
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/dist-contract.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      // src is fully covered; lock at 100. Intentionally-unreachable code is
      // marked `/* v8 ignore */`, so any drop means a real untested branch.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
})
