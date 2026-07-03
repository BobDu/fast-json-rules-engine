import { CompileError, UndefinedFactError } from './errors'
import { resolveOperator, type Evaluate } from './operators'
import { compilePath } from './path'
import type {
  CompiledRules,
  CompileOptions,
  Condition,
  EngineResult,
  Facts,
  PathResolver,
  RuleDefinition,
  RuleResult,
} from './types'

type Predicate = (facts: Facts) => boolean

interface Ctx {
  operators?: CompileOptions['operators']
  conditions?: Record<string, Condition>
  allowUndefinedFacts: boolean
  pathResolver?: PathResolver
}

// json-rules-engine requires a rule's (and named condition's) root to be one of
// all/any/not/condition — a bare leaf at the root is rejected. We match that.
function hasBooleanRoot(cond: unknown): boolean {
  return (
    cond !== null &&
    typeof cond === 'object' &&
    ('all' in cond || 'any' in cond || 'not' in cond || 'condition' in cond)
  )
}

function isValueReference(value: unknown): value is { fact: string; path?: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'fact')
  )
}

/**
 * Build a path applier for a leaf's `path`, honoring a custom resolver.
 *
 * Matches json-rules-engine (almanac.js): the path is applied ONLY when the
 * fact value is a non-null object; for primitives/null/undefined the value is
 * returned unchanged (the path is ignored). This guard precedes the resolver,
 * so it wraps custom resolvers too.
 */
function pathApplier(
  path: string | undefined,
  ctx: Ctx,
): ((value: unknown) => unknown) | null {
  if (path === undefined) return null
  const resolve = ctx.pathResolver
    ? (value: unknown) => ctx.pathResolver!(value, path)
    : compilePath(path)
  return (value) => (value !== null && typeof value === 'object' ? resolve(value) : value)
}

/**
 * Compile a single fact read (optional path) into a closure.
 *
 * Undefined-fact throwing is NOT handled here — it is done by a per-rule
 * presence pre-check (see below), because json-rules-engine evaluates every
 * condition in a priority set (Promise.all, no short-circuit) and throws if any
 * referenced fact is absent. Doing the throw here would let our `&&`/`||`
 * short-circuit hide undefined facts that json-rules-engine surfaces. Moving it
 * to the pre-check lets us keep short-circuit while matching throw behavior.
 */
function factReader(
  factName: string,
  path: string | undefined,
  ctx: Ctx,
): (facts: Facts) => unknown {
  const applyPath = pathApplier(path, ctx)
  if (applyPath === null) return (facts) => facts[factName]
  return (facts) => applyPath(facts[factName])
}

/**
 * Collect every fact name referenced anywhere in a condition tree (leaf facts
 * and value-as-fact references, following named-condition references). Used to
 * build the undefined-fact presence pre-check.
 */
function collectFacts(cond: unknown, ctx: Ctx, acc: Set<string>, stack: Set<string>): void {
  if (cond === null || typeof cond !== 'object') return
  const c = cond as any
  if ('all' in c) {
    if (Array.isArray(c.all)) for (const sub of c.all) collectFacts(sub, ctx, acc, stack)
    return
  }
  if ('any' in c) {
    if (Array.isArray(c.any)) for (const sub of c.any) collectFacts(sub, ctx, acc, stack)
    return
  }
  if ('not' in c) {
    collectFacts(c.not, ctx, acc, stack)
    return
  }
  if ('condition' in c) {
    const name = c.condition
    if (typeof name !== 'string' || stack.has(name)) return
    if (ctx.conditions && Object.prototype.hasOwnProperty.call(ctx.conditions, name)) {
      stack.add(name)
      collectFacts(ctx.conditions[name], ctx, acc, stack)
      stack.delete(name)
    }
    return
  }
  if (typeof c.fact === 'string') acc.add(c.fact)
  if (isValueReference(c.value)) acc.add(c.value.fact)
}

function compileLeaf(cond: any, ctx: Ctx): Predicate {
  if (typeof cond.fact !== 'string') {
    throw new CompileError(
      `Invalid condition: expected a boolean (all/any/not), a { condition } ` +
        `reference, or a leaf with a string "fact" — got ${JSON.stringify(cond)}`,
    )
  }
  if (typeof cond.operator !== 'string') {
    throw new CompileError(`Condition on fact "${cond.fact}" is missing a string "operator"`)
  }

  const evaluate: Evaluate = resolveOperator(cond.operator, ctx.operators)
  const readFact = factReader(cond.fact, cond.path, ctx)

  if (isValueReference(cond.value)) {
    const readValue = factReader(cond.value.fact, cond.value.path, ctx)
    return (facts) => evaluate(readFact(facts), readValue(facts))
  }

  const constant = cond.value
  return (facts) => evaluate(readFact(facts), constant)
}

function compileCondition(cond: Condition, ctx: Ctx, stack: Set<string>): Predicate {
  if (cond === null || typeof cond !== 'object') {
    throw new CompileError(`Invalid condition: ${JSON.stringify(cond)}`)
  }

  if ('all' in cond) {
    if (!Array.isArray(cond.all)) throw new CompileError('"all" must be an array of conditions')
    const subs = cond.all.map((c) => compileCondition(c, ctx, stack))
    const len = subs.length
    return (facts) => {
      for (let i = 0; i < len; i++) if (!subs[i](facts)) return false
      return true
    }
  }

  if ('any' in cond) {
    if (!Array.isArray(cond.any)) throw new CompileError('"any" must be an array of conditions')
    const subs = cond.any.map((c) => compileCondition(c, ctx, stack))
    const len = subs.length
    // json-rules-engine quirk: an empty conditions array evaluates to true for
    // BOTH all and any (prioritizeAndRun returns true when length === 0).
    if (len === 0) return () => true
    return (facts) => {
      for (let i = 0; i < len; i++) if (subs[i](facts)) return true
      return false
    }
  }

  if ('not' in cond) {
    const sub = compileCondition(cond.not, ctx, stack)
    return (facts) => !sub(facts)
  }

  if ('condition' in cond) {
    const name = cond.condition
    if (typeof name !== 'string') throw new CompileError('"condition" reference must be a string')
    if (!ctx.conditions || !Object.prototype.hasOwnProperty.call(ctx.conditions, name)) {
      throw new CompileError(`Unknown named condition: "${name}" (pass it via options.conditions)`)
    }
    if (!hasBooleanRoot(ctx.conditions[name])) {
      throw new CompileError(
        `Named condition "${name}" root must contain a single instance of "all", "any", "not", or "condition"`,
      )
    }
    if (stack.has(name)) {
      throw new CompileError(`Circular condition reference: "${name}"`)
    }
    stack.add(name)
    const compiled = compileCondition(ctx.conditions[name], ctx, stack)
    stack.delete(name)
    return compiled
  }

  return compileLeaf(cond, ctx)
}

interface CompiledRule {
  predicate: Predicate
  event: RuleDefinition['event']
  priority: number
  name?: string
  /** Facts that must be present (only populated when allowUndefinedFacts is false). */
  requiredFacts: string[]
}

/**
 * Compile a json-rules-engine-format rule set into a fast synchronous
 * evaluator. Compilation is eager: malformed rules, unknown operators, and
 * unsupported paths throw {@link CompileError} here rather than misbehaving at
 * evaluation time.
 */
export function compile(
  rules: RuleDefinition | RuleDefinition[],
  options: CompileOptions = {},
): CompiledRules {
  const ruleList = Array.isArray(rules) ? rules : [rules]
  const ctx: Ctx = {
    operators: options.operators,
    conditions: options.conditions,
    allowUndefinedFacts: options.allowUndefinedFacts ?? false,
    pathResolver: options.pathResolver,
  }

  const compiled: CompiledRule[] = ruleList.map((rule, index) => {
    if (rule === null || typeof rule !== 'object' || !('conditions' in rule)) {
      throw new CompileError(`Rule at index ${index} is missing "conditions"`)
    }
    if (!('event' in rule) || rule.event === null || typeof rule.event !== 'object') {
      throw new CompileError(`Rule at index ${index} is missing a valid "event"`)
    }
    if (!hasBooleanRoot(rule.conditions)) {
      throw new CompileError(
        `Rule at index ${index}: "conditions" root must contain a single instance of ` +
          `"all", "any", "not", or "condition"`,
      )
    }
    let requiredFacts: string[] = []
    if (!ctx.allowUndefinedFacts) {
      const acc = new Set<string>()
      collectFacts(rule.conditions, ctx, acc, new Set<string>())
      requiredFacts = Array.from(acc)
    }
    return {
      predicate: compileCondition(rule.conditions, ctx, new Set<string>()),
      event: rule.event,
      priority: typeof rule.priority === 'number' ? rule.priority : 1,
      name: rule.name,
      requiredFacts,
    }
  })

  // Stable sort by priority descending: higher-priority rules evaluate first,
  // input order preserved within a priority (Array.sort is stable on Node >=12).
  const order = compiled
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
    .map((entry) => entry.rule)

  const stopOnFirstEvent = options.stopOnFirstEvent ?? false
  const allowUndefinedFacts = ctx.allowUndefinedFacts
  const count = order.length

  return function evaluate(facts: Facts): EngineResult {
    const events: EngineResult['events'] = []
    const failureEvents: EngineResult['failureEvents'] = []
    const results: RuleResult[] = []
    const failureResults: RuleResult[] = []

    for (let i = 0; i < count; i++) {
      const rule = order[i]
      // Undefined-fact pre-check: json-rules-engine evaluates all conditions in
      // a rule (no short-circuit within a priority set) and throws if any
      // referenced fact is absent. Replicate that here so short-circuit
      // evaluation below cannot hide it. Rules are checked in priority order and
      // only up to a stopOnFirstEvent match, mirroring engine.stop() semantics.
      if (!allowUndefinedFacts) {
        const required = rule.requiredFacts
        for (let k = 0; k < required.length; k++) {
          if (!(required[k] in facts)) throw new UndefinedFactError(required[k])
        }
      }
      const matched = rule.predicate(facts)
      const result: RuleResult = {
        result: matched,
        event: rule.event,
        priority: rule.priority,
        name: rule.name,
      }
      if (matched) {
        events.push(rule.event)
        results.push(result)
        if (stopOnFirstEvent) break
      } else {
        failureEvents.push(rule.event)
        failureResults.push(result)
      }
    }

    return { events, failureEvents, results, failureResults }
  }
}
