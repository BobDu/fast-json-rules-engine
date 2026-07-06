// Basics: compile once, evaluate many.  Run: node examples/01-basics.mjs
import { compile } from 'fast-json-rules-engine'

const rules = [
  {
    conditions: { all: [{ fact: 'age', operator: 'greaterThanInclusive', value: 18 }] },
    event: { type: 'adult', params: { tier: 'A' } },
  },
]

const engine = compile(rules)

console.dir(engine.run({ age: 20 }), { depth: null })
// { events: [ { type: 'adult', params: { tier: 'A' } } ] }

console.log(engine.run({ age: 10 }).events) // []  (no rule matched)
