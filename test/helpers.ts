import { Engine } from 'json-rules-engine'
import { expect } from 'vitest'
import { compile } from '../src/index'
import type { CompileOptions, Facts, RuleDefinition } from '../src/index'

// Test code runs on modern Node (vitest), so it may freely use current APIs like
// structuredClone — which preserves NaN/Infinity/undefined that JSON clone would
// mangle. This is why the differential oracle can faithfully feed edge values.

interface NormEvent {
  type: string
  params: unknown
}
interface Outcome {
  threw: boolean
  events?: NormEvent[]
  failureEvents?: NormEvent[]
  error?: unknown
}

const norm = (events: Array<{ type: string; params?: unknown }>): NormEvent[] =>
  events.map((e) => ({ type: e.type, params: e.params }))

/** Run the same rules through the real json-rules-engine, capturing throw vs output. */
export async function referenceRun(
  rules: RuleDefinition | RuleDefinition[],
  facts: Facts,
  options: CompileOptions = {},
): Promise<Outcome> {
  try {
    const engine = new Engine(
      [],
      options.allowUndefinedFacts !== undefined
        ? { allowUndefinedFacts: options.allowUndefinedFacts }
        : {},
    )
    if (options.operators)
      for (const [name, fn] of Object.entries(options.operators)) engine.addOperator(name, fn as never)
    if (options.conditions)
      for (const [name, cond] of Object.entries(options.conditions))
        engine.setCondition(name, structuredClone(cond) as never)
    const list = Array.isArray(rules) ? rules : [rules]
    for (const r of list) engine.addRule(structuredClone(r) as never)
    if (options.stopOnFirstEvent) engine.on('success', () => engine.stop())
    const res = await engine.run(facts)
    return { threw: false, events: norm(res.events), failureEvents: norm(res.failureEvents) }
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
    return { threw: false, events: norm(r.events), failureEvents: norm(r.failureEvents) }
  } catch (error) {
    return { threw: true, error }
  }
}

const sortEvents = (evs: NormEvent[]): NormEvent[] =>
  [...evs].sort(
    (a, b) =>
      (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) ||
      (JSON.stringify(a.params) < JSON.stringify(b.params) ? -1 : 1),
  )

/**
 * Assert our compiled output matches json-rules-engine for the same rules/facts,
 * including "both throw". orderInsensitive compares events as a multiset (used
 * when tied priorities make within-priority order implementation-defined).
 * Returns whether the two agreed — so fuzz callers can return a boolean.
 */
export async function expectMatch(
  rules: RuleDefinition | RuleDefinition[],
  facts: Facts,
  options: CompileOptions = {},
  cmp: { orderInsensitive?: boolean } = {},
): Promise<void> {
  const ref = await referenceRun(rules, facts, options)
  const mine = evaluateOwn(rules, facts, options)

  expect(
    mine.threw,
    `throw mismatch: mine=${mine.threw} ref=${ref.threw}`,
  ).toBe(ref.threw)
  if (ref.threw) return

  const pick = cmp.orderInsensitive ? sortEvents : (x: NormEvent[]) => x
  expect(pick(mine.events!)).toEqual(pick(ref.events!))
  expect(pick(mine.failureEvents!)).toEqual(pick(ref.failureEvents!))
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
  const pick = cmp.orderInsensitive ? sortEvents : (x: NormEvent[]) => x
  return (
    JSON.stringify(pick(mine.events!)) === JSON.stringify(pick(ref.events!)) &&
    JSON.stringify(pick(mine.failureEvents!)) === JSON.stringify(pick(ref.failureEvents!))
  )
}
