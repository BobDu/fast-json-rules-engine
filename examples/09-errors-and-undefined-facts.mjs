// Fail-loud errors + allowUndefinedFacts.  Run: node examples/09-errors-and-undefined-facts.mjs
import { compile, CompileError, UndefinedFactError } from 'fast-json-rules-engine'

// 1) By default, a missing fact throws UndefinedFactError at evaluate time.
const evaluate = compile([
  { conditions: { all: [{ fact: 'age', operator: 'greaterThan', value: 18 }] }, event: { type: 'adult' } },
])
try {
  evaluate({}) // no `age`
} catch (e) {
  console.log(e instanceof UndefinedFactError, e.code, e.factId) // true UNDEFINED_FACT age
}

// 2) allowUndefinedFacts: true treats an absent fact as undefined (no throw) —
// the condition simply doesn't match.
const lenient = compile(
  [{ conditions: { all: [{ fact: 'age', operator: 'greaterThan', value: 18 }] }, event: { type: 'adult' } }],
  { allowUndefinedFacts: true },
)
console.log(lenient({}).events) // []

// 3) Malformed rules fail loud at COMPILE time with a CompileError (never a silent
// wrong answer at runtime). The error carries the offending rule's index.
try {
  compile([{ conditions: { all: [{ fact: 'x', operator: 'nope', value: 1 }] }, event: { type: 't' } }])
} catch (e) {
  console.log(e instanceof CompileError, e.code, e.ruleIndex) // true COMPILE_ERROR 0
}
