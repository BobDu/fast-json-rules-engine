import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Layer 1 — business logic, tested against the TypeScript source (fast feedback).
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      // Raised toward 100 once the suite is migrated; keeps a floor meanwhile.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
})
