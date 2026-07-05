// ESM counterpart to smoke-node14.js: loads the built ESM artifact and runs the
// same checks, proving the mjs export (not just cjs) loads and evaluates on the
// oldest supported Node. No build tools, no json-rules-engine.
import assert from 'node:assert'
import { compile, UndefinedFactError, CompileError } from '../dist/index.mjs'

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

const dec = compile([{ conditions: { all: [{ fact: 'xs', operator: 'everyFact:greaterThan', value: 0 }] }, event: { type: 'ok' } }])
assert.strictEqual(dec({ xs: [1, 2, 3] }).events.length, 1)
assert.strictEqual(dec({ xs: [1, -2, 3] }).events.length, 0)

console.log(`Node ${process.version}: dist ESM smoke OK`)
