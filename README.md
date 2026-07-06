# fast-json-rules-engine

> Same rules JSON, compiled once — no promises, no clones.

[![CI](https://github.com/BobDu/fast-json-rules-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/BobDu/fast-json-rules-engine/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/fast-json-rules-engine.svg)](https://www.npmjs.com/package/fast-json-rules-engine)
[![node](https://img.shields.io/node/v/fast-json-rules-engine.svg)](https://www.npmjs.com/package/fast-json-rules-engine)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A compiled, **synchronous**, **zero-dependency** rules engine that speaks the
[json-rules-engine](https://github.com/CacheControl/json-rules-engine) rule
format. Compile a rule set once into plain predicate functions, then evaluate
many facts objects — **~190× faster** than json-rules-engine on a typical rule
set, and **~190× faster than its own `engine.stop()` first-match pattern**
(≈590× vs a full run) for first-match lookups.

It trades away runtime dynamism (async facts, event handlers, the evaluated
conditions tree, live rule mutation) for speed. If your facts are plain values
and you evaluate the same rules over and over, that trade is usually free.

> **Status:** pre-1.0. The rule evaluation is verified against json-rules-engine
> 6.6.0 by differential fuzzing (thousands of randomized cases per run, tens of
> thousands in CI),
> but the API may still change before 1.0.

This is an independent project and is **not affiliated with** json-rules-engine
or its author.

## Install

```sh
npm install fast-json-rules-engine
```

Runs on **Node 14+** — including stacks that can't adopt json-rules-engine 7's
Node 18 / ESM-only jsonpath-plus requirements. Types are bundled (needs
TypeScript >= 4.7).

## Usage

> Full walkthrough of every feature: **[docs/USAGE.md](./docs/USAGE.md)**.
> Runnable scripts (real rules + facts + output): **[examples/](./examples/)**.

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
const topTier = events[0]?.params?.tier // 'gold'
```

`evaluate(facts)` returns:

```ts
{
  events: Event[]          // matched rules' events, priority descending
  failureEvents: Event[]   // unmatched rules' events
  results: RuleResult[]    // { result, event, priority, name, ruleIndex } per matched rule
  failureResults: RuleResult[]
}
```

Returned events are **normalized** to json-rules-engine's shape — `{ type, params? }`,
with `params` present only when truthy and any other keys dropped (a rule event
`{ type: 'x', params: null, tag: 1 }` comes back as `{ type: 'x' }`). Each event is
a fresh object the engine owns and **reuses across evaluations**, so treat returned
events as read-only. Its `params` is the *same* sub-object as the source rule's
(not a per-run deep clone, unlike json-rules-engine) — so never mutate it.

`Event` is generic (`Event<Params>`); `params` is `Record<string, unknown>` by
default. Cast at the read site when you know the shape:

```ts
import type { Event } from 'fast-json-rules-engine'
const tier = (events[0] as Event<{ tier: string }>).params?.tier // string | undefined
```

### First-match only

If you only care about the highest-priority match (a common segmentation
pattern), `stopOnFirstEvent` stops at the first hit and is dramatically faster:

```js
const evaluate = compile(rules, { stopOnFirstEvent: true })
const tier = evaluate(facts).events[0]?.params?.tier
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
condition `path` requires an injected `pathResolver`. Pass jsonpath-plus for
full JSONPath (wildcards, recursive descent, filters, slices) with the same
behavior json-rules-engine gives:

```sh
npm install jsonpath-plus  # use >=10.4.0 — older releases have a JSONPath RCE advisory
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
json-rules-engine rule document compiles unchanged and produces the same
`events` (identical across priorities; within a tied priority, see [Semantics](#semantics)). What it deliberately does *not* replicate is json-rules-engine's
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
| `replaceFactsInEventParams` | No runtime almanac to resolve `{ fact }` references inside event params; rejected at compile time. Resolve them yourself after `evaluate()`. |

Unknown operators, unsupported paths, malformed conditions, and circular named
conditions **throw `CompileError` at compile time**, not silently at runtime.
For workarounds to the unsupported features, see [docs/MIGRATING.md](./docs/MIGRATING.md).

### Semantics

Operator, decorator, and edge-case behavior is replicated from json-rules-engine
6.6.0 and continuously checked by the differential fuzzer, including the subtle
cases: numeric operators gate on json-rules-engine's `numberValidator` (so
`null >= 0` is `false`, not `true`); `in`/`notIn` use `indexOf` semantics (so
`NaN` is never "in"); an empty `all` **or** `any` evaluates to `true`; and `path`
applies only to non-null object fact values. Returned events are normalized to
`{ type, params? }` (falsy `params` and any other keys dropped), matching
json-rules-engine's `setEvent`. Named conditions are inlined and share one
compiled predicate per name — evaluated once per reference but not cached across
facts, so keep the expanded condition graph reasonably sized. Across different
priorities, event order matches json-rules-engine exactly; within a *tied*
priority this library preserves rule-definition order, whereas json-rules-engine's
tied order follows promise resolution (condition-tree depth) — both deterministic,
but they can differ when rules share a priority. (6.6.0 is the differential oracle
because the rule-format semantics are unchanged through json-rules-engine 7.x —
the 7.0 major was a Node 18 / jsonpath-plus bump, not an engine change — and 6.6.0
runs on the same Node range this library supports.)

## Benchmarks

30 rules, each a flat `all` of 2–4 comparisons with distinct priorities,
evaluated against a pool of facts objects (the sample matches 7 of 30 rules) —
the shape of a typical segmentation/tiering config. Run it yourself with
`npm run bench`.

| Variant | µs / eval | vs full run |
| --- | --- | --- |
| json-rules-engine — reused engine, full run | 369.5 | 1× |
| json-rules-engine — new Engine + addRule per eval | 496.2 | 0.7× |
| json-rules-engine — reused engine, first-match via `engine.stop()` | 120.0 | 3.1× |
| **fast-json-rules-engine — compile per eval** | 29.1 | **13×** |
| **fast-json-rules-engine — compiled once** | 1.95 | **189×** |
| **fast-json-rules-engine — compiled once + `stopOnFirstEvent`** | 0.63 | **590×** |

For a fair first-match comparison, put the two early-exit modes side by side:
fast-json-rules-engine's `stopOnFirstEvent` (0.63 µs) is **~190× faster** than
json-rules-engine's own `engine.stop()`-on-first-success pattern (120.0 µs).

_Node 24; numbers vary by machine and rule shape. The point is the order of
magnitude: json-rules-engine's per-run cost (a deep clone of every rule's
condition tree plus a fully promise-based evaluation) is designed for dynamic
async facts — pure overhead when facts are static values._

## Migrating from json-rules-engine

Your rule JSON and `events` are compatible; swap `new Engine + addRule + await
run` for `compile + evaluate` (synchronous), and read `events` instead of
registering `on('success')` handlers. Runtime-dynamic features (async facts,
event handlers, the conditions result tree, custom almanac) aren't replicated.

**Full guide** — API mapping, a supported / one-line-change / unsupported
breakdown, edge cases, and the example-by-example mapping:
**[docs/MIGRATING.md](./docs/MIGRATING.md)**.

## How it works

Rules are static; only the facts change per call. So the rule JSON is
translated **once** into a sorted array of predicate closures (operators become
direct comparisons, `in`/`notIn` value arrays are captured, nested booleans
become short-circuiting loops). Evaluation is then a plain synchronous walk with
no per-run allocation of promises, almanacs, or cloned condition trees.

## API

All exports from `fast-json-rules-engine`:

- **`compile(rules, options?)`** → `(facts) => { events, failureEvents, results, failureResults }`.
  `rules` is a rule object or an array; see [Options](#options).
- **`CompileError`** — thrown at compile time (unknown operator, malformed
  condition, uninjected `path`, cycle, over-deep nesting). Carries
  `code: 'COMPILE_ERROR'` and, for a rule-scoped error, `ruleIndex`.
- **`UndefinedFactError`** — thrown at evaluate time when a referenced fact is
  absent and `allowUndefinedFacts` is false. Carries `code: 'UNDEFINED_FACT'` and
  `factId`.
- **`KNOWN_OPERATORS`, `KNOWN_DECORATORS`** — frozen `readonly string[]` of the
  built-in operator / decorator names, handy for validating rule documents before
  compiling.
- **Types:** `Rule` (also exported as `RuleProperties`), `CompileOptions`,
  `CompiledRules`, `Event<Params>`, `EngineResult`, `RuleResult`, `Facts`,
  `Condition` / `TopLevelCondition` / `LeafCondition` / `AllCondition` /
  `AnyCondition` / `NotCondition` / `ConditionReference` / `ValueReference`,
  `OperatorFn`, `PathResolver`.

Type your rule documents with `Rule` — also exported as `RuleProperties`
(json-rules-engine's name for the same shape), so rules typed against upstream
drop in unchanged:

```ts
import { compile } from 'fast-json-rules-engine'
import type { Rule } from 'fast-json-rules-engine'

const rules: Rule[] = [/* ... */]
const evaluate = compile(rules)
```

## Security

Rules and compile options are **trusted configuration** — custom operators and
the `pathResolver` run arbitrary code you provide, so never pass
attacker-controlled functions. Rule JSON from semi-trusted sources is bounded at
compile time (nesting depth is capped; named-condition fan-out is memoized), but
treat rule documents as code. Facts are data, never evaluated. See
[SECURITY.md](./SECURITY.md).

## Credits

The rule format, operator/decorator semantics, and error messages are
reimplemented from [json-rules-engine](https://github.com/CacheControl/json-rules-engine)
by Cache Hamm / CacheControl (ISC License). This is an independent, unaffiliated
project; any behavioral divergences are its own.

## License

[MIT](./LICENSE) © BobDu
