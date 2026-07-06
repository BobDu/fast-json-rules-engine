// The ten built-in operators, one rule each.  Run: node examples/02-operators.mjs
import { compile } from 'fast-json-rules-engine'

const rules = [
  { conditions: { all: [{ fact: 'age', operator: 'equal', value: 18 }] }, event: { type: 'equal' } },
  { conditions: { all: [{ fact: 'age', operator: 'notEqual', value: 0 }] }, event: { type: 'notEqual' } },
  { conditions: { all: [{ fact: 'age', operator: 'greaterThan', value: 10 }] }, event: { type: 'greaterThan' } },
  { conditions: { all: [{ fact: 'age', operator: 'greaterThanInclusive', value: 18 }] }, event: { type: 'greaterThanInclusive' } },
  { conditions: { all: [{ fact: 'age', operator: 'lessThan', value: 20 }] }, event: { type: 'lessThan' } },
  { conditions: { all: [{ fact: 'age', operator: 'lessThanInclusive', value: 18 }] }, event: { type: 'lessThanInclusive' } },
  { conditions: { all: [{ fact: 'country', operator: 'in', value: ['US', 'GB'] }] }, event: { type: 'in' } },
  { conditions: { all: [{ fact: 'country', operator: 'notIn', value: ['CN', 'JP'] }] }, event: { type: 'notIn' } },
  { conditions: { all: [{ fact: 'roles', operator: 'contains', value: 'admin' }] }, event: { type: 'contains' } },
  { conditions: { all: [{ fact: 'roles', operator: 'doesNotContain', value: 'banned' }] }, event: { type: 'doesNotContain' } },
]

const engine = compile(rules)
const facts = { age: 18, country: 'US', roles: ['user', 'admin'] }

console.log(engine.run(facts).events.map((e) => e.type))
// → all ten fire for these facts (same-priority rules keep input order):
// [ 'equal', 'notEqual', 'greaterThan', 'greaterThanInclusive', 'lessThan',
//   'lessThanInclusive', 'in', 'notIn', 'contains', 'doesNotContain' ]
