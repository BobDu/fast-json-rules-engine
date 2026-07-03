/**
 * Thrown at evaluation time when a rule references a fact that is not present
 * on the facts object and `allowUndefinedFacts` is false (the default).
 *
 * Mirrors json-rules-engine's UndefinedFactError so callers migrating from it
 * can catch the same failure mode.
 */
export class UndefinedFactError extends Error {
  code = 'UNDEFINED_FACT'

  constructor(factId: string) {
    super(`Undefined fact: ${factId}`)
    this.name = 'UndefinedFactError'
    // Restore prototype chain for instanceof across the TS -> ES2020 downlevel.
    Object.setPrototypeOf(this, UndefinedFactError.prototype)
  }
}

/**
 * Thrown at compile time when a rule set cannot be turned into an evaluator:
 * unknown operator, malformed condition, unsupported jsonpath, missing named
 * condition, or a condition-reference cycle. Compiling eagerly surfaces these
 * as loud failures instead of silent wrong answers at runtime.
 */
export class CompileError extends Error {
  code = 'COMPILE_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'CompileError'
    Object.setPrototypeOf(this, CompileError.prototype)
  }
}
