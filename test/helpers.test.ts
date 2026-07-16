import { describe, expect, test } from 'vitest'
import { isDeepStrictMultisetEqual } from './helpers'

const event = (params: unknown): Record<string, unknown> => ({ type: '', params })

describe('isDeepStrictMultisetEqual', () => {
  test('ignores order without collapsing JSON-unsafe values', () => {
    const events = [event([Infinity]), event([null]), event({ tier: '', n: 0 })]
    expect(isDeepStrictMultisetEqual(events, [events[2], events[1], events[0]])).toBe(true)
    expect(isDeepStrictMultisetEqual([event([Infinity])], [event([null])])).toBe(false)
  })

  test('preserves strict semantics for special scalar values', () => {
    const values = [event(NaN), event(-0), event(undefined)]
    expect(isDeepStrictMultisetEqual(values, [values[2], values[0], values[1]])).toBe(true)
    expect(isDeepStrictMultisetEqual([event(-0)], [event(0)])).toBe(false)
    expect(isDeepStrictMultisetEqual([event(undefined)], [{ type: '' }])).toBe(false)
  })

  test('compares duplicate multiplicities', () => {
    expect(
      isDeepStrictMultisetEqual(
        [event([Infinity]), event([Infinity])],
        [event([Infinity]), event([null])],
      ),
    ).toBe(false)
  })
})
