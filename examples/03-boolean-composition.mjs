// all / any / not, nested to any depth.  Run: node examples/03-boolean-composition.mjs
import { compile } from 'fast-json-rules-engine'

const rules = [
  {
    conditions: {
      all: [
        { fact: 'country', operator: 'in', value: ['US', 'GB'] },
        {
          any: [
            { fact: 'spend', operator: 'greaterThan', value: 100 },
            { fact: 'vip', operator: 'equal', value: true },
          ],
        },
        { not: { fact: 'banned', operator: 'equal', value: true } },
      ],
    },
    event: { type: 'target' },
  },
]

const engine = compile(rules)

for (const facts of [
  { country: 'US', spend: 120, vip: false, banned: false }, // → ['target']  (spend>100)
  { country: 'US', spend: 10, vip: true, banned: false }, //  → ['target']  (vip)
  { country: 'US', spend: 120, vip: false, banned: true }, // → []          (banned)
  { country: 'CN', spend: 999, vip: true, banned: false }, // → []          (country not in US/GB)
]) {
  console.log(JSON.stringify(facts), '→', engine.run(facts).events.map((e) => e.type))
}
