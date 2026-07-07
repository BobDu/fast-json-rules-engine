import { test, expect } from 'vitest'
import { JSONPath } from 'jsonpath-plus'
import { compile, CompileError, UndefinedFactError, KNOWN_OPERATORS, KNOWN_DECORATORS } from '../src/index'
import { expectMatch } from './helpers'

const ev = (id: string) => ({ type: id, params: { groupId: id } })
const jp = (value: unknown, path: string) => JSONPath({ path, json: value as object, wrap: false })

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
  const engine = compile([
    { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('low'), priority: 1 },
    { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('high'), priority: 100 },
  ])
  const { events } = engine.run({ x: 1 }, { stopOnFirstEvent: true })
  expect(events.length).toBe(1)
  expect(events[0].type).toBe('high')
})

// --- divergences found by earlier differential sweeps (now fixed vs json-rules-engine)
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
test('sub-condition priority is ignored (compiles; events match json-rules-engine)', async () => {
  // A nested `priority` is upstream's short-circuit ordering hint; we ignore it
  // (the boolean result is order-independent). It must still compile and agree
  // with json-rules-engine, which honors the hint for ordering but yields the
  // same events. All facts present so neither engine hits the undefined-fact path.
  const rule = [
    {
      conditions: {
        all: [
          { fact: 'a', operator: 'equal', value: 1, priority: 10 },
          { fact: 'b', operator: 'equal', value: 2, priority: 1 },
        ],
      },
      event: ev('a'),
    },
  ]
  await expectMatch(rule as never, { a: 1, b: 2 })
  await expectMatch(rule as never, { a: 1, b: 999 })
  await expectMatch(rule as never, { a: 999, b: 2 })
})
test('unknown operator throws CompileError', () =>
  expect(() => compile([{ conditions: { all: [{ fact: 'x', operator: 'bogus', value: 1 }] }, event: ev('a') }])).toThrow(CompileError))
test('bare-leaf root throws CompileError', () =>
  expect(() => compile([{ conditions: { fact: 'x', operator: 'equal', value: 1 } as never, event: ev('a') }])).toThrow(CompileError))
test('circular named condition throws CompileError', () =>
  expect(() =>
    compile([{ conditions: { condition: 'a' }, event: ev('a') }], { conditions: { a: { all: [{ condition: 'a' }] } } }),
  ).toThrow(CompileError))

// --- hardening: deep nesting fails loud, fan-out is memoized
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

// --- guard coverage: every malformed-input branch fails loud at compile time.
// These assert the fail-loud surface directly (differential fuzz uses only
// well-formed input, so these branches need explicit coverage).
const cErr = (rules: unknown, opts?: Parameters<typeof compile>[1]) =>
  expect(() => compile(rules as never, opts)).toThrow(CompileError)
const badCond = (conditions: unknown, opts?: Parameters<typeof compile>[1]) => cErr([{ conditions, event: ev('a') }], opts)

test('non-object nested condition throws', () => badCond({ all: [5] }))
test('"any" that is not an array throws', () => badCond({ any: 'nope' }))
test('"all" that is not an array throws', () => badCond({ all: 'nope' }))
test('leaf missing "fact" throws', () => badCond({ all: [{ operator: 'equal', value: 1 }] }))
test('leaf missing "operator" throws', () => badCond({ all: [{ fact: 'x', value: 1 }] }))
test('"condition" reference that is not a string throws', () => badCond({ condition: 123 }))
test('unknown named condition throws', () => badCond({ condition: 'nope' }))
test('unknown operator decorator throws', () => badCond({ all: [{ fact: 'x', operator: 'bogus:equal', value: 1 }] }))
test('named condition with a non-boolean root throws', () =>
  badCond({ condition: 'leaf' }, { conditions: { leaf: { fact: 'x', operator: 'equal', value: 1 } as never } }))
test('rule missing "conditions" throws', () => cErr([{ event: ev('a') }]))
test('rule missing "event" throws', () => cErr([{ conditions: { all: [] } }]))
test('rule "event" as an array throws', () => cErr([{ conditions: { all: [] }, event: [] }]))
test('rule "event" as null throws', () => cErr([{ conditions: { all: [] }, event: null }]))
test('deep nesting also fails loud in compileCondition (allowUndefinedFacts skips the collectFacts guard)', () => {
  let d: unknown = { all: [{ fact: 'x', operator: 'equal', value: 1 }] }
  for (let i = 0; i < 20000; i++) d = { all: [d] }
  cErr([{ conditions: d, event: ev('a') }], { allowUndefinedFacts: true })
})

// --- compile accepts a single rule object, not just an array
test('a single rule (not wrapped in an array) compiles and evaluates', () => {
  const engine = compile({ conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('a') })
  expect(engine.run({ x: 1 }).events.map((e) => e.type)).toEqual(['a'])
  expect(engine.run({ x: 2 }).events).toEqual([])
})

// --- event normalized to json-rules-engine's { type, params? } shape
test('falsy event params are dropped (matches json-rules-engine)', async () => {
  for (const params of [null, 0, '', false, NaN])
    await expectMatch([{ conditions: { all: [] }, event: { type: 't', params } as never }], { x: 1 })
})
test('truthy event params are kept, including {} and []', async () => {
  for (const params of [{}, [], { tier: 'gold' }, 5, 'x'])
    await expectMatch([{ conditions: { all: [] }, event: { type: 't', params } as never }], { x: 1 })
})
test('non-type/params event keys are dropped (matches json-rules-engine)', () =>
  expectMatch([{ conditions: { all: [] }, event: { type: 't', params: { a: 1 }, meta: 'x', id: 5 } as never }], { x: 1 }))
test('returned events are normalized to exactly { type, params? }', () => {
  const out = compile([
    { conditions: { all: [] }, event: { type: 'a', params: null, extra: 1 } as never },
    { conditions: { all: [] }, event: { type: 'b', params: { tier: 'gold' }, meta: 'drop' } as never },
  ]).run({ x: 1 })
  expect(out.events).toStrictEqual([{ type: 'a' }, { type: 'b', params: { tier: 'gold' } }])
})
test('returned event is our own fresh object, not the caller rule.event', () => {
  const rule = { conditions: { all: [] }, event: { type: 'a', params: { n: 1 }, extra: 'x' } }
  const out = compile([rule] as never).run({ x: 1 })
  expect(out.events[0]).not.toBe(rule.event) // fresh top-level object (mutating it can't corrupt the source rule)
  expect(out.events[0]).toStrictEqual({ type: 'a', params: { n: 1 } }) // extra key dropped
})

// --- named-condition fan-out DAG evaluates correctly (not just compiles)
test('named-condition fan-out DAG evaluates (runtime, not just compile)', () => {
  const conditions: Record<string, unknown> = { c0: { all: [{ fact: 'x', operator: 'equal', value: 1 }] } }
  for (let i = 1; i < 12; i++) conditions['c' + i] = { all: [{ condition: 'c' + (i - 1) }, { condition: 'c' + (i - 1) }] }
  const engine = compile([{ conditions: { all: [{ condition: 'c11' }] }, event: ev('a') }], { conditions: conditions as never })
  expect(engine.run({ x: 1 }).events.map((e) => e.type)).toEqual(['a'])
  expect(engine.run({ x: 2 }).events).toEqual([])
})

// --- a falsy path ('' / null) is ignored, matching json-rules-engine (if(path))
test('falsy path is ignored like json-rules-engine (uses the raw fact value)', async () => {
  for (const path of ['', null]) {
    await expectMatch([{ conditions: { all: [{ fact: 'x', path, operator: 'equal', value: 1 }] }, event: ev('a') }] as never, { x: 1 })
    await expectMatch([{ conditions: { all: [{ fact: 'x', path, operator: 'equal', value: 1 }] }, event: ev('a') }] as never, { x: 2 })
  }
})

// --- a value fact-reference with a non-string fact throws (fail loud)
test('non-string value fact reference throws CompileError', () =>
  expect(() =>
    compile([{ conditions: { all: [{ fact: 'a', operator: 'equal', value: { fact: 42 } }] }, event: ev('a') }] as never),
  ).toThrow(CompileError))

// --- allowUndefinedConditions: unknown named condition compiles to false (matches upstream)
test('allowUndefinedConditions treats an unknown condition as false', async () => {
  const rules = [
    { conditions: { any: [{ condition: 'missing' }, { fact: 'x', operator: 'equal', value: 1 }] }, event: ev('a') },
  ]
  await expectMatch(rules, { x: 1 }, { allowUndefinedConditions: true })
  await expectMatch(rules, { x: 2 }, { allowUndefinedConditions: true })
})
test('unknown named condition still throws by default', () =>
  expect(() => compile([{ conditions: { all: [{ condition: 'missing' }] }, event: ev('a') }])).toThrow(CompileError))

// --- MAX_DEPTH is total: a deep chain reached via a memoized named condition
// fails loud at COMPILE, not with a RangeError at eval (regression guard)
test('deep chain via a memoized named condition fails loud at compile', () => {
  let deepBody: unknown = { all: [{ fact: 'x', operator: 'equal', value: 1 }] }
  for (let i = 0; i < 400; i++) deepBody = { all: [deepBody] }
  let deepRef: unknown = { condition: 'nA' }
  for (let i = 0; i < 200; i++) deepRef = { all: [deepRef] }
  expect(() =>
    compile(
      [
        { conditions: { condition: 'nA' }, event: ev('seed') }, // seeds nA's memo at shallow depth
        { conditions: deepRef as never, event: ev('deep') }, // memo-hits nA ~200 deep → total > MAX_DEPTH
      ],
      { conditions: { nA: deepBody as never } },
    ),
  ).toThrow(CompileError)
})

// --- returned events alias the source rule's params (documented residual, read-only)
test('returned event params aliases the source rule (documented residual, read-only)', () => {
  const rule = { conditions: { all: [] }, event: { type: 'a', params: { n: 1 } } }
  const out = compile([rule]).run({ x: 1 })
  expect(out.events[0].params).toBe(rule.event.params) // same sub-object — not a per-run deep clone
})

// --- stopOnFirstEvent still enforces the global undefined-fact pre-check
test('stopOnFirstEvent still requires all referenced facts (global pre-check)', () => {
  const engine = compile([
    { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: ev('hit'), priority: 2 },
    { conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] }, event: ev('lo'), priority: 1 },
  ])
  // The union pre-check runs before any rule, so a missing fact throws even though
  // the higher-priority rule would match and stop first — a deliberate fail-loud
  // divergence from json-rules-engine's stop() emulation (which would not throw).
  expect(() => engine.run({ x: 1 }, { stopOnFirstEvent: true })).toThrow(UndefinedFactError)
  expect(engine.run({ x: 1, missing: 0 }, { stopOnFirstEvent: true }).events.map((e) => e.type)).toEqual(['hit'])
})

// --- exported introspection helpers + structured error fields
test('KNOWN_OPERATORS / KNOWN_DECORATORS list the built-ins and are frozen', () => {
  expect([...KNOWN_OPERATORS].sort()).toEqual([
    'contains', 'doesNotContain', 'equal', 'greaterThan', 'greaterThanInclusive',
    'in', 'lessThan', 'lessThanInclusive', 'notEqual', 'notIn',
  ])
  expect([...KNOWN_DECORATORS].sort()).toEqual(['everyFact', 'everyValue', 'not', 'someFact', 'someValue', 'swap'])
  expect(Object.isFrozen(KNOWN_OPERATORS)).toBe(true)
  expect(Object.isFrozen(KNOWN_DECORATORS)).toBe(true)
})
test('UndefinedFactError exposes factId and code', () => {
  try {
    compile([{ conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] }, event: ev('a') }]).run({})
  } catch (e) {
    expect(e).toBeInstanceOf(UndefinedFactError)
    expect((e as UndefinedFactError).factId).toBe('missing')
    expect((e as UndefinedFactError).code).toBe('UNDEFINED_FACT')
    return
  }
  throw new Error('expected UndefinedFactError')
})
test('CompileError exposes ruleIndex and code for a nested compile error', () => {
  try {
    compile([
      { conditions: { all: [] }, event: ev('a') },
      { conditions: { all: [{ fact: 'x', operator: 'nope', value: 1 }] }, event: ev('b') },
    ])
  } catch (e) {
    expect(e).toBeInstanceOf(CompileError)
    expect((e as CompileError).ruleIndex).toBe(1)
    expect((e as CompileError).code).toBe('COMPILE_ERROR')
    expect((e as Error).message).toContain('Rule at index 1')
    return
  }
  throw new Error('expected CompileError')
})
