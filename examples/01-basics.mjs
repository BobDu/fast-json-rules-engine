// Basics: compile once, evaluate many.  Run: node examples/01-basics.mjs
import { compile } from 'fast-json-rules-engine'

const rules = [
  {
    conditions: { all: [{ fact: 'age', operator: 'greaterThanInclusive', value: 18 }] },
    event: { type: 'adult', params: { tier: 'A' } },
  },
]

const evaluate = compile(rules)

console.log(evaluate({ age: 20 }))
// { events: [ { type: 'adult', params: { tier: 'A' } } ],
//   failureEvents: [], results: [ ... ], failureResults: [] }

console.log(evaluate({ age: 10 }).events) // []
console.log(evaluate({ age: 10 }).failureEvents.map((e) => e.type)) // [ 'adult' ]
