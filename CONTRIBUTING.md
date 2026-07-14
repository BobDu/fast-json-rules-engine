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
- Typecheck: `npm run typecheck` (src strict + tests). Lint: `npm run lint`
  (builds, then lints the dist output against the Node 14 API baseline).
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
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  and are signed off (`git commit -s`, [DCO](https://developercertificate.org/)).
- Some facts live in more than one doc by design (the README is the npm landing
  page and stays self-contained). If you change `path` / jsonpath-plus guidance,
  the supported / not-supported matrix, or edge-case semantics, update README,
  `docs/USAGE.md`, and `docs/MIGRATING.md` together.

## Releasing

The version is **not committed** — `package.json` stays at the
`0.0.0-development` placeholder. The pushed git tag is the single source of truth;
`.github/workflows/release.yml` derives the version from it and injects it into the
published tarball only. To cut a release:

1. `git tag vX.Y.Z && git push --follow-tags` (SemVer; stay in `0.y.z` while pre-1.0).
2. On the `v*` tag, the workflow runs the full gate, then publishes to npm
   **tokenlessly via OIDC Trusted Publishing** with provenance, and finally creates
   a GitHub Release with auto-generated notes.

No `NPM_TOKEN` secret is involved: publish auth is OIDC (`id-token: write`), which
requires the trusted publisher to be configured on npmjs.com **and the repo to be
public** (provenance is logged to a public transparency ledger).

**First publish is a one-time bootstrap.** OIDC cannot publish a package name that
does not exist yet (npm/cli#8544), and the trusted-publisher setting is per-package
(not per-version). So claim the name once by publishing the placeholder locally —
`npm login`, then `npm publish --no-provenance` (no token; `--no-provenance` because
provenance needs CI + a public repo). Then configure the npmjs trusted publisher,
make the repo public, and tag `v0.1.0`: that release goes through CI with OIDC +
provenance like every release after it. Optionally `npm deprecate` the placeholder
version afterwards.
