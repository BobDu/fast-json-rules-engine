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

function isValueReference(value: unknown): value is { fact: string; path?: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'fact')
  )
}

/** Build a path applier for a leaf's `path`, honoring a custom resolver. */
function pathApplier(
  path: string | undefined,
  ctx: Ctx,
): ((value: unknown) => unknown) | null {
  if (path === undefined) return null
  if (ctx.pathResolver) {
    const resolver = ctx.pathResolver
    return (value) => resolver(value, path)
  }
  return compilePath(path)
}

/** Compile a single fact read (definedness + optional path) into a closure. */
function factReader(
  factName: string,
  path: string | undefined,
  ctx: Ctx,
): (facts: Facts) => unknown {
  const applyPath = pathApplier(path, ctx)
  const allowUndefined = ctx.allowUndefinedFacts

  if (applyPath === null) {
    if (allowUndefined) return (facts) => facts[factName]
    return (facts) => {
      if (!(factName in facts)) throw new UndefinedFactError(factName)
      return facts[factName]
    }
  }

  if (allowUndefined) return (facts) => applyPath(facts[factName])
  return (facts) => {
    if (!(factName in facts)) throw new UndefinedFactError(factName)
    return applyPath(facts[factName])
  }
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
    return {
      predicate: compileCondition(rule.conditions, ctx, new Set<string>()),
      event: rule.event,
      priority: typeof rule.priority === 'number' ? rule.priority : 1,
      name: rule.name,
    }
  })

  // Stable sort by priority descending: higher-priority rules evaluate first,
  // input order preserved within a priority (Array.sort is stable on Node >=12).
  const order = compiled
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
    .map((entry) => entry.rule)

  const stopOnFirstEvent = options.stopOnFirstEvent ?? false
  const count = order.length

  return function evaluate(facts: Facts): EngineResult {
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
