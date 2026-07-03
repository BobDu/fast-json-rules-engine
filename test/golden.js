'use strict'
// Golden cases: hand-picked semantic edges where a naive reimplementation would
// silently diverge from json-rules-engine. Each is checked against the real
// library via expectMatch; a few also assert our exact output directly.
const assert = require('assert')
const { test } = require('./harness')
const { compile, CompileError } = require('../dist/index.js')
const { expectMatch } = require('./diff')
const { JSONPath } = require('jsonpath-plus')

const ev = (id) => ({ type: id, params: { groupId: id } })

// The resolver users are expected to inject for `path` support — the same
// jsonpath-plus json-rules-engine uses internally, so behavior is identical.
const jp = (value, path) => JSONPath({ path, json: value, wrap: false })

// --- numberValidator: `null >= 0` is true in raw JS but the numeric operators
// gate on Number.parseFloat(x).toString() !== 'NaN', so null fails the compare.
test('numberValidator: null does not satisfy >= 0', () =>
  expectMatch([{ conditions: { all: [{ fact: 'x', operator: 'greaterThanInclusive', value: 0 }] }, event: ev('a') }], { x: null }))

test('numberValidator: boolean/string/array facts on numeric operators', async () => {
  const rule = [{ conditions: { all: [{ fact: 'x', operator: 'greaterThan', value: 5 }] }, event: ev('a') }]
  for (const x of [true, false, 'abc', '10', [], {}, null, 6, 4, '5']) await expectMatch(rule, { x })
})

// --- in/notIn use Array.prototype.indexOf, so NaN is never "in" (unlike Set).
test('in: NaN membership follows indexOf, not SameValueZero', async () => {
  const rule = [{ conditions: { all: [{ fact: 'x', operator: 'in', value: [1, NaN, 3] }] }, event: ev('a') }]
  await expectMatch(rule, { x: NaN })
  await expectMatch(rule, { x: 3 })
})

test('notIn membership', () =>
  expectMatch([{ conditions: { all: [{ fact: 'c', operator: 'notIn', value: ['US', 'GB'] }] }, event: ev('a') }], { c: 'BR' }))

// --- undefined fact: throws when allowUndefinedFacts is false, treated as
// undefined value when true.
test('undefined fact throws by default (both engines)', () =>
  expectMatch([{ conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] }, event: ev('a') }], {}))

test('undefined fact allowed → condition simply fails', () =>
  expectMatch(
    [{ conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] }, event: ev('a') }],
    {},
    { allowUndefinedFacts: true },
  ))

test('fact present with value undefined does not throw', () =>
  expectMatch([{ conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('a') }], { x: undefined }))

// --- decorators
test('everyFact:greaterThan over an array fact', async () => {
  const rule = [{ conditions: { all: [{ fact: 'scores', operator: 'everyFact:greaterThan', value: 3 }] }, event: ev('a') }]
  await expectMatch(rule, { scores: [4, 5, 6] })
  await expectMatch(rule, { scores: [4, 2, 6] })
  await expectMatch(rule, { scores: 'notarray' }) // Array.isArray validator → false
})

test('someValue:equal over an array value', async () => {
  const rule = [{ conditions: { all: [{ fact: 'x', operator: 'someValue:equal', value: [1, 2, 3] }] }, event: ev('a') }]
  await expectMatch(rule, { x: 2 })
  await expectMatch(rule, { x: 9 })
})

test('not:in and swap:contains decorators', async () => {
  await expectMatch([{ conditions: { all: [{ fact: 'c', operator: 'not:in', value: ['US'] }] }, event: ev('a') }], { c: 'BR' })
  await expectMatch([{ conditions: { all: [{ fact: 'c', operator: 'not:in', value: ['US'] }] }, event: ev('a') }], { c: 'US' })
})

// --- nested boolean trees
test('nested any-within-all-within-not', async () => {
  const rule = [
    {
      conditions: {
        not: {
          all: [
            { fact: 'level', operator: 'greaterThan', value: 10 },
            { any: [{ fact: 'vip', operator: 'equal', value: true }, { fact: 'spend', operator: 'greaterThan', value: 100 }] },
          ],
        },
      },
      event: ev('a'),
    },
  ]
  for (const f of [{ level: 20, vip: true, spend: 0 }, { level: 5, vip: false, spend: 0 }, { level: 20, vip: false, spend: 50 }])
    await expectMatch(rule, f)
})

// --- empty boolean arrays: json-rules-engine returns TRUE for both empty all
// AND empty any (prioritizeAndRun short-circuits to true on length 0).
test('empty all and empty any both match', async () => {
  await expectMatch([{ conditions: { all: [] }, event: ev('a') }], { x: 1 })
  await expectMatch([{ conditions: { any: [] }, event: ev('b') }], { x: 1 })
})

// --- value as fact reference
test('value referencing another fact', async () => {
  const rule = [{ conditions: { all: [{ fact: 'a', operator: 'greaterThan', value: { fact: 'b' } }] }, event: ev('a') }]
  await expectMatch(rule, { a: 10, b: 5 })
  await expectMatch(rule, { a: 3, b: 5 })
})

// --- priority ordering: events come back highest-priority first
test('events ordered by priority descending (distinct priorities)', () =>
  expectMatch(
    [
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('low'), priority: 1 },
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('high'), priority: 100 },
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('mid'), priority: 50 },
    ],
    { x: 1 },
  ))

test('tied priorities compared as a set', () =>
  expectMatch(
    [
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('p'), priority: 5 },
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('q'), priority: 5 },
    ],
    { x: 1 },
    {},
    { orderInsensitive: true },
  ))

// --- path resolution (via injected jsonpath-plus, matching json-rules-engine)
test('path into a nested fact value (injected resolver)', async () => {
  const rule = [{ conditions: { all: [{ fact: 'user', path: '$.profile.level', operator: 'greaterThan', value: 10 }] }, event: ev('a') }]
  await expectMatch(rule, { user: { profile: { level: 20 } } }, { pathResolver: jp })
  await expectMatch(rule, { user: { profile: { level: 5 } } }, { pathResolver: jp })
  await expectMatch(rule, { user: {} }, { allowUndefinedFacts: true, pathResolver: jp })
})

test('path without a pathResolver throws CompileError (no bundled JSONPath)', () => {
  assert.throws(
    () => compile([{ conditions: { all: [{ fact: 'user', path: '$.x', operator: 'equal', value: 1 }] }, event: ev('a') }]),
    CompileError,
  )
})

// --- named condition references
test('named condition reference is inlined', () =>
  expectMatch(
    [{ conditions: { all: [{ condition: 'isWhale' }, { fact: 'active', operator: 'equal', value: true }] }, event: ev('a') }],
    { spend: 500, active: true },
    { conditions: { isWhale: { all: [{ fact: 'spend', operator: 'greaterThan', value: 100 }] } } },
  ))

// --- stopOnFirstEvent: our own extension, assert directly
test('stopOnFirstEvent returns only the highest-priority match', () => {
  const evaluate = compile(
    [
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('low'), priority: 1 },
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('high'), priority: 100 },
    ],
    { stopOnFirstEvent: true },
  )
  const { events } = evaluate({ x: 1 })
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].type, 'high')
})

// --- sweep-found divergences (now fixed): checked against json-rules-engine
test('both all and any present → any wins (json-rules-engine key precedence)', () =>
  expectMatch(
    [{ conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }], any: [{ fact: 'x', operator: 'equal', value: 2 }] }, event: ev('a') }],
    { x: 2 },
  ))

test('fact named like a prototype member is undefined, not the inherited value', async () => {
  await expectMatch(
    [{ conditions: { all: [{ fact: 'toString', operator: 'equal', value: { fact: 'missing' } }] }, event: ev('a') }],
    {},
    { allowUndefinedFacts: true },
  )
  // and it throws (not silently reads the inherited fn) when undefined facts aren't allowed
  await expectMatch([{ conditions: { all: [{ fact: 'hasOwnProperty', operator: 'equal', value: 1 }] }, event: ev('a') }], {})
})

test('missing "value" throws (both engines)', () =>
  expectMatch([{ conditions: { all: [{ fact: 'x', operator: 'equal' }] }, event: ev('a') }], { x: 1 }))

test('event without "type" throws (both engines)', () =>
  expectMatch([{ conditions: { all: [] }, event: { params: { a: 1 } } }], { x: 1 }))

test('negative and fractional priorities throw (both engines)', async () => {
  await expectMatch([{ conditions: { all: [] }, event: ev('a'), priority: -3 }], { x: 1 })
  await expectMatch([{ conditions: { all: [] }, event: ev('a'), priority: 0.5 }], { x: 1 })
})

test('numeric-string priority is parsed (both engines)', () =>
  expectMatch(
    [
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('hi'), priority: '3' },
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('lo'), priority: 2 },
    ],
    { x: 1 },
  ))

test('custom operator whose name contains ":" is matched whole', () =>
  expectMatch(
    [{ conditions: { all: [{ fact: 'f', operator: 'not:equal', value: 5 }] }, event: ev('a') }],
    { f: 5 },
    { operators: { 'not:equal': () => true } },
  ))

test('sub-condition priority is rejected (documented non-support)', () => {
  assert.throws(
    () =>
      compile([
        { conditions: { all: [{ fact: 'a', operator: 'equal', value: 1, priority: 10 }] }, event: ev('a') },
      ]),
    CompileError,
  )
})

// --- compile-time guards (our loud-failure surface)
test('unknown operator throws CompileError', () => {
  assert.throws(
    () => compile([{ conditions: { all: [{ fact: 'x', operator: 'bogus', value: 1 }] }, event: ev('a') }]),
    CompileError,
  )
})

test('unsupported jsonpath throws CompileError', () => {
  assert.throws(
    () => compile([{ conditions: { all: [{ fact: 'x', path: '$.items[*].id', operator: 'equal', value: 1 }] }, event: ev('a') }]),
    CompileError,
  )
})

test('bare-leaf root throws CompileError (json-rules-engine rejects it too)', () => {
  assert.throws(
    () => compile([{ conditions: { fact: 'x', operator: 'equal', value: 1 }, event: ev('a') }]),
    CompileError,
  )
})

test('circular named condition throws CompileError', () => {
  assert.throws(
    () =>
      compile([{ conditions: { condition: 'a' }, event: ev('a') }], {
        conditions: { a: { all: [{ condition: 'a' }] } },
      }),
    CompileError,
  )
})
