// End-to-end: pick a user's segment from a priority-ordered rule set.
// Run: node examples/08-user-segmentation.mjs
import { compile } from 'fast-json-rules-engine'

// Rules as they'd live in config or a DB (plain json-rules-engine format).
// Highest-priority matching rule wins; the last rule is a catch-all.
const rules = [
  {
    priority: 40,
    conditions: { all: [{ fact: 'iapTotal', operator: 'greaterThanInclusive', value: 1000 }] },
    event: { type: 'whale', params: { groupId: 1004 } },
  },
  {
    priority: 30,
    conditions: {
      all: [
        { fact: 'iapTotal', operator: 'greaterThan', value: 0 },
        { fact: 'country', operator: 'in', value: ['US', 'GB', 'DE', 'JP'] },
      ],
    },
    event: { type: 'payer', params: { groupId: 1003 } },
  },
  {
    priority: 20,
    conditions: {
      any: [
        { fact: 'daysActive', operator: 'greaterThanInclusive', value: 7 },
        { fact: 'maxLevel', operator: 'greaterThan', value: 50 },
      ],
    },
    event: { type: 'engaged', params: { groupId: 1002 } },
  },
  {
    priority: 10,
    conditions: { all: [] }, // catch-all: an empty `all` is always true
    event: { type: 'default', params: { groupId: 1000 } },
  },
]

// Compile once at startup; take the single highest-priority match per request.
const segment = compile(rules, { stopOnFirstEvent: true })
const groupOf = (player) => segment(player).events[0]?.params.groupId ?? -1

console.log(groupOf({ iapTotal: 5000, country: 'US', daysActive: 30, maxLevel: 80 })) // 1004  whale
console.log(groupOf({ iapTotal: 20, country: 'US', daysActive: 2, maxLevel: 10 })) //   1003  payer
console.log(groupOf({ iapTotal: 0, country: 'BR', daysActive: 10, maxLevel: 5 })) //    1002  engaged
console.log(groupOf({ iapTotal: 0, country: 'BR', daysActive: 1, maxLevel: 3 })) //     1000  default
