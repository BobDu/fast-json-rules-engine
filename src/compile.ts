import { CompileError, UndefinedFactError } from './errors'
import { resolveOperator, type Evaluate } from './operators'
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

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key)

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
 * Build a path applier for a leaf's `path`.
 *
 * This library does NOT bundle a JSONPath implementation — reimplementing
 * jsonpath-plus's exact semantics (leading-zero indices, own-vs-inherited
 * members, truthiness-based descent, …) is a correctness liability. A `path`
 * therefore requires an explicit `pathResolver`; pass jsonpath-plus for
 * behavior identical to json-rules-engine. Absent one, we fail loud at compile.
 *
 * The non-null-object guard matches json-rules-engine (almanac.js): a path is
 * applied ONLY when the fact value is a non-null object; primitives/null/
 * undefined are returned unchanged. The guard precedes the resolver.
 */
function pathApplier(
  path: string | undefined,
  ctx: Ctx,
): ((value: unknown) => unknown) | null {
  if (path === undefined) return null
  if (!ctx.pathResolver) {
    throw new CompileError(
      `Condition uses "path" ("${path}") but no pathResolver was provided. ` +
        `fast-json-rules-engine does not bundle a JSONPath implementation; pass ` +
        `options.pathResolver, e.g. (value, p) => JSONPath({ path: p, json: value, wrap: false }) ` +
        `from jsonpath-plus for behavior identical to json-rules-engine.`,
    )
  }
  const resolve = ctx.pathResolver
  return (value) => (value !== null && typeof value === 'object' ? resolve(value, path) : value)
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
  // Own-property read: json-rules-engine builds its fact map from `for...in` +
  // Map, so inherited members (toString/constructor/…) are NOT facts. A raw
  // `facts[name]` would resolve those from the prototype chain; guard with hasOwn.
  const applyPath = pathApplier(path, ctx)
  if (applyPath === null) return (facts) => (hasOwn(facts, factName) ? facts[factName] : undefined)
  return (facts) => applyPath(hasOwn(facts, factName) ? facts[factName] : undefined)
}

/**
 * Collect every fact name referenced anywhere in a condition tree (leaf facts
 * and value-as-fact references, following named-condition references). Used to
 * build the undefined-fact presence pre-check.
 */
function collectFacts(cond: unknown, ctx: Ctx, acc: Set<string>, stack: Set<string>): void {
  if (cond === null || typeof cond !== 'object') return
  const c = cond as any
  // Key precedence must match compileCondition (any > all > not > condition) so
  // that a malformed both-all-and-any condition collects the same branch it evaluates.
  if ('any' in c) {
    if (Array.isArray(c.any)) for (const sub of c.any) collectFacts(sub, ctx, acc, stack)
    return
  }
  if ('all' in c) {
    if (Array.isArray(c.all)) for (const sub of c.all) collectFacts(sub, ctx, acc, stack)
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
  // json-rules-engine's Condition constructor requires a "value" property.
  if (!hasOwn(cond, 'value')) {
    throw new CompileError(`Condition on fact "${cond.fact}" is missing a "value"`)
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
  // Sub-condition priorities drive json-rules-engine's between-priority-set
  // short-circuit — a runtime-ordering feature that has no meaning once rules
  // are compiled over static facts. Rather than silently ignore it (which would
  // mis-handle undefined-fact throwing), reject it loudly.
  if (hasOwn(cond, 'priority')) {
    throw new CompileError(
      `Sub-condition priorities are not supported (found "priority" on a nested condition); ` +
        `remove it or restructure the rule.`,
    )
  }

  // Key precedence matches json-rules-engine's Condition.booleanOperator:
  // any > all > not (> condition reference).
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

  if ('all' in cond) {
    if (!Array.isArray(cond.all)) throw new CompileError('"all" must be an array of conditions')
    const subs = cond.all.map((c) => compileCondition(c, ctx, stack))
    const len = subs.length
    return (facts) => {
      for (let i = 0; i < len; i++) if (!subs[i](facts)) return false
      return true
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
    if (
      !('event' in rule) ||
      rule.event === null ||
      typeof rule.event !== 'object' ||
      Array.isArray(rule.event)
    ) {
      throw new CompileError(`Rule at index ${index} is missing a valid "event"`)
    }
    if (!hasOwn(rule.event as object, 'type')) {
      throw new CompileError(`Rule at index ${index}: "event" requires a "type" property`)
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
    // Match json-rules-engine's setPriority: (priority || 1), parseInt, and
    // reject <= 0 (so negatives and fractions in (-1,1) throw; 2.9 -> 2).
    const priority = parseInt(String(rule.priority || 1), 10)
    if (!(priority > 0)) {
      throw new CompileError(
        `Rule at index ${index}: priority must parse to a positive integer (got ${JSON.stringify(rule.priority)})`,
      )
    }
    return {
      predicate: compileCondition(rule.conditions, ctx, new Set<string>()),
      event: rule.event,
      priority,
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
          if (!hasOwn(facts, required[k])) throw new UndefinedFactError(required[k])
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
