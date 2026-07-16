import fc from 'fast-check'
import { test } from '@fast-check/vitest'
import { agrees } from './helpers'
import { rulesTied, rulesDistinct, rulesWithRefTied, namedConditions, facts, CUSTOM_OPS, jp } from './arbitraries'

// Differential property tests: for any generated rule set + facts, our compiled
// output must equal json-rules-engine 6.6.0. fast-check supplies edge values
// (NaN, Infinity, -0 via fc.double), auto-shrinks any counterexample to a minimal
// repro, and prints a reproducible seed on failure. Generators live in
// ./arbitraries (shared with the src↔dist contract suite).

const fuzzSeed = process.env.FJRE_FUZZ_SEED
fc.configureGlobal({
  numRuns: Number(process.env.FJRE_FUZZ_N ?? 400),
  ...(fuzzSeed === undefined ? {} : { seed: Number(fuzzSeed) }),
})

test.prop([rulesTied, facts, fc.boolean()])(
  'core: compiled output equals json-rules-engine',
  (rules, f, allowUndefinedFacts) =>
    agrees(rules as never, f, { allowUndefinedFacts, operators: CUSTOM_OPS, pathResolver: jp }, { orderInsensitive: true }),
)

// stopOnFirstEvent uses DISTINCT priorities (tied + stop diverges from the oracle
// by design) and allowUndefinedFacts:true — our global undefined-fact pre-check
// throws before any rule, whereas the oracle's stop() emulation returns early
// without throwing (a deliberate fail-loud divergence, pinned in golden.test.ts).
// Both dodges are intentional, not oracle weaknesses.
test.prop([rulesDistinct, facts])(
  'stopOnFirstEvent: compiled output equals json-rules-engine',
  (rules, f) =>
    agrees(
      rules as never,
      f,
      { stopOnFirstEvent: true, allowUndefinedFacts: true, operators: CUSTOM_OPS, pathResolver: jp },
      { orderInsensitive: true },
    ),
)

test.prop([rulesWithRefTied, namedConditions, facts, fc.boolean()])(
  'named conditions: compiled output equals json-rules-engine',
  (rules, conditions, f, allowUndefinedFacts) =>
    agrees(
      rules as never,
      f,
      { allowUndefinedFacts, conditions: conditions as never, operators: CUSTOM_OPS, pathResolver: jp },
      { orderInsensitive: true },
    ),
)
