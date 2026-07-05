import { Engine } from 'json-rules-engine'
import { expect } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { compile } from '../src/index'
import type { CompileOptions, Facts, RuleDefinition } from '../src/index'

// Test code runs on modern Node (vitest), so it may freely use current APIs like
// structuredClone — which preserves NaN/Infinity/undefined that JSON clone would
// mangle. This is why the differential oracle can faithfully feed edge values.
//
// All four output surfaces are compared as FULL objects against json-rules-engine:
// events / failureEvents (whole event objects, so dropped falsy params, dropped
// extra keys, and params-key presence are caught — see B2) AND results /
// failureResults as { result, name, event } tuples (so result.name / result.result
// and the normalized result.event are verified, not just events).

type NormEvent = Record<string, unknown>
interface NormResult {
  result: boolean
  name: unknown
  event: NormEvent
}
interface Outcome {
  threw: boolean
  events?: NormEvent[]
  failureEvents?: NormEvent[]
  results?: NormResult[]
  failureResults?: NormResult[]
  error?: unknown
}

const normEvents = (events: unknown[]): NormEvent[] => events.map((e) => structuredClone(e) as NormEvent)
const normResults = (rs: Array<{ result: boolean; name?: unknown; event: unknown }>): NormResult[] =>
  rs.map((r) => ({ result: r.result, name: r.name ?? null, event: structuredClone(r.event) as NormEvent }))

/** Run the same rules through the real json-rules-engine, capturing throw vs output. */
export async function referenceRun(
  rules: RuleDefinition | RuleDefinition[],
  facts: Facts,
  options: CompileOptions = {},
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
    return {
      threw: false,
      events: normEvents(res.events),
      failureEvents: normEvents(res.failureEvents),
      results: normResults(res.results as never),
      failureResults: normResults(res.failureResults as never),
    }
  } catch (error) {
    return { threw: true, error }
  }
}

function evaluateOwn(
  rules: RuleDefinition | RuleDefinition[],
  facts: Facts,
  options: CompileOptions,
): Outcome {
  try {
    const r = compile(rules, options)(facts)
    return {
      threw: false,
      events: normEvents(r.events),
      failureEvents: normEvents(r.failureEvents),
      results: normResults(r.results),
      failureResults: normResults(r.failureResults),
    }
  } catch (error) {
    return { threw: true, error }
  }
}

const key = (x: unknown): string => JSON.stringify(x)
const sortBy = <T>(xs: T[]): T[] => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))

/**
 * Assert our compiled output matches json-rules-engine for the same rules/facts,
 * including "both throw". orderInsensitive compares each surface as a multiset
 * (used when tied priorities make within-priority order implementation-defined).
 */
export async function expectMatch(
  rules: RuleDefinition | RuleDefinition[],
  facts: Facts,
  options: CompileOptions = {},
  cmp: { orderInsensitive?: boolean } = {},
): Promise<void> {
  const ref = await referenceRun(rules, facts, options)
  const mine = evaluateOwn(rules, facts, options)

  expect(mine.threw, `throw mismatch: mine=${mine.threw} ref=${ref.threw}`).toBe(ref.threw)
  if (ref.threw) return

  const pick = cmp.orderInsensitive ? sortBy : <T>(x: T[]) => x
  expect(pick(mine.events!)).toEqual(pick(ref.events!))
  expect(pick(mine.failureEvents!)).toEqual(pick(ref.failureEvents!))
  expect(pick(mine.results!)).toEqual(pick(ref.results!))
  expect(pick(mine.failureResults!)).toEqual(pick(ref.failureResults!))
}

/** Non-throwing variant for fast-check properties: returns true iff engines agree. */
export async function agrees(
  rules: RuleDefinition | RuleDefinition[],
  facts: Facts,
  options: CompileOptions = {},
  cmp: { orderInsensitive?: boolean } = {},
): Promise<boolean> {
  const ref = await referenceRun(rules, facts, options)
  const mine = evaluateOwn(rules, facts, options)
  if (mine.threw || ref.threw) return mine.threw === ref.threw
  const pick = cmp.orderInsensitive ? sortBy : <T>(x: T[]) => x
  return (
    isDeepStrictEqual(pick(mine.events!), pick(ref.events!)) &&
    isDeepStrictEqual(pick(mine.failureEvents!), pick(ref.failureEvents!)) &&
    isDeepStrictEqual(pick(mine.results!), pick(ref.results!)) &&
    isDeepStrictEqual(pick(mine.failureResults!), pick(ref.failureResults!))
  )
}
