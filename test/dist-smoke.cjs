'use strict'
// Node 14 compatibility smoke test: loads the BUILT CJS artifact (no build
// tools, no json-rules-engine) and exercises compile + evaluate. This asserts
// the shipped code actually runs on the oldest supported Node, since the build
// (tsdown) and the differential suite run on newer Node.
const assert = require('assert')
const { compile, UndefinedFactError, CompileError } = require('../dist/index.cjs')

const rules = [
  {
    conditions: {
      all: [
        { fact: 'country', operator: 'in', value: ['US', 'GB'] },
        { fact: 'spend', operator: 'greaterThanInclusive', value: 100 },
      ],
    },
    event: { type: 'whale', params: { tier: 'gold' } },
    priority: 10,
  },
  {
    conditions: { any: [{ fact: 'level', operator: 'greaterThan', value: 50 }] },
    event: { type: 'high', params: { tier: 'silver' } },
    priority: 5,
  },
]

const evaluate = compile(rules)
const { events } = evaluate({ country: 'US', spend: 250, level: 80 })
assert.deepStrictEqual(events.map((e) => e.params.tier), ['gold', 'silver'])

const stop = compile(rules, { stopOnFirstEvent: true })
assert.strictEqual(stop({ country: 'US', spend: 250, level: 80 }).events.length, 1)

assert.throws(() => evaluate({ country: 'US', spend: 250 }), UndefinedFactError)
assert.throws(() => compile([{ conditions: { all: [{ fact: 'x', operator: 'nope', value: 1 }] }, event: { type: 't' } }]), CompileError)

// decorators + numberValidator edge on the shipped artifact
const dec = compile([{ conditions: { all: [{ fact: 'xs', operator: 'everyFact:greaterThan', value: 0 }] }, event: { type: 'ok' } }])
assert.strictEqual(dec({ xs: [1, 2, 3] }).events.length, 1)
assert.strictEqual(dec({ xs: [1, -2, 3] }).events.length, 0)

console.log(`Node ${process.version}: dist smoke OK`)
