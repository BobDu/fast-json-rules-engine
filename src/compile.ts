import { CompileError, UndefinedFactError } from './errors'
import { resolveOperator, type Evaluate } from './operators'
import type {
  AllCondition,
  AnyCondition,
  CompiledRules,
  CompileOptions,
  Condition,
  ConditionReference,
  EngineResult,
  Event,
  Facts,
  NotCondition,
  PathResolver,
  RuleDefinition,
  RuleResult,
} from './types'

type Predicate = (facts: Facts) => boolean

interface Ctx {
  operators?: CompileOptions['operators']
  conditions?: Record<string, Condition>
  allowUndefinedFacts: boolean
  allowUndefinedConditions: boolean
  pathResolver?: PathResolver
  // Memoize each named condition's compiled predicate, its fact set, and its
  // expanded depth, so a name referenced N times is compiled/collected/measured
  // once. Without this, fan-out chains of named conditions blow up exponentially
  // (compile-time DoS).
  condPredMemo: Map<string, Predicate>
  conditionFactMemo: Map<string, Set<string>>
  condDepthMemo: Map<string, number>
}

// Max condition nesting depth. Bounds both compile recursion and the eval-time
// closure call stack, so a pathologically deep tree fails loud with a
// CompileError instead of a raw RangeError / stack overflow.
const MAX_DEPTH = 512

// Shared predicate for an unknown named condition under allowUndefinedConditions.
const FALSE_PREDICATE: Predicate = () => false

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key)

// json-rules-engine requires a rule's (and named condition's) root to be one of
// all/any/not/condition — a bare leaf at the root is rejected. We match that.
function hasBooleanRoot(cond: unknown): boolean {
  return (
    cond !== null &&
    typeof cond === 'object' &&
    (hasOwn(cond, 'all') || hasOwn(cond, 'any') || hasOwn(cond, 'not') || hasOwn(cond, 'condition'))
  )
}

function isValueReference(value: unknown): value is { fact: unknown; path?: string } {
  return value !== null && typeof value === 'object' && hasOwn(value, 'fact')
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
 * A FALSY path ('' / null / undefined) means "no path" — matching json-rules-engine
 * (almanac.js gates on `if (path)`), so an empty path reads the raw fact value.
 * The non-null-object guard also matches json-rules-engine: a path is applied
 * ONLY when the fact value is a non-null object; primitives/null/undefined pass
 * through unchanged. The guard precedes the resolver.
 */
function pathApplier(
  path: string | undefined,
  ctx: Ctx,
): ((value: unknown) => unknown) | null {
  if (!path) return null
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
 * json-rules-engine builds its fact map from the facts object's OWN properties,
 * so a fact name matching an inherited member (toString/constructor/…) is NOT a
 * fact. When allowUndefinedFacts is true we therefore guard with hasOwn so such
 * names read as undefined. When it's false, the per-rule presence pre-check has
 * already asserted the fact is an own property before evaluation, so we read it
 * directly — no second own-property check per read.
 *
 * (Aside: json-rules-engine skips inherited members simply because
 * Object.prototype's members are non-enumerable and its fact map is built via
 * for...in; hasOwn additionally excludes inherited ENUMERABLE members, a small
 * deliberate divergence with no practical effect on plain fact objects.)
 */
function factReader(
  factName: string,
  path: string | undefined,
  ctx: Ctx,
): (facts: Facts) => unknown {
  const applyPath = pathApplier(path, ctx)
  const read: (facts: Facts) => unknown = ctx.allowUndefinedFacts
    ? (facts) => (hasOwn(facts, factName) ? facts[factName] : undefined)
    : (facts) => facts[factName]
  if (applyPath === null) return read
  return (facts) => applyPath(read(facts))
}

/**
 * Collect every fact name referenced anywhere in a condition tree (leaf facts
 * and value-as-fact references, following named-condition references). Used to
 * build the undefined-fact presence pre-check.
 */
function collectFacts(cond: unknown, ctx: Ctx, acc: Set<string>, stack: Set<string>): void {
  // Recursion is depth-bounded by assertDepth (run first, per rule), so there is
  // no depth guard here.
  if (cond === null || typeof cond !== 'object') return
  const c = cond as Record<string, unknown>
  // Key precedence must match compileCondition (any > all > not > condition) so
  // that a malformed both-all-and-any condition collects the same branch it evaluates.
  if (hasOwn(c, 'any')) {
    if (Array.isArray(c.any)) for (const sub of c.any) collectFacts(sub, ctx, acc, stack)
    return
  }
  if (hasOwn(c, 'all')) {
    if (Array.isArray(c.all)) for (const sub of c.all) collectFacts(sub, ctx, acc, stack)
    return
  }
  if (hasOwn(c, 'not')) {
    collectFacts(c.not, ctx, acc, stack)
    return
  }
  if (hasOwn(c, 'condition')) {
    const name = c.condition
    if (typeof name !== 'string' || stack.has(name)) return
    const memo = ctx.conditionFactMemo.get(name)
    if (memo) {
      for (const f of memo) acc.add(f)
      return
    }
    if (ctx.conditions && hasOwn(ctx.conditions, name)) {
      const sub = new Set<string>()
      stack.add(name)
      collectFacts(ctx.conditions[name], ctx, sub, stack)
      stack.delete(name)
      ctx.conditionFactMemo.set(name, sub)
      for (const f of sub) acc.add(f)
    }
    return
  }
  if (typeof c.fact === 'string') acc.add(c.fact)
  if (isValueReference(c.value) && typeof c.value.fact === 'string') acc.add(c.value.fact)
}

/**
 * Measure the FULLY EXPANDED depth of a condition tree (following named-condition
 * references), which equals the eval-time closure call-stack depth, and throw if
 * it exceeds MAX_DEPTH. compileCondition's own per-call guard cannot see depth
 * accumulated across a MEMOIZED named-condition reference (it returns the cached
 * predicate without re-descending), so a shallow-seeded deep chain would compile
 * yet overflow the stack at eval. This pass makes the MAX_DEPTH guarantee total;
 * relative depth per name is memoized, so it stays linear in distinct definitions.
 */
function assertDepth(cond: unknown, ctx: Ctx, stack: Set<string>, depth: number): number {
  if (depth > MAX_DEPTH) {
    throw new CompileError(`Condition nesting exceeds the maximum supported depth (${MAX_DEPTH})`)
  }
  if (cond === null || typeof cond !== 'object') return depth
  const c = cond as Record<string, unknown>
  if (hasOwn(c, 'any')) {
    if (!Array.isArray(c.any)) return depth
    let max = depth
    for (const sub of c.any) max = Math.max(max, assertDepth(sub, ctx, stack, depth + 1))
    return max
  }
  if (hasOwn(c, 'all')) {
    if (!Array.isArray(c.all)) return depth
    let max = depth
    for (const sub of c.all) max = Math.max(max, assertDepth(sub, ctx, stack, depth + 1))
    return max
  }
  if (hasOwn(c, 'not')) return assertDepth(c.not, ctx, stack, depth + 1)
  if (hasOwn(c, 'condition')) {
    const name = c.condition
    if (typeof name !== 'string' || stack.has(name)) return depth
    const memo = ctx.condDepthMemo.get(name)
    if (memo !== undefined) {
      const total = depth + 1 + memo
      if (total > MAX_DEPTH) {
        throw new CompileError(`Condition nesting exceeds the maximum supported depth (${MAX_DEPTH})`)
      }
      return total
    }
    if (ctx.conditions && hasOwn(ctx.conditions, name)) {
      stack.add(name)
      const abs = assertDepth(ctx.conditions[name], ctx, stack, depth + 1)
      stack.delete(name)
      ctx.condDepthMemo.set(name, abs - (depth + 1))
      return abs
    }
    return depth
  }
  return depth
}

function compileLeaf(cond: Record<string, unknown>, ctx: Ctx): Predicate {
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
  const readFact = factReader(cond.fact, cond.path as string | undefined, ctx)

  if (isValueReference(cond.value)) {
    // A value fact-reference must name a string fact; json-rules-engine keys its
    // fact map with strings, so a non-string ref would silently misread here.
    if (typeof cond.value.fact !== 'string') {
      throw new CompileError(
        `Condition on fact "${cond.fact}": a value fact reference must have a string "fact"`,
      )
    }
    const readValue = factReader(cond.value.fact, cond.value.path, ctx)
    return (facts) => evaluate(readFact(facts), readValue(facts))
  }

  const constant = cond.value
  return (facts) => evaluate(readFact(facts), constant)
}

function compileCondition(cond: Condition, ctx: Ctx, stack: Set<string>): Predicate {
  // Recursion is depth-bounded by assertDepth (run first, per rule).
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
  // any > all > not (> condition reference). hasOwn (not `in`) matches upstream's
  // hasOwnProperty checks, so an inherited boolean key is not treated as one.
  if (hasOwn(cond, 'any')) {
    const arr = (cond as AnyCondition).any
    if (!Array.isArray(arr)) throw new CompileError('"any" must be an array of conditions')
    const subs = arr.map((c) => compileCondition(c, ctx, stack))
    const len = subs.length
    // json-rules-engine quirk: an empty conditions array evaluates to true for
    // BOTH all and any (prioritizeAndRun returns true when length === 0).
    if (len === 0) return () => true
    return (facts) => {
      for (let i = 0; i < len; i++) if (subs[i](facts)) return true
      return false
    }
  }

  if (hasOwn(cond, 'all')) {
    const arr = (cond as AllCondition).all
    if (!Array.isArray(arr)) throw new CompileError('"all" must be an array of conditions')
    const subs = arr.map((c) => compileCondition(c, ctx, stack))
    const len = subs.length
    return (facts) => {
      for (let i = 0; i < len; i++) if (!subs[i](facts)) return false
      return true
    }
  }

  if (hasOwn(cond, 'not')) {
    const sub = compileCondition((cond as NotCondition).not, ctx, stack)
    return (facts) => !sub(facts)
  }

  if (hasOwn(cond, 'condition')) {
    const name = (cond as ConditionReference).condition
    if (typeof name !== 'string') throw new CompileError('"condition" reference must be a string')
    const cached = ctx.condPredMemo.get(name)
    if (cached) return cached
    if (!ctx.conditions || !hasOwn(ctx.conditions, name)) {
      if (ctx.allowUndefinedConditions) return FALSE_PREDICATE
      throw new CompileError(
        `Unknown named condition: "${name}" (pass it via options.conditions, or set allowUndefinedConditions: true)`,
      )
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
    ctx.condPredMemo.set(name, compiled)
    return compiled
  }

  return compileLeaf(cond as unknown as Record<string, unknown>, ctx)
}

interface CompiledRule {
  predicate: Predicate
  event: RuleDefinition['event']
  priority: number
  name?: string
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
  // We have no runtime almanac, so json-rules-engine's (non-default)
  // replaceFactsInEventParams — substituting { fact } references inside event
  // params at run time — can't be honored. Reject it loudly rather than silently
  // ignore the option; resolve such references after evaluate() instead.
  if ((options as { replaceFactsInEventParams?: unknown }).replaceFactsInEventParams) {
    throw new CompileError(
      'options.replaceFactsInEventParams is not supported: this engine has no runtime almanac to resolve fact references inside event params. Resolve them after evaluate(), or remove the option.',
    )
  }
  const ruleList = Array.isArray(rules) ? rules : [rules]
  const ctx: Ctx = {
    operators: options.operators,
    conditions: options.conditions,
    allowUndefinedFacts: options.allowUndefinedFacts ?? false,
    allowUndefinedConditions: options.allowUndefinedConditions ?? false,
    pathResolver: options.pathResolver,
    condPredMemo: new Map(),
    conditionFactMemo: new Map(),
    condDepthMemo: new Map(),
  }

  const allRequired = new Set<string>()
  const compiled: CompiledRule[] = ruleList.map((rule, index) => {
    if (rule === null || typeof rule !== 'object' || !hasOwn(rule, 'conditions')) {
      throw new CompileError(`Rule at index ${index} is missing "conditions"`)
    }
    if (
      !hasOwn(rule, 'event') ||
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
    // Bound the fully-expanded (named-condition-inlined) depth up front, so the
    // eval-time closure stack can never overflow even through memoized references.
    assertDepth(rule.conditions, ctx, new Set<string>(), 0)
    // Undefined-fact pre-check is GLOBAL (union across all rules), not per-rule:
    // json-rules-engine evaluates every rule (no engine.stop by default) and
    // rejects if any referenced fact is absent, so a rule set referencing a
    // missing fact fails loud regardless of short-circuit OR stopOnFirstEvent —
    // closing the hole where an early match swallowed a sibling's UndefinedFactError.
    if (!ctx.allowUndefinedFacts) {
      collectFacts(rule.conditions, ctx, allRequired, new Set<string>())
    }
    // Match json-rules-engine's setPriority: (priority || 1), parseInt, and
    // reject <= 0 (so negatives and fractions in (-1,1) throw; 2.9 -> 2). Unlike
    // upstream (which stores NaN for an unparseable priority and runs anyway), an
    // unparseable priority throws here — a deliberate fail-loud divergence.
    const priority = parseInt(String(rule.priority || 1), 10)
    if (!(priority > 0)) {
      throw new CompileError(
        `Rule at index ${index}: priority must parse to a positive integer (got ${JSON.stringify(rule.priority)})`,
      )
    }
    // Normalize the event to json-rules-engine's shape ONCE here (not per eval —
    // matching upstream's one-time setEvent, so zero hot-path cost): a fresh
    // { type } with params attached only when truthy; falsy params and any keys
    // other than type/params are dropped. The fresh wrapper means we never hand
    // back the caller's rule.event object; note params still ALIASES the source
    // rule's params sub-object (no per-run deep clone), so returned events are
    // read-only.
    const src = rule.event as { type: string; params?: unknown }
    const event: Event = { type: src.type }
    // params may be any value (json-rules-engine keeps it verbatim); the Event
    // type models the common object case, so cast at this one assignment.
    if (src.params) event.params = src.params as Record<string, unknown>
    return {
      predicate: compileCondition(rule.conditions, ctx, new Set<string>()),
      event,
      priority,
      // Match json-rules-engine: a falsy rule name (e.g. "") is treated as no name.
      name: rule.name || undefined,
    }
  })

  const requiredFacts = Array.from(allRequired)

  // Stable sort by priority descending: higher-priority rules evaluate first,
  // input order preserved within a priority (Array.sort is stable on Node >=12).
  const order = compiled
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
    .map((entry) => entry.rule)

  const stopOnFirstEvent = options.stopOnFirstEvent ?? false
  const allowUndefinedFacts = ctx.allowUndefinedFacts
  const count = order.length
  const requiredCount = requiredFacts.length

  return function evaluate(facts: Facts): EngineResult {
    // Global undefined-fact pre-check (see compile above): any absent referenced
    // fact throws before evaluation, so short-circuit / stopOnFirstEvent cannot
    // hide it. Skipped when allowUndefinedFacts is true.
    if (!allowUndefinedFacts) {
      for (let k = 0; k < requiredCount; k++) {
        if (!hasOwn(facts, requiredFacts[k])) throw new UndefinedFactError(requiredFacts[k])
      }
    }

    const events: EngineResult['events'] = []
    const failureEvents: EngineResult['failureEvents'] = []
    const results: RuleResult[] = []
    const failureResults: RuleResult[] = []

    for (let i = 0; i < count; i++) {
      const rule = order[i]
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
