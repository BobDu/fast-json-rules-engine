// priority ordering + stopOnFirstEvent.  Run: node examples/04-priority-and-stop.mjs
import { compile } from 'fast-json-rules-engine'

// A tiering rule set: a big spender matches every tier, but we usually want the top one.
const rules = [
  { conditions: { all: [{ fact: 'spend', operator: 'greaterThanInclusive', value: 1000 }] }, event: { type: 'gold' }, priority: 30 },
  { conditions: { all: [{ fact: 'spend', operator: 'greaterThanInclusive', value: 100 }] }, event: { type: 'silver' }, priority: 20 },
  { conditions: { all: [{ fact: 'spend', operator: 'greaterThan', value: 0 }] }, event: { type: 'bronze' }, priority: 10 },
]

const facts = { spend: 5000 }

// Default: all matches, highest priority first.
console.log(compile(rules).run(facts).events.map((e) => e.type)) // [ 'gold', 'silver', 'bronze' ]

// stopOnFirstEvent: only the single top-priority match (fastest).
console.log(compile(rules, { stopOnFirstEvent: true }).run(facts).events[0].type) // 'gold'
