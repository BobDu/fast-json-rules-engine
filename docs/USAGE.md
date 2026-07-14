---
description: Complete, runnable walkthrough of every fast-json-rules-engine feature — compile options, operators, decorators, named conditions, paths, and error handling.
---

# Usage

A complete, runnable walkthrough of every feature. All results shown in comments
are actual output from the built library.

Examples use ESM `import`; CommonJS `require('fast-json-rules-engine')` works the
same.

## Core model

Rules are near-static; facts change every call. So the pattern is always
**compile once, run many**:

```js
import { compile } from 'fast-json-rules-engine'

const engine = compile(rules, options) // compile once (e.g. at config load)
const result = engine.run(facts)           // call per request; synchronous
```

`engine.run(facts)` returns:

```js
{
  events, // events of matched rules, ordered by priority descending
}
```

Only `events` is returned. json-rules-engine's `failureEvents`, `results`,
`failureResults`, and `almanac` are not produced here.

```js
const engine = compile([
  { conditions: { all: [{ fact: 'age', operator: 'greaterThanInclusive', value: 18 }] }, event: { type: 'adult', params: { tier: 'A' } } },
])

engine.run({ age: 20 }).events // → [{ type: 'adult', params: { tier: 'A' } }]
engine.run({ age: 10 }).events // → []  (no rule matched)
```

Most callers only need `events`; the highest-priority match is `events[0]`.

Returned events are normalized to `{ type, params? }` (params kept only when
truthy, any other keys dropped) and are read-only — the engine reuses the same
object across evaluations, and `params` is the source rule's sub-object (not a
per-run clone). `Event` is generic; `params` defaults to
`Record<string, unknown>`, so cast at the read site for a known shape:
`(events[0] as Event<{ tier: string }>).params?.tier`.

## Operators

A leaf condition is `{ fact, operator, value }` — it compares `facts[fact]`
against `value` using `operator`. The ten built-in operators:

| operator | meaning | example (matches) |
| --- | --- | --- |
| `equal` | strict `===` | `{ operator: 'equal', value: 5 }`, `f = 5` |
| `notEqual` | strict `!==` | `value: 5`, `f = 9` |
| `greaterThan` | `>` | `value: 5`, `f = 6` |
| `greaterThanInclusive` | `>=` | `value: 5`, `f = 5` |
| `lessThan` | `<` | `value: 5`, `f = 4` |
| `lessThanInclusive` | `<=` | `value: 5`, `f = 5` |
| `in` | fact is in the value array | `value: ['US', 'GB']`, `f = 'GB'` |
| `notIn` | fact is not in the value array | `value: ['US', 'GB']`, `f = 'BR'` |
| `contains` | fact (an array) contains value | `value: 'vip'`, `f = ['a', 'vip']` |
| `doesNotContain` | fact (an array) lacks value | `value: 'vip'`, `f = ['a', 'b']` |

Note the direction: for `in`/`notIn` the **value** is the array and the fact is
a scalar; for `contains`/`doesNotContain` the **fact** is the array and the value
is a scalar. Numeric operators reject non-numeric facts (so `null >= 0` is
`false`, not JavaScript's `true`), matching json-rules-engine's `numberValidator`.

The built-in operator and decorator names are exported as `KNOWN_OPERATORS` and
`KNOWN_DECORATORS` (frozen `readonly string[]`) — handy for validating rule
documents before compiling, e.g. in a rule-authoring UI.

## Boolean composition: `all` / `any` / `not`

A rule's `conditions` root must be `all`, `any`, `not`, or a condition reference
(never a bare leaf). They nest to any depth:

```js
const engine = compile([
  {
    conditions: {
      all: [
        { fact: 'country', operator: 'in', value: ['US', 'GB'] },
        { any: [
            { fact: 'spend', operator: 'greaterThan', value: 100 },
            { fact: 'vip', operator: 'equal', value: true },
        ] },
        { not: { fact: 'banned', operator: 'equal', value: true } },
      ],
    },
    event: { type: 'target' },
  },
])

engine.run({ country: 'US', spend: 120, vip: false, banned: false }).events.map((e) => e.type) // → ['target']
engine.run({ country: 'US', spend: 10, vip: true, banned: false }).events.map((e) => e.type)   // → ['target']
engine.run({ country: 'US', spend: 120, vip: false, banned: true }).events.map((e) => e.type)  // → []
```

An empty `all` **and** an empty `any` both evaluate to `true` (deliberately
matching json-rules-engine).

## `priority` and `stopOnFirstEvent`

Rules may carry a `priority` (default `1`); `events` come back **highest
priority first**:

```js
const rules = [
  { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: { type: 'low' }, priority: 1 },
  { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: { type: 'high' }, priority: 100 },
  { conditions: { all: [{ fact: 'x', operator: 'equal', value: 1 }] }, event: { type: 'mid' }, priority: 50 },
]

compile(rules).run({ x: 1 }).events.map((e) => e.type)                          // → ['high', 'mid', 'low']
compile(rules).run({ x: 1 }, { stopOnFirstEvent: true }).events.map((e) => e.type) // → ['high']
```

`stopOnFirstEvent` is a **run** option (`run(facts, { stopOnFirstEvent: true })`),
not a compile option — the same compiled engine can run either way. It stops at
the first (highest-priority) match, the fastest usage for "pick the top matching
tier". Read it as `engine.run(facts, { stopOnFirstEvent: true }).events[0]`.

## Value as a fact reference

`value` can point at another fact instead of being a constant, comparing two
facts at runtime:

```js
const engine = compile([
  { conditions: { all: [{ fact: 'score', operator: 'greaterThan', value: { fact: 'threshold' } }] }, event: { type: 'pass' } },
])

engine.run({ score: 80, threshold: 60 }).events.map((e) => e.type) // → ['pass']
engine.run({ score: 50, threshold: 60 }).events.map((e) => e.type) // → []
```

## Operator decorators (array quantifiers + transforms)

Decorators are prefixes joined to an operator with `:`, mainly for **array**
facts/values. `Fact`/`Value` says which side is iterated as an array; `not`/`swap`
negate/swap; they chain (leftmost is outermost).

```js
{ fact: 'tags',   operator: 'someFact:equal',            value: 'vip' }     // tags array contains 'vip'
{ fact: 'scores', operator: 'everyFact:greaterThan',     value: 60 }        // every score > 60
{ fact: 'x',      operator: 'someValue:equal',           value: [1, 2, 3] } // x equals one of 1/2/3 (same as `in`)
{ fact: 'x',      operator: 'everyValue:greaterThan',    value: [10, 20] }  // x > 10 AND x > 20
{ fact: 'c',      operator: 'swap:contains',             value: ['US'] }    // value array contains c (same as `in`)
{ fact: 'c',      operator: 'not:in',                    value: ['US'] }    // c not in the set (same as `notIn`)
{ fact: 's',      operator: 'not:everyFact:greaterThan', value: 0 }         // chained: NOT (every element > 0)
```

The genuinely unique power is `someFact:*` / `everyFact:*` (existential/universal
over an **array-valued fact**); most other combinations are equivalent to a base
operator. If your facts are never arrays, you likely don't need decorators.

## Named conditions

Name a reusable condition and reference it with `{ condition: 'name' }`, supplied
via `options.conditions`:

```js
const engine = compile(
  [{ conditions: { all: [{ condition: 'isWhale' }, { fact: 'active', operator: 'equal', value: true }] }, event: { type: 'vipWhale' } }],
  {
    conditions: {
      isWhale: { any: [{ fact: 'spend', operator: 'greaterThan', value: 1000 }, { fact: 'vip', operator: 'equal', value: true }] },
    },
  },
)

engine.run({ spend: 2000, active: true, vip: false }).events.map((e) => e.type) // → ['vipWhale']
engine.run({ spend: 10, vip: true, active: false }).events.map((e) => e.type)   // → []
```

Named conditions are inlined at compile time (with circular-reference detection).
A named condition's root must also be `all`/`any`/`not`/`condition`. Each name is
compiled once and its predicate shared across references, but results are not
cached across facts at evaluation time — keep the expanded condition graph
reasonably sized.

## Custom operators

When the ten built-ins aren't enough, pass `(factValue, value) => boolean` via
`options.operators`:

```js
const engine = compile(
  [{ conditions: { all: [{ fact: 'email', operator: 'endsWith', value: '@vip.com' }] }, event: { type: 'vipDomain' } }],
  { operators: { endsWith: (a, b) => typeof a === 'string' && a.endsWith(b) } },
)

engine.run({ email: 'a@vip.com' }).events.map((e) => e.type) // → ['vipDomain']
engine.run({ email: 'a@x.com' }).events.map((e) => e.type)   // → []
```

This is also the clean way to express array quantifiers without decorators, e.g.
`{ allOver: (arr, v) => Array.isArray(arr) && arr.every((x) => x > v) }`.

## `allowUndefinedFacts`

Controls what happens when a rule references a fact absent from `facts`:

```js
const rules = [{ conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] }, event: { type: 'm' } }]

compile(rules).run({})                               // → throws UndefinedFactError: "Undefined fact: missing"
compile(rules, { allowUndefinedFacts: true }).run({}) // → { events: [] }  (absent treated as undefined)
```

The default (`false`) fails loud so a typo or missing fact never silently
produces a wrong answer.

## `allowUndefinedConditions`

Controls what happens when `{ condition: 'name' }` references a name missing
from `options.conditions`:

```js
const rules = [{ conditions: { all: [{ condition: 'isVip' }] }, event: { type: 'v' } }]

compile(rules)                                      // → throws CompileError: Unknown named condition: "isVip"
compile(rules, { allowUndefinedConditions: true })  // compiles — the unknown reference evaluates to false
  .run({}).events                                   // → []
```

The default (`false`) fails loud, eagerly at compile time (json-rules-engine
throws at run time instead, and only if the branch is actually evaluated — see
[MIGRATING](./MIGRATING.md#behavioral-edge-cases)). With `true`, the unknown
reference compiles to `false`, matching json-rules-engine.

## `path` (requires an injected resolver)

Extract a sub-value from an object-valued fact. This library does not bundle a
JSONPath engine (to stay zero-dependency); inject jsonpath-plus (use
`jsonpath-plus@^10.4.0` — older releases carry a JSONPath RCE advisory) for full
JSONPath behavior:

```js
import { compile } from 'fast-json-rules-engine'
import { JSONPath } from 'jsonpath-plus'

const jp = (value, path) => JSONPath({ path, json: value, wrap: false })

const engine = compile(
  [{ conditions: { all: [{ fact: 'user', path: '$.profile.level', operator: 'greaterThan', value: 10 }] }, event: { type: 'senior' } }],
  { pathResolver: jp },
)

engine.run({ user: { profile: { level: 20 } } }).events.map((e) => e.type) // → ['senior']

// full JSONPath (array index) works through the injected resolver:
compile(
  [{ conditions: { all: [{ fact: 'o', path: '$.items[0].id', operator: 'equal', value: 7 }] }, event: { type: 'first' } }],
  { pathResolver: jp },
).run({ o: { items: [{ id: 7 }] } }).events.map((e) => e.type) // → ['first']
```

A rule that uses `path` without a `pathResolver` throws `CompileError` at compile
time (fail loud). A path is applied only when the fact value is a non-null object,
matching json-rules-engine; primitives pass through unchanged.

## See also

- [README](https://github.com/BobDu/fast-json-rules-engine#readme) — overview, benchmarks, compatibility matrix, migration.
