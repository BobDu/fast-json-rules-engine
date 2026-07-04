// value-as-fact refs, named conditions, custom operators.  Run: node examples/06-named-and-custom.mjs
import { compile } from 'fast-json-rules-engine'

// (a) value references another fact
const dynamic = compile([
  { conditions: { all: [{ fact: 'score', operator: 'greaterThan', value: { fact: 'threshold' } }] }, event: { type: 'pass' } },
])
console.log(dynamic({ score: 80, threshold: 60 }).events.map((e) => e.type)) // [ 'pass' ]
console.log(dynamic({ score: 50, threshold: 60 }).events.map((e) => e.type)) // []

// (b) a named condition, referenced by name and reusable across rules
const withNamed = compile(
  [{ conditions: { all: [{ condition: 'isWhale' }, { fact: 'active', operator: 'equal', value: true }] }, event: { type: 'vipWhale' } }],
  {
    conditions: {
      isWhale: { any: [{ fact: 'spend', operator: 'greaterThan', value: 1000 }, { fact: 'vip', operator: 'equal', value: true }] },
    },
  },
)
console.log(withNamed({ spend: 2000, vip: false, active: true }).events.map((e) => e.type)) // [ 'vipWhale' ]

// (c) a custom operator
const withCustom = compile(
  [{ conditions: { all: [{ fact: 'email', operator: 'endsWith', value: '@vip.com' }] }, event: { type: 'vipDomain' } }],
  { operators: { endsWith: (a, b) => typeof a === 'string' && a.endsWith(b) } },
)
console.log(withCustom({ email: 'a@vip.com' }).events.map((e) => e.type)) // [ 'vipDomain' ]
console.log(withCustom({ email: 'a@x.com' }).events.map((e) => e.type)) //  []
