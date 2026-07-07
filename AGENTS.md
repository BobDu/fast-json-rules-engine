# AGENTS.md

Operational map for agents working in this repo. **Users → `README.md`. Dev loop +
contributor rules → `CONTRIBUTING.md`.** This file keeps the terse command
cheatsheet plus the non-obvious internals and invariants you can't grep in 30s.

## What it is

Compiled, synchronous, zero-dependency evaluator for the
[json-rules-engine](https://github.com/CacheControl/json-rules-engine) rule format
(what / why / API / benchmarks → README). **The invariant an agent must respect:
it is a drop-in replacement, not a reimplementation** — any json-rules-engine rule
document compiles unchanged and produces the same output, and parity is against
**json-rules-engine 6.6.0**, the pinned devDependency and differential-fuzz oracle.

## Commands

Build/test need **Node ≥20** (`.nvmrc` = 24); the *published* package runs on Node ≥14.

- `npm test` — Layer 1: source suite + differential fuzzing (fast, build-independent)
- `npm run test:coverage` — same, with the **100% coverage gate**
- `npm run test:dist` — Layer 2: build, then CJS/ESM smoke + src↔dist equivalence + `arethetypeswrong`
- `npm run typecheck` (src strict **and** tests) · `npm run lint` (src only, Node-14 API baseline) · `npm run build` · `npm run bench`
- one file: `npx vitest run test/golden.test.ts` · by name: `-t "numberValidator"` · heavier fuzz (prints a repro seed on failure): `FJRE_FUZZ_N=10000 npm test`

## Architecture

Public surface = `compile` + `CompileError`/`UndefinedFactError` +
`KNOWN_OPERATORS`/`KNOWN_DECORATORS` + types (`src/index.ts`). All real work is in
two files:

- **`src/compile.ts`** — the compiler. Per rule, three passes in order, each
  guarding a distinct hazard:
  1. `assertDepth` — measures the **fully expanded** nesting depth (inlining
     named-condition references) and throws past `MAX_DEPTH` (512). This is what
     stops a shallow-seeded deep chain from overflowing the eval-time closure
     stack, since `compileCondition` returns a *memoized* predicate without
     re-descending.
  2. `collectFacts` — unions every referenced fact across **all** rules into a
     global presence pre-check, so a missing fact fails loud regardless of
     short-circuit / `stopOnFirstEvent`. Skipped when `allowUndefinedFacts`.
  3. `compileCondition` — builds the predicate closures.
  `Ctx` carries three name-keyed memo maps (`condPredMemo` / `conditionFactMemo` /
  `condDepthMemo`); without them, fan-out chains of named conditions blow up
  exponentially (a compile-time DoS). Named conditions inline and share **one**
  compiled predicate per name.
- **`src/operators.ts`** — the correctness core: the 10 operators + 6 decorators
  (e.g. `everyFact:greaterThan`), replicated from json-rules-engine 6.6.0. The
  differential fuzzer guards it.

## Parity is a constraint — do NOT "fix" these without checking the oracle + fuzzer

- **Key precedence `any > all > not > condition`** must stay identical across
  `compileCondition`, `collectFacts`, and `assertDepth`, or a malformed
  both-`all`-and-`any` condition collects/measures a different branch than it evaluates.
- Empty `all` **and** empty `any` both evaluate `true`; numeric operators gate on
  `numberValidator` (`null >= 0` is `false`); `in`/`notIn` use `indexOf`; events
  normalize to `{ type, params? }` (falsy params + non-`type`/`params` keys dropped).
  `event.params` aliases the source rule (read-only).
- `hasOwn` (never `in`) throughout, matching upstream's `hasOwnProperty` checks.
- **Deliberate fail-loud divergences** (rejected at compile, not silently
  mishandled): unparseable rule priority, uninjected `path`, non-string
  value-fact reference. Each is commented at its throw site — preserve the reasoning.
  Two things are instead *silently ignored* (documented in MIGRATING, nothing to fail
  on over static facts): `replaceFactsInEventParams`, and a nested-condition `priority`
  (an upstream short-circuit-ordering hint; the boolean result is order-independent).

## Testing model

Two layers, kept separate so the fast source suite never needs a fresh build:

- **Layer 1 (source):** `test/**/*.test.ts`. `test/fuzz.test.ts` = differential
  property testing via `test/helpers.ts` (`agrees`/`expectMatch` run the same
  rules through the real `json-rules-engine` and compare `events`, the only surface
  this library returns). `test/golden.test.ts` pins edge
  cases + the intentional divergences; generators live in `test/arbitraries.ts`.
- **Layer 2 (dist):** `test/dist-contract.test.ts` (src↔dist fast-check
  equivalence, own vitest config) + `test/dist-smoke.{cjs,mjs}` (load the built
  artifact on the Node 14–24 matrix; the `.cjs` `require()`s the CJS artifact, the
  `.mjs` imports the ESM one).

## Editing src

The one trap not obvious from the code: **`src/` must stay within the Node-14
runtime-API baseline** — new *syntax* is fine (tsdown down-levels it), new *runtime
APIs* (`structuredClone`, `Object.hasOwn`, …) are not (`eslint-plugin-n` + the Node 14
dist smoke fail on them). Test code runs on modern Node and uses them freely.

Everything else — full dev loop, the 100% coverage gate, doc-sync, Conventional
Commits (`-s -S`) — is in **`CONTRIBUTING.md`**; the "keep the fuzzer agreeing"
rule is under Parity above.
