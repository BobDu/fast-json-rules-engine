import fc from 'fast-check'
import { test } from '@fast-check/vitest'
import { JSONPath } from 'jsonpath-plus'
import { agrees } from './helpers'
import type { CompileOptions } from '../src/index'

// Differential property tests: for any generated rule set + facts, our compiled
// output must equal json-rules-engine. fast-check supplies edge values (NaN,
// Infinity, -0 via fc.double), auto-shrinks any counterexample to a minimal
// repro, and prints a reproducible seed on failure.

fc.configureGlobal({ numRuns: Number(process.env.FJRE_FUZZ_N ?? 400) })

const jp = (value: unknown, path: string): unknown => JSONPath({ path, json: value, wrap: false })
const CUSTOM_OPS: CompileOptions['operators'] = {
  startsWith: (a, b) => typeof a === 'string' && typeof b === 'string' && a.indexOf(b) === 0,
  divisibleBy: (a, b) => Number.isInteger(a) && Number.isInteger(b) && b !== 0 && a % b === 0,
}

const factName = fc.constantFrom('a', 'b', 'c', 'arr', 'nested', 'toString', 'constructor')
const scalar = fc.oneof(
  fc.integer({ min: -100, max: 100 }),
  fc.double(), // includes NaN, ±Infinity, -0
  fc.string(),
  fc.boolean(),
  fc.constant(null),
)
const arrayVal = fc.array(fc.oneof(fc.integer({ min: -10, max: 10 }), fc.string()), { maxLength: 5 })

// Leaves generate WELL-FORMED operator/value pairings (value type matches what
// the operator needs). Type-mismatched operators (e.g. someValue with a non-array
// value, swap:notIn over a non-array) throw at runtime; under our short-circuit
// they may be skipped while json-rules-engine (Promise.all) always throws — a
// documented behavior difference for malformed input, not exercised here.
const CMP = fc.constantFrom(
  'equal', 'notEqual', 'lessThan', 'lessThanInclusive', 'greaterThan', 'greaterThanInclusive',
)
const dec1 = (d: string, op: fc.Arbitrary<string>) => fc.tuple(fc.constant(d), op).map(([a, o]) => `${a}:${o}`)
const dec2 = (a: string, b: string, op: fc.Arbitrary<string>) =>
  fc.tuple(fc.constant(a), fc.constant(b), op).map(([x, y, o]) => `${x}:${y}:${o}`)

const leafBody = fc.oneof(
  fc.record({ fact: factName, operator: CMP, value: scalar }),
  fc.record({ fact: factName, operator: fc.constantFrom('in', 'notIn'), value: arrayVal }),
  fc.record({ fact: factName, operator: fc.constantFrom('contains', 'doesNotContain'), value: scalar }),
  fc.record({ fact: factName, operator: fc.constant('startsWith'), value: fc.string() }),
  fc.record({ fact: factName, operator: fc.constant('divisibleBy'), value: fc.integer({ min: 1, max: 12 }) }),
  // someFact/everyFact: fact expected array (Array.isArray validator guards non-arrays), value scalar
  fc.record({ fact: factName, operator: dec1('someFact', CMP), value: scalar }),
  fc.record({ fact: factName, operator: dec1('everyFact', CMP), value: scalar }),
  // someValue/everyValue: value MUST be an array (jv.some/every)
  fc.record({ fact: factName, operator: dec1('someValue', CMP), value: arrayVal }),
  fc.record({ fact: factName, operator: dec1('everyValue', CMP), value: arrayVal }),
  // swap over a symmetric/scalar comparison stays well-formed
  fc.record({ fact: factName, operator: dec1('swap', CMP), value: scalar }),
  // not over scalar cmp / set membership
  fc.record({ fact: factName, operator: dec1('not', CMP), value: scalar }),
  fc.record({ fact: factName, operator: fc.constant('not:in'), value: arrayVal }),
  // a 2-deep chain that stays well-formed
  fc.record({ fact: factName, operator: dec2('not', 'everyFact', CMP), value: scalar }),
  // value as a fact reference
  fc.record({ fact: factName, operator: CMP, value: fc.record({ fact: factName }) }),
)

const leaf = fc.oneof(
  { weight: 6, arbitrary: leafBody },
  // path variant: same well-formed body, read from a nested fact via a path
  { weight: 1, arbitrary: leafBody.map((l) => ({ ...l, fact: 'nested', path: '$.profile.level' })) },
)

const { node } = fc.letrec((tie) => ({
  node: fc.oneof(
    { weight: 4, arbitrary: leaf },
    { weight: 1, arbitrary: fc.record({ all: fc.array(tie('node'), { maxLength: 4 }) }) },
    { weight: 1, arbitrary: fc.record({ any: fc.array(tie('node'), { maxLength: 4 }) }) },
    { weight: 1, arbitrary: fc.record({ not: tie('node') }) },
  ),
})) as { node: fc.Arbitrary<unknown> }

// A rule's root must be a boolean (all/any/not).
const rootCond = fc.oneof(
  fc.record({ all: fc.array(node, { maxLength: 4 }) }),
  fc.record({ any: fc.array(node, { maxLength: 4 }) }),
  fc.record({ not: node }),
)

const event = fc.record({ type: fc.string() }) // type-only: avoids the falsy-params normalization difference (#7)

// structuredClone normalizes fast-check's null-prototype objects to ordinary
// ones (real facts have Object.prototype, so their values coerce via toString
// rather than throwing) while preserving NaN/Infinity/-0.
const facts = fc
  .dictionary(factName, fc.oneof(scalar, arrayVal, fc.record({ profile: fc.record({ level: fc.integer() }) })))
  .map((f) => structuredClone(f) as Record<string, unknown>)

// Tied priorities allowed (1..5) — exercises within-priority ordering (compared as a set).
const rulesTied = fc.array(fc.record({ conditions: rootCond, event, priority: fc.integer({ min: 1, max: 5 }) }), {
  minLength: 1,
  maxLength: 6,
})
// Distinct priorities — required for stopOnFirstEvent (tied + stop diverges by design).
const rulesDistinct = fc
  .array(fc.record({ conditions: rootCond, event }), { minLength: 1, maxLength: 6 })
  .map((rs) => rs.map((r, i) => ({ ...r, priority: i + 1 })))

test.prop([rulesTied, facts, fc.boolean()])(
  'core: compiled output equals json-rules-engine',
  (rules, f, allowUndefinedFacts) =>
    agrees(rules as never, f, { allowUndefinedFacts, operators: CUSTOM_OPS, pathResolver: jp }, { orderInsensitive: true }),
)

test.prop([rulesDistinct, facts])(
  'stopOnFirstEvent: compiled output equals json-rules-engine',
  (rules, f) =>
    agrees(
      rules as never,
      f,
      { stopOnFirstEvent: true, allowUndefinedFacts: true, operators: CUSTOM_OPS, pathResolver: jp },
      { orderInsensitive: true },
    ),
)
