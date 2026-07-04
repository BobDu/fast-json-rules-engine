# fast-json-rules-engine

> Same rules JSON, compiled once — no promises, no clones.

A compiled, **synchronous**, **zero-dependency** rules engine that speaks the
[json-rules-engine](https://github.com/CacheControl/json-rules-engine) rule
format. Compile a rule set once into plain predicate functions, then evaluate
many facts objects — **~140× faster** than json-rules-engine on a typical rule
set, and over **1000× faster** for first-match lookups.

It trades away runtime dynamism (async facts, event handlers, the evaluated
conditions tree, live rule mutation) for speed. If your facts are plain values
and you evaluate the same rules over and over, that trade is usually free.

> **Status:** pre-1.0. The rule evaluation is verified against json-rules-engine
> 6.6.0 by differential fuzzing (tens of thousands of randomized cases per run),
> but the API may still change before 1.0.

This is an independent project and is **not affiliated with** json-rules-engine
or its author.

## Install

```sh
npm install fast-json-rules-engine
```

## Usage

```js
import { compile } from 'fast-json-rules-engine'

const rules = [
  {
    conditions: {
      all: [
        { fact: 'country', operator: 'in', value: ['US', 'GB', 'CA'] },
        { fact: 'spend', operator: 'greaterThanInclusive', value: 100 },
      ],
    },
    event: { type: 'whale', params: { tier: 'gold' } },
    priority: 10,
  },
  {
    conditions: { all: [{ fact: 'spend', operator: 'greaterThan', value: 0 }] },
    event: { type: 'payer', params: { tier: 'silver' } },
    priority: 5,
  },
]

// Compile once (e.g. when your config loads), reuse for every request.
const evaluate = compile(rules)

const { events } = evaluate({ country: 'US', spend: 250 })
// events -> [{ type: 'whale', params: { tier: 'gold' } },
//            { type: 'payer', params: { tier: 'silver' } }]

// events are ordered by priority (highest first), so the first is the top match:
const topTier = events[0]?.params.tier // 'gold'
```

`evaluate(facts)` returns:

```ts
{
  events: Event[]          // matched rules' events, priority descending
  failureEvents: Event[]   // unmatched rules' events
  results: RuleResult[]    // { result, event, priority, name } per matched rule
  failureResults: RuleResult[]
}
```

### First-match only

If you only care about the highest-priority match (a common segmentation
pattern), `stopOnFirstEvent` stops at the first hit and is dramatically faster:

```js
const evaluate = compile(rules, { stopOnFirstEvent: true })
const tier = evaluate(facts).events[0]?.params.tier
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `allowUndefinedFacts` | `false` | When `false`, evaluating a rule that references an absent fact throws `UndefinedFactError` (matches json-rules-engine). When `true`, an absent fact is treated as `undefined`. |
| `stopOnFirstEvent` | `false` | Stop after the first (highest-priority) matching rule. |
| `operators` | – | Custom operators: `{ name: (factValue, value) => boolean }`. |
| `conditions` | – | Named conditions referenced via `{ condition: 'name' }`. |
| `pathResolver` | – | `(value, path) => resolved`. Required to use `path` — see [Paths](#paths). |

### Paths

fast-json-rules-engine does **not** bundle a JSONPath implementation — a
condition `path` requires an injected `pathResolver`. Pass jsonpath-plus (what
json-rules-engine uses internally) for identical behavior, including full
JSONPath (wildcards, recursive descent, filters, slices):

```sh
npm install jsonpath-plus
```

```js
import { compile } from 'fast-json-rules-engine'
import { JSONPath } from 'jsonpath-plus'

const evaluate = compile(rules, {
  pathResolver: (value, path) => JSONPath({ path, json: value, wrap: false }),
})
// now conditions like { fact: 'user', path: '$.profile.level', operator: 'greaterThan', value: 10 } work
```

Without a `pathResolver`, any rule using `path` throws `CompileError` at compile
time (fail loud, never a silent wrong answer). A path is applied only when the
fact value is a non-null object — matching json-rules-engine; primitives pass
through unchanged. Not bundling the JSONPath engine keeps the core zero-dependency
and leaves path semantics to the library that specializes in them.

Migrating a json-rules-engine rule that uses `path`? Install jsonpath-plus and
pass the one-liner above — nothing else in your rules changes.

## Compatibility

fast-json-rules-engine is a **drop-in replacement, not a reimplementation**. Any
json-rules-engine rule document compiles unchanged and produces identical
`events`. What it deliberately does *not* replicate is json-rules-engine's
runtime dynamism — async facts, event handlers, the evaluated-conditions result
tree, runtime rule mutation — which is exactly what makes it slow per run. Each
feature is kept or dropped by weighing compatibility value against implementation
complexity and runtime overhead; a few rarely-used or malformed-input behaviors
are intentionally rejected loudly rather than replicated (see the tables below).

The **rule format** is fully supported — existing json-rules-engine rule
documents compile unchanged:

| Supported | Notes |
| --- | --- |
| All 10 operators | `equal`, `notEqual`, `in`, `notIn`, `contains`, `doesNotContain`, `lessThan(Inclusive)`, `greaterThan(Inclusive)` |
| All 6 operator decorators | `someFact`, `someValue`, `everyFact`, `everyValue`, `swap`, `not` (e.g. `everyFact:greaterThan`) |
| Nested `all` / `any` / `not` | Any depth |
| `priority` | Rule priority; events returned highest-first |
| Value as fact reference | `value: { fact: 'other' }` |
| Named conditions | via `options.conditions` and `{ condition: 'name' }` |
| Custom operators | via `options.operators` |
| `path` | Via an injected `pathResolver` (e.g. jsonpath-plus) — see [Paths](#paths) |
| `allowUndefinedFacts` | Both modes |

What it deliberately does **not** do (the runtime dynamism it trades for speed):

| Not supported | Why / alternative |
| --- | --- |
| Async facts / fact functions | Facts must be plain static values. This is the core assumption that makes compilation worthwhile. |
| Event handlers (`engine.on('success', …)`) | Read the returned `events` instead. |
| The evaluated conditions tree in results | `results` carry `{ result, event, priority, name }` — not the per-condition result tree that json-rules-engine deep-clones each run. |
| Runtime rule mutation (`addRule` after run) | Rules are compiled up front; recompile to change them. |
| Bundled JSONPath | No path engine is shipped; `path` requires an injected `pathResolver` (see [Paths](#paths)). |
| Sub-condition priorities | A `priority` on a nested condition (json-rules-engine's within-rule evaluation ordering) is rejected at compile time — meaningless once compiled over static facts. |

Unknown operators, unsupported paths, malformed conditions, and circular named
conditions **throw `CompileError` at compile time**, not silently at runtime.

### Semantics

Operator, decorator, and edge-case behavior is replicated from json-rules-engine
6.6.0 and continuously checked by the differential fuzzer, including the subtle
cases: numeric operators gate on json-rules-engine's `numberValidator` (so
`null >= 0` is `false`, not `true`); `in`/`notIn` use `indexOf` semantics (so
`NaN` is never "in"); an empty `all` **or** `any` evaluates to `true`; and `path`
applies only to non-null object fact values.

## Benchmarks

30 rules, each a flat `all` of 2–4 comparisons with distinct priorities, one
match — the shape of a typical segmentation/tiering config. Run it yourself with
`npm run bench`.

| Variant | µs / eval | vs json-rules-engine |
| --- | --- | --- |
| json-rules-engine (reused engine) | 377.7 | 1× |
| json-rules-engine (new Engine + addRule per eval) | 498.9 | 0.8× |
| **fast-json-rules-engine — compile per eval** | 21.9 | **17×** |
| **fast-json-rules-engine — compiled once** | 2.68 | **141×** |
| **fast-json-rules-engine — compiled once + `stopOnFirstEvent`** | 0.33 | **1153×** |

_Node 24; numbers vary by machine and rule shape. The point is the order of
magnitude: json-rules-engine's per-run cost (a deep clone of every rule's
condition tree plus a fully promise-based evaluation) is designed for dynamic
async facts — pure overhead when facts are static values._

## Migrating from json-rules-engine

1. Move engine construction out of the hot path: build your rules array once and
   call `compile(rules, options)` — cache the returned function.
2. Replace `await engine.run(facts)` with `evaluate(facts)` (synchronous).
3. Replace `engine.on('success', …)` / `engine.on('failure', …)` handlers with
   reading `events` / `failureEvents` from the result.
4. For "first matching rule wins", use `events[0]` (events are priority-ordered)
   or `stopOnFirstEvent: true`.
5. Custom operators move from `engine.addOperator(name, cb)` to
   `compile(rules, { operators: { name: cb } })`; named conditions from
   `engine.setCondition(name, cond)` to `{ conditions: { name: cond } }`.

If you rely on async fact functions, event-driven side effects during
evaluation, or the full evaluated-conditions result tree, stay on
json-rules-engine — those are the features traded away here.

## How it works

Rules are static; only the facts change per call. So the rule JSON is
translated **once** into a sorted array of predicate closures (operators become
direct comparisons, `in`/`notIn` value arrays are captured, nested booleans
become short-circuiting loops). Evaluation is then a plain synchronous walk with
no per-run allocation of promises, almanacs, or cloned condition trees.

## License

[MIT](./LICENSE) © BobDu
