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
  return (a, b) => validator(a) && cb(a, b)
}

function decorate(dec: DecoratorSpec, inner: Evaluate): Evaluate {
  const { cb, validator } = dec
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
export function resolveOperator(
  name: string,
  custom?: Record<string, OperatorFn>,
): Evaluate {
  const parts = name.split(':')
  const baseName = parts[parts.length - 1]
  const decoratorNames = parts.slice(0, -1)

  let evaluate: Evaluate
  if (custom && Object.prototype.hasOwnProperty.call(custom, baseName)) {
    const fn = custom[baseName]
    evaluate = (a, b) => fn(a, b)
  } else if (Object.prototype.hasOwnProperty.call(BASE_OPERATORS, baseName)) {
    evaluate = specToEvaluate(BASE_OPERATORS[baseName])
  } else {
    throw new CompileError(`Unknown operator: "${baseName}"`)
  }

  // Apply reversed: the last decorator in the list wraps closest to the base.
  for (let i = decoratorNames.length - 1; i >= 0; i--) {
    const decName = decoratorNames[i]
    if (!Object.prototype.hasOwnProperty.call(DECORATORS, decName)) {
      throw new CompileError(`Unknown operator decorator: "${decName}"`)
    }
    evaluate = decorate(DECORATORS[decName], evaluate)
  }

  return evaluate
}

export const KNOWN_OPERATORS = Object.keys(BASE_OPERATORS)
export const KNOWN_DECORATORS = Object.keys(DECORATORS)
