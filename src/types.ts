/**
 * Public types for fast-json-rules-engine.
 *
 * The rule/condition/event shapes intentionally mirror the json-rules-engine
 * JSON format so existing rule documents compile unchanged. Runtime-only
 * concepts from json-rules-engine (dynamic fact functions, event handlers,
 * the evaluated-conditions result tree, runtime rule mutation) are not
 * represented here — see README for the supported/unsupported matrix.
 */

/** A reference to another fact used as a condition's compared `value`. */
export interface ValueReference {
  fact: string
  path?: string
  params?: Record<string, unknown>
}

/** A leaf comparison condition: `factValue <operator> value`. */
export interface LeafCondition {
  fact: string
  operator: string
  value: unknown | ValueReference
  path?: string
  params?: Record<string, unknown>
  name?: string
}

/** A reference to a named condition registered via compile options. */
export interface ConditionReference {
  condition: string
  name?: string
}

export interface AllCondition {
  all: Condition[]
  name?: string
}

export interface AnyCondition {
  any: Condition[]
  name?: string
}

export interface NotCondition {
  not: Condition
  name?: string
}

export type Condition =
  | AllCondition
  | AnyCondition
  | NotCondition
  | ConditionReference
  | LeafCondition

export interface Event<Params = Record<string, unknown>> {
  type: string
  params?: Params
}

export interface RuleDefinition {
  conditions: Condition
  event: Event
  /** Higher priority rules are evaluated first. Defaults to 1. */
  priority?: number
  name?: string
}

/**
 * Result for a single rule. Unlike json-rules-engine, this does NOT include the
 * evaluated conditions tree — that per-run deep clone is the cost this library
 * exists to avoid. `result` is the boolean outcome; the event/priority/name
 * echo the rule definition.
 */
export interface RuleResult {
  result: boolean
  event: Event
  priority: number
  name?: string
}

/** The outcome of evaluating a compiled rule set against one facts object. */
export interface EngineResult {
  /** Events of matched rules, ordered by priority descending. */
  events: Event[]
  /** Events of unmatched rules, in the same priority-descending order. */
  failureEvents: Event[]
  results: RuleResult[]
  failureResults: RuleResult[]
}

/** Facts to evaluate against: a plain object of static values. */
export type Facts = Record<string, unknown>

/**
 * A custom operator. `factValue` is the (possibly path-resolved) fact; `value`
 * is the condition's compared value. Return whether the comparison holds.
 */
export type OperatorFn = (factValue: any, value: any) => boolean

/**
 * Resolves a `path` into a fact value. The default resolver supports simple
 * dot/bracket access (`$.a.b`, `$.a[0].b`, `$["a"]`); pass your own (e.g.
 * wrapping jsonpath-plus) for full JSONPath.
 */
export type PathResolver = (value: unknown, path: string) => unknown

export interface CompileOptions {
  /** Additional or overriding operators, by name. */
  operators?: Record<string, OperatorFn>
  /** Named conditions referenced via `{ condition: "name" }`. */
  conditions?: Record<string, Condition>
  /** When false (default), an absent fact throws UndefinedFactError. */
  allowUndefinedFacts?: boolean
  /** Stop after the first (highest-priority) matching rule. Default false. */
  stopOnFirstEvent?: boolean
  /** Override how `path` is resolved into a fact value. */
  pathResolver?: PathResolver
}

/** A compiled rule set: call it with facts to get the evaluation result. */
export type CompiledRules = (facts: Facts) => EngineResult
