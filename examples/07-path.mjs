// path via an injected resolver (jsonpath-plus).  Run: node examples/07-path.mjs
// Requires the jsonpath-plus dev dependency (installed by `npm install`).
import { compile } from 'fast-json-rules-engine'
import { JSONPath } from 'jsonpath-plus'

const jp = (value, path) => JSONPath({ path, json: value, wrap: false })

const evaluate = compile(
  [{ conditions: { all: [{ fact: 'user', path: '$.profile.level', operator: 'greaterThan', value: 10 }] }, event: { type: 'senior' } }],
  { pathResolver: jp },
)

console.log(evaluate({ user: { profile: { level: 20 } } }).events.map((e) => e.type)) // [ 'senior' ]
console.log(evaluate({ user: { profile: { level: 5 } } }).events.map((e) => e.type)) //  []

// full JSONPath (array index) also works through the injected resolver:
const firstItem = compile(
  [{ conditions: { all: [{ fact: 'o', path: '$.items[0].id', operator: 'equal', value: 7 }] }, event: { type: 'first' } }],
  { pathResolver: jp },
)
console.log(firstItem({ o: { items: [{ id: 7 }, { id: 9 }] } }).events.map((e) => e.type)) // [ 'first' ]

// Without a pathResolver, a rule using `path` throws CompileError at compile time.
