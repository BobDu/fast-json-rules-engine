import { test, expect } from 'vitest'
import { JSONPath } from 'jsonpath-plus'
import { compile, CompileError } from '../src/index'
import { expectMatch } from './helpers'

const ev = (id: string) => ({ type: id, params: { groupId: id } })
const jp = (value: unknown, path: string) => JSONPath({ path, json: value, wrap: false })

// --- numeric operators gate on numberValidator (null >= 0 is false, not true)
test('numberValidator: null does not satisfy >= 0', () =>
  expectMatch([{ conditions: { all: [{ fact: 'x', operator: 'greaterThanInclusive', value: 0 }] }, event: ev('a') }], { x: null }))

test('numberValidator: non-numeric facts on numeric operators', async () => {
  const rule = [{ conditions: { all: [{ fact: 'x', operator: 'greaterThan', value: 5 }] }, event: ev('a') }]
  for (const x of [true, false, 'abc', '10', [], {}, null, 6, 4, '5']) await expectMatch(rule, { x })
})

// --- in/notIn use indexOf (NaN never "in")
test('in: NaN membership follows indexOf', async () => {
  const rule = [{ conditions: { all: [{ fact: 'x', operator: 'in', value: [1, NaN, 3] }] }, event: ev('a') }]
  await expectMatch(rule, { x: NaN })
  await expectMatch(rule, { x: 3 })
})
test('notIn membership', () =>
  expectMatch([{ conditions: { all: [{ fact: 'c', operator: 'notIn', value: ['US', 'GB'] }] }, event: ev('a') }], { c: 'BR' }))

// --- undefined facts
test('undefined fact throws by default (both engines)', () =>
  expectMatch([{ conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] }, event: ev('a') }], {}))
test('undefined fact allowed -> condition fails', () =>
  expectMatch([{ conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] }, event: ev('a') }], {}, { allowUndefinedFacts: true }))
test('fact present with value undefined does not throw', () =>
  expectMatch([{ conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('a') }], { x: undefined }))

// --- decorators
test('everyFact:greaterThan over an array fact', async () => {
  const rule = [{ conditions: { all: [{ fact: 'scores', operator: 'everyFact:greaterThan', value: 3 }] }, event: ev('a') }]
  await expectMatch(rule, { scores: [4, 5, 6] })
  await expectMatch(rule, { scores: [4, 2, 6] })
  await expectMatch(rule, { scores: 'notarray' })
})
test('someValue:equal over an array value', async () => {
  const rule = [{ conditions: { all: [{ fact: 'x', operator: 'someValue:equal', value: [1, 2, 3] }] }, event: ev('a') }]
  await expectMatch(rule, { x: 2 })
  await expectMatch(rule, { x: 9 })
})
test('not:in and swap:contains decorators', async () => {
  await expectMatch([{ conditions: { all: [{ fact: 'c', operator: 'not:in', value: ['US'] }] }, event: ev('a') }], { c: 'BR' })
  await expectMatch([{ conditions: { all: [{ fact: 'c', operator: 'swap:contains', value: ['US', 'GB'] }] }, event: ev('a') }], { c: 'US' })
})

// --- nested boolean trees + empty
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

// --- priority
test('events ordered by priority descending', () =>
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

// --- path via injected resolver
test('path into a nested fact (injected resolver)', async () => {
  const rule = [{ conditions: { all: [{ fact: 'user', path: '$.profile.level', operator: 'greaterThan', value: 10 }] }, event: ev('a') }]
  await expectMatch(rule, { user: { profile: { level: 20 } } }, { pathResolver: jp })
  await expectMatch(rule, { user: { profile: { level: 5 } } }, { pathResolver: jp })
  await expectMatch(rule, { user: {} }, { allowUndefinedFacts: true, pathResolver: jp })
  await expectMatch(
    [{ conditions: { all: [{ fact: 'o', path: '$.items[0].id', operator: 'equal', value: 7 }] }, event: ev('a') }],
    { o: { items: [{ id: 7 }] } },
    { pathResolver: jp },
  )
})

// --- named conditions
test('named condition reference is inlined', () =>
  expectMatch(
    [{ conditions: { all: [{ condition: 'isWhale' }, { fact: 'active', operator: 'equal', value: true }] }, event: ev('a') }],
    { spend: 500, active: true },
    { conditions: { isWhale: { all: [{ fact: 'spend', operator: 'greaterThan', value: 100 }] } } },
  ))

// --- stopOnFirstEvent (our extension)
test('stopOnFirstEvent returns only the highest-priority match', () => {
  const evaluate = compile(
    [
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('low'), priority: 1 },
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('high'), priority: 100 },
    ],
    { stopOnFirstEvent: true },
  )
  const { events } = evaluate({ x: 1 })
  expect(events.length).toBe(1)
  expect(events[0].type).toBe('high')
})

// --- sweep-found divergences (fixed), checked against json-rules-engine
test('both all and any present -> any wins', () =>
  expectMatch(
    [{ conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }], any: [{ fact: 'x', operator: 'equal', value: 2 }] }, event: ev('a') }],
    { x: 2 },
  ))
test('prototype-member fact name is not a fact', async () => {
  await expectMatch([{ conditions: { all: [{ fact: 'toString', operator: 'equal', value: { fact: 'missing' } }] }, event: ev('a') }], {}, { allowUndefinedFacts: true })
  await expectMatch([{ conditions: { all: [{ fact: 'hasOwnProperty', operator: 'equal', value: 1 }] }, event: ev('a') }], {})
})
test('missing value throws (both engines)', () =>
  expectMatch([{ conditions: { all: [{ fact: 'x', operator: 'equal' } as never] }, event: ev('a') }], { x: 1 }))
test('event without type throws (both engines)', () =>
  expectMatch([{ conditions: { all: [] }, event: { params: { a: 1 } } as never }], { x: 1 }))
test('negative and fractional priorities throw (both engines)', async () => {
  await expectMatch([{ conditions: { all: [] }, event: ev('a'), priority: -3 }], { x: 1 })
  await expectMatch([{ conditions: { all: [] }, event: ev('a'), priority: 0.5 }], { x: 1 })
})
test('numeric-string priority is parsed (both engines)', () =>
  expectMatch(
    [
      { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('hi'), priority: '3' as never },
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

// --- compile-time guards (fail-loud surface, asserted directly)
test('path without a pathResolver throws CompileError', () =>
  expect(() => compile([{ conditions: { all: [{ fact: 'u', path: '$.x', operator: 'equal', value: 1 }] }, event: ev('a') }])).toThrow(CompileError))
test('sub-condition priority is rejected', () =>
  expect(() =>
    compile([{ conditions: { all: [{ fact: 'a', operator: 'equal', value: 1, priority: 10 } as never] }, event: ev('a') }]),
  ).toThrow(CompileError))
test('unknown operator throws CompileError', () =>
  expect(() => compile([{ conditions: { all: [{ fact: 'x', operator: 'bogus', value: 1 }] }, event: ev('a') }])).toThrow(CompileError))
test('bare-leaf root throws CompileError', () =>
  expect(() => compile([{ conditions: { fact: 'x', operator: 'equal', value: 1 } as never, event: ev('a') }])).toThrow(CompileError))
test('circular named condition throws CompileError', () =>
  expect(() =>
    compile([{ conditions: { condition: 'a' }, event: ev('a') }], { conditions: { a: { all: [{ condition: 'a' }] } } }),
  ).toThrow(CompileError))

// --- hardening (batch 1): deep nesting fails loud, fan-out is memoized
test('deeply nested conditions throw CompileError (not RangeError)', () => {
  let d: unknown = { fact: 'x', operator: 'equal', value: 1 }
  for (let i = 0; i < 20000; i++) d = { all: [d] }
  expect(() => compile([{ conditions: d as never, event: ev('a') }])).toThrow(CompileError)
})
test('fan-out named conditions compile without exponential blow-up', () => {
  const conditions: Record<string, unknown> = { c0: { all: [{ fact: 'x', operator: 'equal', value: 1 }] } }
  for (let i = 1; i < 40; i++) conditions['c' + i] = { all: [{ condition: 'c' + (i - 1) }, { condition: 'c' + (i - 1) }] }
  expect(() => compile([{ conditions: { all: [{ condition: 'c39' }] }, event: ev('a') }], { conditions: conditions as never })).not.toThrow()
})
