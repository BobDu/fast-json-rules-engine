import fc from 'fast-check'
import { test } from '@fast-check/vitest'
import { expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { compile as compileSrc } from '../src/index'
import type { CompileOptions, RuleDefinition, Facts } from '../src/index'
import { rulesTied, rulesDistinct, rulesWithRefTied, namedConditions, facts, CUSTOM_OPS, jp } from './arbitraries'

// Layer 2 contract: the SHIPPED artifact (dist CJS + ESM) must behave identically
// to the TypeScript source for the same rules/facts. The fuzz suite proves the
// source matches json-rules-engine; this proves the build (tsdown down-levelling
// to node14, dual CJS/ESM emit) preserves that behavior — no transform, module
// format, or syntax down-level quirk changes an answer. Generators are shared
// with fuzz so both layers cover the same rule shapes and edge values.
//
// Both artifacts load through Node's native loader (createRequire for CJS, an
// absolute file: URL for ESM; dist is marked external in vitest.dist.config.ts)
// so we test the real published files, not a vite-retransformed copy.

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const { compile: compileCjs } = require('../dist/index.cjs') as { compile: typeof compileSrc }
const { compile: compileEsm } = (await import(
  pathToFileURL(path.resolve(here, '../dist/index.mjs')).href
)) as { compile: typeof compileSrc }

fc.configureGlobal({ numRuns: Number(process.env.FJRE_CONTRACT_N ?? 300) })

type Outcome =
  | { stage: 'compile' | 'eval'; name: string }
  | { stage: 'ok'; events: unknown; failureEvents: unknown; results: unknown; failureResults: unknown }

// Capture the full observable result — output on success, error class name on a
// throw at either compile or evaluate time — so any divergence (including "one
// throws, the other doesn't") is caught. structuredClone isolates each engine's
// run from mutation by the others.
function outcome(compileFn: typeof compileSrc, rules: RuleDefinition[], opts: CompileOptions, f: Facts): Outcome {
  let ev: ReturnType<typeof compileSrc>
  try {
    ev = compileFn(structuredClone(rules), opts)
  } catch (e) {
    return { stage: 'compile', name: (e as Error)?.name ?? String(e) }
  }
  try {
    const r = ev(structuredClone(f))
    return { stage: 'ok', events: r.events, failureEvents: r.failureEvents, results: r.results, failureResults: r.failureResults }
  } catch (e) {
    return { stage: 'eval', name: (e as Error)?.name ?? String(e) }
  }
}

function expectDistMatchesSrc(rules: RuleDefinition[], opts: CompileOptions, f: Facts): void {
  const src = outcome(compileSrc, rules, opts, f)
  expect(outcome(compileCjs, rules, opts, f), 'cjs vs src').toEqual(src)
  expect(outcome(compileEsm, rules, opts, f), 'esm vs src').toEqual(src)
}

test.prop([rulesTied, facts, fc.boolean()])(
  'dist (cjs & esm) equal the source: core',
  (rules, f, allowUndefinedFacts) =>
    expectDistMatchesSrc(rules as RuleDefinition[], { allowUndefinedFacts, operators: CUSTOM_OPS, pathResolver: jp }, f),
)

test.prop([rulesDistinct, facts])(
  'dist (cjs & esm) equal the source: stopOnFirstEvent',
  (rules, f) =>
    expectDistMatchesSrc(
      rules as RuleDefinition[],
      { stopOnFirstEvent: true, allowUndefinedFacts: true, operators: CUSTOM_OPS, pathResolver: jp },
      f,
    ),
)

test.prop([rulesWithRefTied, namedConditions, facts, fc.boolean()])(
  'dist (cjs & esm) equal the source: named conditions',
  (rules, conditions, f, allowUndefinedFacts) =>
    expectDistMatchesSrc(
      rules as RuleDefinition[],
      { allowUndefinedFacts, conditions: conditions as never, operators: CUSTOM_OPS, pathResolver: jp },
      f,
    ),
)
