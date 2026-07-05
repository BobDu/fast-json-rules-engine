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
      // Raised toward 100 once the suite is migrated; keeps a floor meanwhile.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
})
