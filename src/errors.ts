/**
 * Thrown at evaluation time when a rule references a fact that is not present
 * on the facts object and `allowUndefinedFacts` is false (the default).
 *
 * Mirrors json-rules-engine's UndefinedFactError so callers migrating from it
 * can catch the same failure mode. `factId` exposes the missing fact name
 * programmatically (no need to parse the message).
 */
export class UndefinedFactError extends Error {
  readonly code = 'UNDEFINED_FACT'
  readonly factId: string

  constructor(factId: string) {
    super(`Undefined fact: ${factId}`)
    this.name = 'UndefinedFactError'
    this.factId = factId
    // Restore prototype chain for instanceof across the TS -> ES2020 downlevel.
    Object.setPrototypeOf(this, UndefinedFactError.prototype)
  }
}

/**
 * Thrown at compile time when a rule set cannot be turned into an evaluator:
 * unknown operator, malformed condition, unsupported jsonpath, missing named
 * condition, or a condition-reference cycle. Compiling eagerly surfaces these
 * as loud failures instead of silent wrong answers at runtime. `ruleIndex`, when
 * set, is the index of the offending rule in the array passed to `compile`.
 */
export class CompileError extends Error {
  readonly code = 'COMPILE_ERROR'
  readonly ruleIndex?: number

  constructor(message: string, options?: { ruleIndex?: number }) {
    super(message)
    this.name = 'CompileError'
    if (options?.ruleIndex !== undefined) this.ruleIndex = options.ruleIndex
    Object.setPrototypeOf(this, CompileError.prototype)
  }
}
