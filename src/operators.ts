import { CompileError } from './errors'
import type { OperatorFn } from './types'

/**
 * Operator + decorator semantics, replicated exactly from json-rules-engine
 * 6.6.0 (verified against dist/engine-default-operators.js and
 * dist/engine-default-operator-decorators.js). This is the correctness core:
 * differential fuzzing against the real library guards it.
 */

export type Evaluate = (factValue: any, value: any) => boolean

interface OperatorSpec {
  cb: (a: any, b: any) => boolean
  /** Gate: if it returns false the operator is false without running `cb`. */
  validator: (a: any) => boolean
}

// Sentinel validator: specs whose validator IS `alwaysValid` skip the validator
// layer entirely (compared by reference when building the evaluator), so this
// body never actually runs — it exists only as an identity to branch on.
/* v8 ignore next */
const alwaysValid = (): boolean => true

// json-rules-engine numberValidator: Number.parseFloat(x).toString() !== 'NaN'
const numberValidator = (factValue: any): boolean =>
  Number.parseFloat(factValue).toString() !== 'NaN'

const BASE_OPERATORS: Record<string, OperatorSpec> = {
  equal: { cb: (a, b) => a === b, validator: alwaysValid },
  notEqual: { cb: (a, b) => a !== b, validator: alwaysValid },
  in: { cb: (a, b) => b.indexOf(a) > -1, validator: alwaysValid },
  notIn: { cb: (a, b) => b.indexOf(a) === -1, validator: alwaysValid },
  contains: { cb: (a, b) => a.indexOf(b) > -1, validator: Array.isArray },
  doesNotContain: { cb: (a, b) => a.indexOf(b) === -1, validator: Array.isArray },
  lessThan: { cb: (a, b) => a < b, validator: numberValidator },
  lessThanInclusive: { cb: (a, b) => a <= b, validator: numberValidator },
  greaterThan: { cb: (a, b) => a > b, validator: numberValidator },
  greaterThanInclusive: { cb: (a, b) => a >= b, validator: numberValidator },
}

interface DecoratorSpec {
  cb: (factValue: any, value: any, next: Evaluate) => boolean
  validator: (a: any) => boolean
}

const DECORATORS: Record<string, DecoratorSpec> = {
  someFact: { cb: (fv, jv, next) => fv.some((x: any) => next(x, jv)), validator: Array.isArray },
  someValue: { cb: (fv, jv, next) => jv.some((x: any) => next(fv, x)), validator: alwaysValid },
  everyFact: { cb: (fv, jv, next) => fv.every((x: any) => next(x, jv)), validator: Array.isArray },
  everyValue: { cb: (fv, jv, next) => jv.every((x: any) => next(fv, x)), validator: alwaysValid },
  swap: { cb: (fv, jv, next) => next(jv, fv), validator: alwaysValid },
  not: { cb: (fv, jv, next) => !next(fv, jv), validator: alwaysValid },
}

function specToEvaluate(spec: OperatorSpec): Evaluate {
  const { cb, validator } = spec
  // Skip the validator layer for operators whose validator is alwaysValid
  // (equal/notEqual/in/notIn) — the hottest operators become a bare cb.
  return validator === alwaysValid ? cb : (a, b) => validator(a) && cb(a, b)
}

function decorate(dec: DecoratorSpec, inner: Evaluate): Evaluate {
  const { cb, validator } = dec
  if (validator === alwaysValid) return (a, b) => cb(a, b, inner)
  return (a, b) => validator(a) && cb(a, b, inner)
}

/**
 * Resolve an operator name (possibly decorated, e.g. `everyFact:greaterThan`)
 * into a single evaluate function. Custom operators (from compile options)
 * take precedence over built-ins for the base name.
 *
 * Decorators are applied so the leftmost is outermost — matching
 * json-rules-engine's OperatorMap.get (collect left-to-right, apply reversed).
 */
const has = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key)

export function resolveOperator(
  name: string,
  custom?: Record<string, OperatorFn>,
): Evaluate {
  const isOperator = (n: string): boolean =>
    (custom !== undefined && has(custom, n)) || has(BASE_OPERATORS, n)

  // Replicate json-rules-engine's OperatorMap.get: starting from the FULL name,
  // peel one leftmost decorator prefix at a time until the remainder is a known
  // operator. So a custom operator literally named "not:equal" matches whole (no
  // decorator applied), and an unknown prefix / missing base fails loud. hasOwn
  // guards keep prototype names (e.g. "toString") from resolving to inherited members.
  const decorators: DecoratorSpec[] = []
  let opName = name
  while (!isOperator(opName)) {
    const idx = opName.indexOf(':')
    if (idx <= 0) throw new CompileError(`Unknown operator: "${opName}"`)
    const decName = opName.slice(0, idx)
    if (!has(DECORATORS, decName)) throw new CompileError(`Unknown operator decorator: "${decName}"`)
    decorators.unshift(DECORATORS[decName]!)
    opName = opName.slice(idx + 1)
  }

  let evaluate: Evaluate
  if (custom !== undefined && has(custom, opName)) {
    const fn = custom[opName]!
    evaluate = (a, b) => fn(a, b)
  } else {
    evaluate = specToEvaluate(BASE_OPERATORS[opName]!)
  }

  // decorators were unshifted (innermost first); apply in array order so the
  // leftmost decorator in the name ends up outermost.
  for (let i = 0; i < decorators.length; i++) {
    evaluate = decorate(decorators[i]!, evaluate)
  }

  return evaluate
}

/** The built-in base operator names — useful for validating rule documents before compiling. Frozen. */
export const KNOWN_OPERATORS: readonly string[] = Object.freeze(Object.keys(BASE_OPERATORS))
/** The built-in operator-decorator names (someFact/someValue/everyFact/everyValue/swap/not). Frozen. */
export const KNOWN_DECORATORS: readonly string[] = Object.freeze(Object.keys(DECORATORS))
