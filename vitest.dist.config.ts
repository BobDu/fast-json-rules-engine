import { defineConfig } from 'vitest/config'

// Layer 2 — contract test against the BUILT artifact (run `npm run build` first).
// Kept out of the default `vitest run` (Layer 1 = source only) so the fast source
// suite never depends on a fresh dist. `dist` is external so it loads through
// Node's native CJS/ESM loader — we verify the real published files.
export default defineConfig({
  test: {
    include: ['test/dist-contract.test.ts'],
    server: { deps: { external: [/[\\/]dist[\\/]/] } },
  },
})
