# Contributing

Thanks for your interest! This is a small, single-maintainer library — issues and
PRs are welcome.

## Development

- **Node >= 20 is required to build and test** (tsdown/rolldown and vitest 4),
  even though the published package supports Node >= 14. `.nvmrc` pins the version
  CI uses.
- Install: `npm ci`
- Test the source (fast): `npm test` — vitest + fast-check differential fuzzing
  against json-rules-engine. `npm run test:coverage` enforces 100% coverage.
- Test the built artifact: `npm run test:dist` — CJS/ESM smoke on Node 14+,
  src↔dist equivalence, and `arethetypeswrong`.
- Typecheck: `npm run typecheck` (src strict + tests). Lint: `npm run lint`.
- Benchmark: `npm run bench`.
- Turn up fuzzing locally: `FJRE_FUZZ_N=10000 npm test`. A failure prints a
  reproducible seed you can re-run.

## Ground rules

- **`src/` must stay within the Node 14 runtime API baseline** — `eslint-plugin-n`
  plus the Node 14 dist smoke enforce this. New *syntax* is fine (tsdown
  down-levels it); new *runtime APIs* (`structuredClone`, `Object.hasOwn`, …) are
  not, since they are neither down-levelled nor polyfilled.
- Evaluation behavior is verified by differential fuzzing against
  json-rules-engine 6.6.0. If you change semantics, the fuzzer must still agree.
- Coverage is gated at 100%. Genuinely unreachable code is marked
  `/* v8 ignore */` with a comment explaining why.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
