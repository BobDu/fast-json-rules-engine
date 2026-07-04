// Operator decorators: array quantifiers + not/swap.  Run: node examples/05-decorators.mjs
import { compile } from 'fast-json-rules-engine'

const matches = (operator, value, f) =>
  compile([{ conditions: { all: [{ fact: 'f', operator, value }] }, event: { type: 'ok' } }])({ f }).events.length > 0

const show = (operator, value, f) =>
  console.log(operator.padEnd(28), 'f =', JSON.stringify(f).padEnd(16), '→', matches(operator, value, f) ? 'match' : 'no match')

show('someFact:equal', 'vip', ['free', 'vip']) //           fact array contains 'vip'
show('everyFact:greaterThan', 60, [80, 70]) //              every element > 60
show('everyFact:greaterThan', 60, [80, 40]) //              one element <= 60
show('someValue:equal', [1, 2, 3], 2) //                    fact equals one of the values (same as `in`)
show('everyValue:greaterThan', [10, 20], 25) //             fact > every value (i.e. > max)
show('swap:contains', ['US', 'GB'], 'US') //                value array contains fact (same as `in`)
show('not:in', ['US', 'GB'], 'BR') //                       fact not in the set (same as `notIn`)
show('not:everyFact:greaterThan', 0, [5, -1]) //            chained: NOT (every element > 0)
