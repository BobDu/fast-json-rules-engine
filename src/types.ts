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
  /**
   * The compared value: a literal, or a {@link ValueReference} (`{ fact, path? }`)
   * to compare against another fact. Typed `unknown` because `unknown | ValueReference`
   * collapses to `unknown` anyway.
   */
  value: unknown
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

/**
 * A condition valid at the ROOT of a rule (or a named condition): a boolean
 * (all/any/not) or a condition reference. A bare leaf at the root is rejected at
 * compile time, matching json-rules-engine — so the root type excludes LeafCondition.
 */
export type TopLevelCondition = AllCondition | AnyCondition | NotCondition | ConditionReference

export interface Event<Params = Record<string, unknown>> {
  type: string
  params?: Params
}

export interface Rule {
  conditions: TopLevelCondition
  event: Event
  /** Higher priority rules are evaluated first. Defaults to 1. */
  priority?: number
  name?: string
}

/**
 * The outcome of evaluating a compiled rule set against one facts object.
 *
 * Only `events` is returned. json-rules-engine additionally exposes
 * `failureEvents`, `results`, `failureResults`, and an `almanac`; those carry
 * per-rule metadata and the per-run deep-cloned condition tree that this library
 * does not produce. They are not supported here — read `events` (highest-priority
 * match first).
 */
export interface EngineResult {
  /** Events of matched rules, ordered by priority descending. */
  events: Event[]
}

/**
 * Facts to evaluate against: a plain object of static values. Typed with `any`
 * values (mirroring json-rules-engine's `run(facts: Record<string, any>)`) so
 * that interface-typed facts objects — which lack an implicit index signature —
 * are accepted at the call site. Internally, fact values are read as `unknown`.
 */
export type Facts = Record<string, any>

/**
 * A custom operator. `factValue` is the (possibly path-resolved) fact; `value`
 * is the condition's compared value. Return whether the comparison holds. The
 * `any` defaults are deliberate (operators accept arbitrary fact JSON, mirroring
 * json-rules-engine's OperatorEvaluator); type the parameters when you know them.
 */
export type OperatorFn<A = any, B = any> = (factValue: A, value: B) => boolean

/**
 * Resolves a `path` into an object-valued fact. No JSONPath engine is bundled —
 * a `path` requires this resolver, or compilation throws `CompileError`. Pass
 * jsonpath-plus for behavior identical to json-rules-engine, e.g.
 * `(value, path) => JSONPath({ path, json: value, wrap: false })`.
 */
export type PathResolver = (value: object, path: string) => unknown

export interface CompileOptions {
  /** Additional or overriding operators, by name. */
  operators?: Record<string, OperatorFn>
  /** Named conditions referenced via `{ condition: "name" }`. Each root must be boolean/reference. */
  conditions?: Record<string, TopLevelCondition>
  /** When false (default), an absent fact throws UndefinedFactError. */
  allowUndefinedFacts?: boolean
  /**
   * When true, a `{ condition }` reference to an unknown named condition compiles
   * to `false` instead of throwing (matches json-rules-engine). Default false.
   */
  allowUndefinedConditions?: boolean
  /** Override how `path` is resolved into a fact value. */
  pathResolver?: PathResolver
}

/**
 * Per-run options for {@link CompiledRules.run}. Named after json-rules-engine's
 * `RunOptions`; the fields differ (upstream carries an `almanac`, unsupported here).
 */
export interface RunOptions {
  /** Stop after the first (highest-priority) matching rule. Default false. */
  stopOnFirstEvent?: boolean
}

/** A compiled rule set. Call {@link CompiledRules.run} with facts to evaluate. */
export interface CompiledRules {
  /**
   * Evaluate the compiled rules against a facts object. Synchronous: returns the
   * result directly (not a Promise), so `await` is unnecessary but harmless. Pass
   * `{ stopOnFirstEvent: true }` to stop at the first (highest-priority) match.
   */
  run(facts: Facts, options?: RunOptions): EngineResult
}
