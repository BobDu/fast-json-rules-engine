# Migrating from json-rules-engine

fast-json-rules-engine is a **drop-in replacement for the rule format and the
`events` output**, not a reimplementation of json-rules-engine's runtime
dynamics. In practice:

- Your **rule JSON is unchanged** and produces the **same `events`**.
- Swap `new Engine() + addRule() + await run()` for `compile()` then a
  synchronous `.run()`.
- Read the returned `events` instead of registering `on('success')` handlers.
- A handful of runtime-dynamic features are intentionally **not** supported —
  they're the source of json-rules-engine's per-run cost.

## API at a glance

```js
// json-rules-engine
import { Engine } from 'json-rules-engine'

const engine = new Engine([], { allowUndefinedFacts: true })
rules.forEach((r) => engine.addRule(r))
engine.addOperator('startsWith', (a, b) => a.startsWith(b))
engine.setCondition('isWhale', cond)
engine.on('success', (event) => handle(event))
const { events } = await engine.run(facts)
```

```js
// fast-json-rules-engine
import { compile } from 'fast-json-rules-engine'

const engine = compile(rules, {
  allowUndefinedFacts: true,
  operators: { startsWith: (a, b) => a.startsWith(b) },
  conditions: { isWhale: cond },
})
const { events } = engine.run(facts) // synchronous — no await
for (const event of events) handle(event) // read events instead of on('success')
```

`run()` returns **only `events`** — the matched rules' events, highest-priority
first, normalized to `{ type, params? }`. json-rules-engine additionally returns
`failureEvents`, `results`, `failureResults`, and an `almanac`, which are **not
supported** here (see the table below). So most call sites only change from
`await engine.run(facts)` to `engine.run(facts)` (still `engine.run`, just no `await`)
and read `.events`. Reading a dropped surface (`result.failureEvents`, `.results`, …)
returns `undefined` — it does **not** throw — so ported code that iterated one turns
into a silent no-op (or a `TypeError` only when you loop over the `undefined`); audit
those call sites.

**`run()` is synchronous — mind `.then()`.** It returns the result object
directly, not a Promise. `await engine.run(facts)` keeps working (awaiting a
non-Promise is harmless), so code ported with a leftover `await` is fine. But a
Promise chain — `engine.run(facts).then(…)` / `.catch(…)` — throws
`TypeError: … .then is not a function`, because the result is a plain object with
no `.then`. Drop the chain and use the returned value directly.

## ✅ Works unchanged

Existing rule documents compile as-is. These are supported and behave the same,
except where a caveat is noted inline:

- All 10 operators (`equal`, `notEqual`, `in`, `notIn`, `contains`,
  `doesNotContain`, `lessThan(Inclusive)`, `greaterThan(Inclusive)`).
- All 6 operator decorators (`someFact`, `someValue`, `everyFact`, `everyValue`,
  `swap`, `not`), including chains like `not:everyFact:greaterThan`.
- Nested `all` / `any` / `not` (up to a compile-time depth cap of **512** — see
  [edge cases](#behavioral-edge-cases)); empty `all`/`any` both evaluate to `true`,
  as in json-rules-engine.
- Rule `priority` (events come back highest-priority first). Within a **tied**
  priority, order is deterministic here (rule-definition order), whereas
  json-rules-engine's tied order follows promise resolution — don't rely on tie
  order matching upstream.
- `value` as a fact reference: `value: { fact: 'other' }`.
- Named conditions via `{ condition: 'name' }` (pass them in `options.conditions`).
- Custom operators (pass them in `options.operators`).
- `allowUndefinedConditions: true` (an unknown `{ condition: 'name' }` compiles to
  `false`) — matches json-rules-engine. The default `false` rejects an unknown
  condition, but *eagerly at compile time* (see [edge cases](#behavioral-edge-cases)).
- `allowUndefinedFacts: true` (an absent fact reads as `undefined`, no throw) —
  identical to json-rules-engine. **The default `false` is not identical**: it also
  throws on a missing fact, but *eagerly and globally* (see [edge cases](#behavioral-edge-cases)).

## ⚙️ One-line changes

| json-rules-engine | fast-json-rules-engine |
| --- | --- |
| `await engine.run(facts)` | `engine.run(facts)` (synchronous; no `await`, no `.then()`) |
| `engine.on('success', cb)` | iterate the returned `events` (`on('failure')` has no counterpart — see below) |
| `engine.on('success', () => engine.stop())` (stop at first match) | `run(facts, { stopOnFirstEvent: true })` |
| `engine.addOperator(name, cb)` | `compile(rules, { operators: { name: cb } })` |
| `engine.setCondition(name, cond)` | `compile(rules, { conditions: { name: cond } })` |
| built-in `path` (jsonpath-plus) | inject it (see below) |

**First match only.** `engine.on('success', () => engine.stop())` becomes a run
option — the same compiled engine can run full or first-match:

```js
// json-rules-engine — stop after the first (highest-priority) match
const engine = new Engine(rules)
engine.on('success', () => engine.stop())
const { events } = await engine.run(facts) // → [ firstMatch ]

// fast-json-rules-engine — pass the run option
const { events } = compile(rules).run(facts, { stopOnFirstEvent: true }) // → [ firstMatch ]
// Note: with the default allowUndefinedFacts:false, the global pre-check still runs
// first, so a fact missing on a skipped lower-priority rule still throws (see below).
```

**`path` needs an injected resolver.** The core ships zero runtime dependencies,
so JSONPath is opt-in — pass jsonpath-plus (use `jsonpath-plus@^10.4.0`; older
releases carry a JSONPath RCE advisory) for the same behavior:

```js
import { JSONPath } from 'jsonpath-plus'

const engine = compile(rules, {
  pathResolver: (value, path) => JSONPath({ path, json: value, wrap: false }),
})
```

A rule using `path` without a `pathResolver` throws `CompileError` at compile
time — it never silently ignores the path.

> **Version note:** the parity oracle (json-rules-engine 6.6.0) bundles
> jsonpath-plus **7.2.0**. Injecting v10 (recommended for the RCE fix) matches on
> common paths but can differ on JSONPath edge cases where v7↔v10 semantics
> changed. Pin the version if exact parity on exotic paths matters.

## ❌ Not supported (and what to do instead)

These are json-rules-engine's runtime-dynamic features. Replicating them would
reintroduce the per-run cost this library exists to avoid, so they're out of
scope. Most have a simple workaround given static facts.

| Feature | Instead |
| --- | --- |
| **Async / computed facts** (`engine.addFact(id, async fn)`) | Compute the value before evaluating and put it on the `facts` object. Facts are plain static values. |
| **Fact dependency** (a fact derived from other facts) | Same — derive it up front and pass it in. |
| **Sub-condition / fact priorities** (a `priority` on a nested condition) | Accepted but **ignored** — it only reorders json-rules-engine's short-circuit, which is meaningless over static facts (the boolean result is order-independent, and reads are free). Rule-level `priority` is honored. |
| **Rule chaining via events/almanac** | Read the returned `events`, build the next `facts`, and call `run` again — you orchestrate the chain explicitly. |
| **Facts in event params** (`replaceFactsInEventParams`) | Ignored — `event.params` is returned as authored. Resolve `{ fact }` references yourself after `run()` ([example below](#resolving-fact-references-in-event-params)). |
| **Fact params on a condition** (`{ fact, params }`) | Only parameterize dynamic fact functions (unsupported); ignored for static facts, exactly as json-rules-engine does. |
| **Custom operator decorators** (`engine.addOperatorDecorator(name, fn)`) | No counterpart — only the 6 built-in decorators resolve. Express the logic as a plain custom operator via `options.operators` instead (e.g. `allOver: (arr, v) => Array.isArray(arr) && arr.every((x) => x > v)`). |
| **Event handlers** (`engine.on(...)`, and the rule-level `onSuccess` / `onFailure` callbacks) | Read the returned `events`. |
| **Custom almanac** | No almanac concept; there's nothing to customize. |
| **Runtime rule mutation** (`addRule` after a run) | Rules are compiled up front; recompile to change them. |
| **`failureEvents` / `results` / `failureResults` / `almanac`** | Not returned — `run()` yields only `events`. json-rules-engine's failure surfaces, per-rule result objects, the evaluated-conditions tree, and the almanac have no counterpart here. Determine failures from your own logic; the condition-tree clone is json-rules-engine's main per-run cost. |

### Resolving fact references in event params

json-rules-engine's non-default `replaceFactsInEventParams` option rewrites
`{ fact: 'x' }`-shaped values inside a matched event's `params` with the resolved
fact value. This engine has no runtime almanac, so **the option is ignored** and
`event.params` comes back exactly as authored. If you relied on it, resolve the
references yourself after `run()`. Returned events are read-only (shared
across evaluations), so build resolved copies rather than mutating them in place:

```js
const isFactRef = (v) => v !== null && typeof v === 'object' && 'fact' in v

const { events } = engine.run(facts)
const resolved = events.map((e) => ({
  type: e.type,
  params:
    e.params &&
    Object.fromEntries(
      Object.entries(e.params).map(([k, v]) => [k, isFactRef(v) ? facts[v.fact] : v]),
    ),
}))
// event.params { userId: { fact: 'id' } }  ->  resolved params { userId: <facts.id> }
```

This handles the common top-level `{ fact }` case; for `path` / nested references,
extend the resolver accordingly.

## Behavioral edge cases

Even where rules are identical, a few malformed-input behaviors differ on
purpose (fail loud rather than guess):

- **A missing or falsy `event`** (absent `event` key, or `null`/`false`/`0`/`''`)
  throws `CompileError`, whereas json-rules-engine defaults it to `{ type: 'unknown' }`.
- **`priority`** is parsed like json-rules-engine (`|| 1`, then `parseInt`); a
  parsed result `<= 0` throws in both engines, but an *unparseable* priority
  (`parseInt` → `NaN`) throws here while json-rules-engine stores `NaN` and runs.
- **Missing `value` on a leaf, or missing `event.type`** throws `CompileError`
  (json-rules-engine also rejects these).
- **Condition nesting is capped at depth 512.** A tree — or a fully-expanded
  named-condition chain — deeper than 512 throws `CompileError` at compile time,
  where json-rules-engine keeps recursing (and eventually overflows the stack with
  a `RangeError` at run time). A deliberate fail-loud bound.
- **Other malformed input fails loud at *compile*** (`CompileError`) rather than at
  run time: an unknown operator/decorator, a circular named-condition reference, and
  a non-string `fact` / value-`fact` identifier. json-rules-engine surfaces these
  later — a run-time `Error`, a stack overflow, or an undefined-fact read. (The
  non-string-`fact` case is TypeScript-forbidden, so it mainly affects untyped JS.)
- **An unknown named condition** (`{ condition: 'name' }` with no matching entry in
  `options.conditions`) throws `CompileError` **eagerly at compile** here — before
  any run, regardless of short-circuit — whereas json-rules-engine throws a plain
  ``Error(`No condition ${name} exists`)`` **lazily at run**, and only if that branch is
  actually evaluated. Set `allowUndefinedConditions: true` to compile it to `false`
  instead (matches json-rules-engine).
- **Undefined facts fail loud *eagerly and globally*.** With the default
  `allowUndefinedFacts: false`, `run()` checks every fact referenced by *any* rule
  up front and throws `UndefinedFactError` before evaluating a single rule — so a
  missing fact throws even when short-circuit or `stopOnFirstEvent` would have
  skipped the rule that references it. json-rules-engine checks lazily (only as each
  evaluated rule reads a fact), so it can **return normally** where this engine
  **throws**:

  ```js
  const rules = [
    { conditions: { all: [{ fact: 'tier', operator: 'equal', value: 'gold' }] },
      event: { type: 'vip' }, priority: 10 },
    { conditions: { all: [{ fact: 'missing', operator: 'equal', value: 1 }] },
      event: { type: 'other' }, priority: 1 },
  ]
  const facts = { tier: 'gold' } // `missing` is absent

  // json-rules-engine — stop after the first match:
  const engine = new Engine(rules)
  engine.on('success', () => engine.stop())
  const { events } = await engine.run(facts)
  // → events = [{ type: 'vip' }], NO throw: the priority-10 rule matches and stops
  //   the engine, so the priority-1 rule (referencing the absent `missing`) never runs.

  // fast-json-rules-engine — the global pre-check runs before any rule:
  compile(rules).run(facts, { stopOnFirstEvent: true })
  // → throws UndefinedFactError ("missing"), even though the matching rule doesn't
  //   reference it and stopOnFirstEvent would have stopped before the other rule.
  ```

  This is intentional: a missing fact is almost always a config bug, so failing
  loud regardless of evaluation order catches it early. Set
  `allowUndefinedFacts: true` to treat an absent fact as `undefined` (no throw).
- **Returned events are normalized** to `{ type, params? }` (falsy `params` and
  any non-`type`/`params` keys dropped) exactly like json-rules-engine's
  `setEvent`. But unlike json-rules-engine — which deep-clones the event on every
  run — this engine returns **the same event object on every run**, with its
  `params` *aliasing the source rule* (no per-run clone). So mutating a returned
  event corrupts the source rule **and every later run**; treat them as read-only:

  ```js
  // json-rules-engine — deep-cloned per run; each result is an independent snapshot
  const engine = new Engine(rules)
  ;(await engine.run(facts)).events[0].params.tag = 'X'
  ;(await engine.run(facts)).events[0].params.tag // → undefined (unaffected)

  // fast-json-rules-engine — same object reused; params aliases the rule
  const engine = compile(rules)
  engine.run(facts).events[0].params.tag = 'X'
  engine.run(facts).events[0].params.tag // → 'X' (corrupted — same object; source rule mutated too)
  ```

  If you need to modify a returned event, copy it first (as the resolver above does).
- **`name` on a rule or condition is accepted but inert** — it has no observable
  effect, since per-rule `results` aren't returned. json-rules-engine surfaces it in
  its result objects.
- **Facts are read with own-property semantics** (`hasOwnProperty`). A fact whose
  name matches only an *inherited enumerable* property of the facts object (e.g. one
  built via `Object.create` with enumerable prototype members) reads as **absent**
  here, whereas json-rules-engine ingests facts with `for…in` and would see it.
  Irrelevant for ordinary `{ … }` / `JSON.parse` facts.

Operator semantics themselves match json-rules-engine 6.6.0 exactly (verified by
differential fuzzing), including subtle ones: `numberValidator` (so `null >= 0`
is `false`), `in`/`notIn` using `indexOf` (so `NaN` is never "in"), and the
non-null-object guard on `path`.

## Example mapping

json-rules-engine's `examples/` mapped to this library:

| json-rules-engine example | Here |
| --- | --- |
| `01-hello-world` | [`examples/01-basics.mjs`](../examples/01-basics.mjs) |
| `02-nested-boolean-logic` | [`examples/03-boolean-composition.mjs`](../examples/03-boolean-composition.mjs) |
| `06-custom-operators` | [`examples/06-named-and-custom.mjs`](../examples/06-named-and-custom.mjs) |
| `08-fact-comparison` | [`examples/06-named-and-custom.mjs`](../examples/06-named-and-custom.mjs) (value fact ref) |
| `09-rule-results` | ❌ not supported — `run()` returns only `events`, not per-rule results |
| `10-condition-sharing` | [`examples/06-named-and-custom.mjs`](../examples/06-named-and-custom.mjs) (named conditions) |
| `13-using-operator-decorators` | [`examples/05-decorators.mjs`](../examples/05-decorators.mjs) |
| `03-dynamic-facts` | ❌ not supported (compute facts up front) |
| `04-fact-dependency` | ❌ not supported (compute facts up front) |
| `05-optimizing-runtime-with-fact-priorities` | ⚠️ sub-condition priorities compile but are ignored (no async/expensive facts to reorder around) |
| `07-rule-chaining` | ❌ orchestrate via returned `events` |
| `11-using-facts-in-events` | ❌ fill event params after reading `events` |
| `12-using-custom-almanac` | ❌ no almanac concept |

## Not sure a rule behaves the same?

Run the same rules and facts through both engines and compare `events`. That's
exactly how this library is tested — a differential fuzzer checks output against
json-rules-engine 6.6.0 across thousands of generated cases per run (tens of
thousands in CI).
