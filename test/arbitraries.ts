import fc from 'fast-check'
import { JSONPath } from 'jsonpath-plus'
import type { CompileOptions } from '../src/index'

// Shared fast-check arbitraries + fixtures, used by both the differential fuzz
// suite (vs json-rules-engine) and the src↔dist contract suite (vs the built
// artifact). Keeping one generator means both suites exercise the same rule
// shapes, edge values, and operator/decorator coverage.
//
// Leaves generate WELL-FORMED operator/value pairings (value type matches what
// the operator needs). Type-mismatched operators (e.g. someValue over a non-array
// value, swap:notIn over a non-array) throw at runtime; under our short-circuit
// they may be skipped while json-rules-engine (Promise.all) always throws — a
// documented behavior difference for malformed input, not exercised here.

export const jp = (value: unknown, path: string): unknown =>
  JSONPath({ path, json: value as object, wrap: false })

export const CUSTOM_OPS: CompileOptions['operators'] = {
  startsWith: (a, b) => typeof a === 'string' && typeof b === 'string' && a.indexOf(b) === 0,
  divisibleBy: (a, b) => Number.isInteger(a) && Number.isInteger(b) && b !== 0 && a % b === 0,
}

// Note: '' is intentionally excluded — json-rules-engine's Fact constructor
// rejects an empty factId ('factId required'), so an empty fact name is invalid
// input upstream, not a rule-semantics divergence.
const factName = fc.constantFrom('a', 'b', 'c', 'arr', 'nested', 'toString', 'constructor', 'hasOwnProperty')
const scalar = fc.oneof(
  fc.integer({ min: -100, max: 100 }),
  fc.double(), // includes NaN, ±Infinity, -0
  fc.string(),
  fc.boolean(),
  fc.constant(null),
)
const arrayVal = fc.array(
  fc.oneof(fc.integer({ min: -10, max: 10 }), fc.string(), fc.constantFrom(null, true, false, NaN, Infinity, -Infinity)),
  { maxLength: 5 },
)

const CMP = fc.constantFrom(
  'equal', 'notEqual', 'lessThan', 'lessThanInclusive', 'greaterThan', 'greaterThanInclusive',
)
const dec1 = (d: string, op: fc.Arbitrary<string>) => fc.tuple(fc.constant(d), op).map(([a, o]) => `${a}:${o}`)
const dec2 = (a: string, b: string, op: fc.Arbitrary<string>) =>
  fc.tuple(fc.constant(a), fc.constant(b), op).map(([x, y, o]) => `${x}:${y}:${o}`)
const dec3 = (a: string, b: string, c: string, op: fc.Arbitrary<string>) =>
  fc.tuple(fc.constant(a), fc.constant(b), fc.constant(c), op).map(([x, y, z, o]) => `${x}:${y}:${z}:${o}`)

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
  // array-validated decorator OVER an already-decorated inner evaluate (the
  // Array.isArray validator wraps a decorated fn, not a plain cb): fact is an
  // array of scalars, the inner someValue/everyValue consumes the array value
  fc.record({ fact: factName, operator: dec2('everyFact', 'someValue', CMP), value: arrayVal }),
  fc.record({ fact: factName, operator: dec2('someFact', 'everyValue', CMP), value: arrayVal }),
  // a 3-deep chain that stays well-formed
  fc.record({ fact: factName, operator: dec3('not', 'everyFact', 'someValue', CMP), value: arrayVal }),
  // value as a fact reference
  fc.record({ fact: factName, operator: CMP, value: fc.record({ fact: factName }) }),
  // value as a fact reference WITH a path (reads a nested sub-value of the ref)
  fc.record({ fact: factName, operator: CMP, value: fc.record({ fact: fc.constant('nested'), path: fc.constant('$.profile.level') }) }),
  // custom operator under a decorator (the decorator peels down to a custom base)
  fc.record({ fact: factName, operator: dec1('everyFact', fc.constant('divisibleBy')), value: fc.integer({ min: 1, max: 12 }) }),
  fc.record({ fact: factName, operator: dec1('someFact', fc.constant('startsWith')), value: fc.string() }),
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
export const rootCond = fc.oneof(
  fc.record({ all: fc.array(node, { maxLength: 4 }) }),
  fc.record({ any: fc.array(node, { maxLength: 4 }) }),
  fc.record({ not: node }),
)

// Events exercise event normalization against json-rules-engine (helpers compares
// FULL event objects): falsy params must be dropped (null/0/''/false/NaN),
// truthy params kept ({} / [] / number / string / object), and any non-type/
// params keys dropped. No { fact } inside params — we don't do event-param fact
// substitution, so avoid that shape to keep the differential apples-to-apples.
const eventParams = fc.oneof(
  fc.constant(null),
  fc.constant(0),
  fc.constant(''),
  fc.constant(false),
  fc.double(), // includes NaN (falsy → dropped) and finite (truthy → kept)
  fc.string(),
  arrayVal,
  fc.record({ tier: fc.string(), n: fc.integer() }),
  fc.constant({}),
)
const event = fc.oneof(
  fc.record({ type: fc.string() }),
  fc.record({ type: fc.string(), params: eventParams }),
  // extra non-type/params keys: upstream drops them, so normalization must too
  fc.record({ type: fc.string(), params: eventParams, meta: fc.string(), id: fc.integer() }),
)

// structuredClone normalizes fast-check's null-prototype objects to ordinary
// ones (real facts have Object.prototype, so their values coerce via toString
// rather than throwing) while preserving NaN/Infinity/-0.
export const facts = fc
  .dictionary(factName, fc.oneof(scalar, arrayVal, fc.record({ profile: fc.record({ level: fc.integer() }) })))
  .map((f) => structuredClone(f) as Record<string, unknown>)

// Tied priorities allowed (1..5) — exercises within-priority ordering (compared as a set).
export const rulesTied = fc.array(
  fc.record({ conditions: rootCond, event, priority: fc.integer({ min: 1, max: 5 }), name: fc.option(fc.string(), { nil: undefined }) }),
  { minLength: 1, maxLength: 6 },
)
// Distinct priorities — required for stopOnFirstEvent (tied + stop diverges by design).
export const rulesDistinct = fc
  .array(fc.record({ conditions: rootCond, event, name: fc.option(fc.string(), { nil: undefined }) }), { minLength: 1, maxLength: 6 })
  .map((rs) => rs.map((r, i) => ({ ...r, priority: i + 1 })))

// --- Named-condition variant (differential). A fixed pool of top-level named
// conditions (each a boolean root, with NO cross-references → no cycles) plus
// rules whose nodes may be a { condition } reference into the pool. Exercises the
// named-condition compile path (predicate memoize, collectFacts following refs,
// json-rules-engine's setCondition) — a shape the base generators never produce.
const NAMED = ['ncA', 'ncB', 'ncC'] as const

export const namedConditions = fc.record({ ncA: rootCond, ncB: rootCond, ncC: rootCond })

const nodeRef = fc.record({ condition: fc.constantFrom(...NAMED) })
const { node: nodeWithRef } = fc.letrec((tie) => ({
  node: fc.oneof(
    { weight: 4, arbitrary: leaf },
    { weight: 2, arbitrary: nodeRef },
    { weight: 1, arbitrary: fc.record({ all: fc.array(tie('node'), { maxLength: 4 }) }) },
    { weight: 1, arbitrary: fc.record({ any: fc.array(tie('node'), { maxLength: 4 }) }) },
    { weight: 1, arbitrary: fc.record({ not: tie('node') }) },
  ),
})) as { node: fc.Arbitrary<unknown> }

const rootCondWithRef = fc.oneof(
  fc.record({ all: fc.array(nodeWithRef, { maxLength: 4 }) }),
  fc.record({ any: fc.array(nodeWithRef, { maxLength: 4 }) }),
  fc.record({ not: nodeWithRef }),
  ...NAMED.map((n) => fc.constant({ condition: n })),
)

export const rulesWithRefTied = fc.array(
  fc.record({ conditions: rootCondWithRef, event, priority: fc.integer({ min: 1, max: 5 }), name: fc.option(fc.string(), { nil: undefined }) }),
  { minLength: 1, maxLength: 6 },
)
