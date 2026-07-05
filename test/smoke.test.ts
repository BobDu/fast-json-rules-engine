import { test, expect } from 'vitest'
import fc from 'fast-check'
import { compile } from '../src/index'

test('compile + evaluate against the source', () => {
  const evaluate = compile([
    { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: { type: 't' } },
  ])
  expect(evaluate({ x: 1 }).events.map((e) => e.type)).toEqual(['t'])
  expect(evaluate({ x: 2 }).events).toEqual([])
})

test('fast-check property smoke', () => {
  fc.assert(
    fc.property(fc.integer(), (n) => {
      const evaluate = compile([
        { conditions: { all: [{ fact: 'x', operator: 'equal', value: n }] }, event: { type: 't' } },
      ])
      return evaluate({ x: n }).events.length === 1 && evaluate({ x: n + 1 }).events.length === 0
    }),
  )
})
