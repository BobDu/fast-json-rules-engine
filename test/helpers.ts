import { Engine } from 'json-rules-engine'
import { expect } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { compile } from '../src/index'
import type { CompileOptions, Facts, Rule, RunOptions } from '../src/index'

// Test-combined options: compile-time options plus the per-run stopOnFirstEvent,
// so a single bag drives both engines. Split at the call boundary below.
type TestOptions = CompileOptions & RunOptions

// Test code runs on modern Node (vitest), so it may freely use current APIs like
// structuredClone — which preserves NaN/Infinity/undefined that JSON clone would
// mangle. This is why the differential oracle can faithfully feed edge values.
//
// Our run() returns only `events`, so that is the surface compared against
// json-rules-engine. Events are compared as FULL objects (dropped falsy params,
// dropped extra keys, and params-key presence are all caught), and since they are
// the matched rules' events in priority order, this verifies which rules matched
// and their ordering. json-rules-engine's failureEvents/results/failureResults
// have no counterpart here, so there is nothing else to compare.

type NormEvent = Record<string, unknown>
interface Outcome {
  threw: boolean
  events?: NormEvent[]
  error?: unknown
}

const normEvents = (events: unknown[]): NormEvent[] => events.map((e) => structuredClone(e) as NormEvent)

/** Run the same rules through the real json-rules-engine, capturing throw vs output. */
export async function referenceRun(
  rules: Rule | Rule[],
  facts: Facts,
  options: TestOptions = {},
): Promise<Outcome> {
  try {
    const engineOptions: Record<string, unknown> = {}
    if (options.allowUndefinedFacts !== undefined) engineOptions.allowUndefinedFacts = options.allowUndefinedFacts
    if (options.allowUndefinedConditions !== undefined)
      engineOptions.allowUndefinedConditions = options.allowUndefinedConditions
    const engine = new Engine([], engineOptions)
    if (options.operators)
      for (const [name, fn] of Object.entries(options.operators)) engine.addOperator(name, fn as never)
    if (options.conditions)
      for (const [name, cond] of Object.entries(options.conditions))
        engine.setCondition(name, structuredClone(cond) as never)
    const list = Array.isArray(rules) ? rules : [rules]
    for (const r of list) engine.addRule(structuredClone(r) as never)
    if (options.stopOnFirstEvent) engine.on('success', () => engine.stop())
    const res = await engine.run(facts)
    return { threw: false, events: normEvents(res.events) }
  } catch (error) {
    return { threw: true, error }
  }
}

function evaluateOwn(
  rules: Rule | Rule[],
  facts: Facts,
  options: TestOptions,
): Outcome {
  try {
    const r = compile(rules, options).run(facts, { stopOnFirstEvent: options.stopOnFirstEvent })
    return { threw: false, events: normEvents(r.events) }
  } catch (error) {
    return { threw: true, error }
  }
}

export function isDeepStrictMultisetEqual<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false
  const unmatched = [...right]
  for (const value of left) {
    const index = unmatched.findIndex((candidate) => isDeepStrictEqual(value, candidate))
    if (index === -1) return false
    unmatched.splice(index, 1)
  }
  return true
}

/**
 * Assert our compiled output matches json-rules-engine for the same rules/facts,
 * including "both throw". orderInsensitive compares each surface as a multiset
 * (used when tied priorities make within-priority order implementation-defined).
 */
export async function expectMatch(
  rules: Rule | Rule[],
  facts: Facts,
  options: TestOptions = {},
  cmp: { orderInsensitive?: boolean } = {},
): Promise<void> {
  const ref = await referenceRun(rules, facts, options)
  const mine = evaluateOwn(rules, facts, options)

  expect(mine.threw, `throw mismatch: mine=${mine.threw} ref=${ref.threw}`).toBe(ref.threw)
  if (ref.threw) return

  if (cmp.orderInsensitive) expect(isDeepStrictMultisetEqual(mine.events!, ref.events!)).toBe(true)
  else expect(mine.events!).toEqual(ref.events!)
}

/** Non-throwing variant for fast-check properties: returns true iff engines agree. */
export async function agrees(
  rules: Rule | Rule[],
  facts: Facts,
  options: TestOptions = {},
  cmp: { orderInsensitive?: boolean } = {},
): Promise<boolean> {
  const ref = await referenceRun(rules, facts, options)
  const mine = evaluateOwn(rules, facts, options)
  if (mine.threw || ref.threw) return mine.threw === ref.threw
  return cmp.orderInsensitive
    ? isDeepStrictMultisetEqual(mine.events!, ref.events!)
    : isDeepStrictEqual(mine.events!, ref.events!)
}
