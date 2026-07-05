# Migrating from json-rules-engine

fast-json-rules-engine is a **drop-in replacement for the rule format and the
`events` output**, not a reimplementation of json-rules-engine's runtime
dynamics. In practice:

- Your **rule JSON is unchanged** and produces the **same `events`**.
- Swap `new Engine() + addRule() + await run()` for `compile() + evaluate()`
  (synchronous).
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

const evaluate = compile(rules, {
  allowUndefinedFacts: true,
  operators: { startsWith: (a, b) => a.startsWith(b) },
  conditions: { isWhale: cond },
})
const { events } = evaluate(facts) // synchronous — no await
for (const event of events) handle(event) // read events instead of on('success')
```

The result shape matches (`{ events, failureEvents, results, failureResults }`),
`events` are ordered highest-priority first, and `event` objects are identical —
so most call sites only change from `await engine.run(facts)` to
`evaluate(facts)`.

## ✅ Works unchanged

Existing rule documents compile as-is. All of these behave identically:

- All 10 operators (`equal`, `notEqual`, `in`, `notIn`, `contains`,
  `doesNotContain`, `lessThan(Inclusive)`, `greaterThan(Inclusive)`).
- All 6 operator decorators (`someFact`, `someValue`, `everyFact`, `everyValue`,
  `swap`, `not`), including chains like `not:everyFact:greaterThan`.
- Nested `all` / `any` / `not` (any depth); empty `all`/`any` both evaluate to
  `true`, as in json-rules-engine.
- Rule `priority` (events come back highest-priority first).
- `value` as a fact reference: `value: { fact: 'other' }`.
- Named conditions via `{ condition: 'name' }` (pass them in `options.conditions`).
- Custom operators (pass them in `options.operators`).
- `allowUndefinedFacts` (both modes).

## ⚙️ One-line changes

| json-rules-engine | fast-json-rules-engine |
| --- | --- |
| `await engine.run(facts)` | `evaluate(facts)` (synchronous) |
| `engine.on('success', cb)` / `on('failure', cb)` | iterate the returned `events` / `failureEvents` |
| `engine.addOperator(name, cb)` | `compile(rules, { operators: { name: cb } })` |
| `engine.setCondition(name, cond)` | `compile(rules, { conditions: { name: cond } })` |
| built-in `path` (jsonpath-plus) | inject it (see below) |

**`path` needs an injected resolver.** The core ships zero runtime dependencies,
so JSONPath is opt-in — pass jsonpath-plus (use `jsonpath-plus@^10.4.0`; older
releases carry a JSONPath RCE advisory) for the same behavior:

```js
import { JSONPath } from 'jsonpath-plus'

const evaluate = compile(rules, {
  pathResolver: (value, path) => JSONPath({ path, json: value, wrap: false }),
})
```

A rule using `path` without a `pathResolver` throws `CompileError` at compile
time — it never silently ignores the path.

## ❌ Not supported (and what to do instead)

These are json-rules-engine's runtime-dynamic features. Replicating them would
reintroduce the per-run cost this library exists to avoid, so they're out of
scope. Most have a simple workaround given static facts.

| Feature | Instead |
| --- | --- |
| **Async / computed facts** (`engine.addFact(id, async fn)`) | Compute the value before evaluating and put it on the `facts` object. Facts are plain static values. |
| **Fact dependency** (a fact derived from other facts) | Same — derive it up front and pass it in. |
| **Sub-condition / fact priorities** (a `priority` on a nested condition) | Not supported; rejected at compile time. Rule-level `priority` is supported. |
| **Rule chaining via events/almanac** | Read the returned `events`, build the next `facts`, and call `evaluate` again — you orchestrate the chain explicitly. |
| **Facts in event params** (`replaceFactsInEventParams`) | Passing this option throws `CompileError` (no runtime almanac to resolve it). `event.params` is otherwise returned as authored — fill dynamic values yourself after reading `events`. |
| **Event handlers** (`engine.on(...)`) | Read `events` / `failureEvents` from the result. |
| **Custom almanac** | No almanac concept; there's nothing to customize. |
| **Runtime rule mutation** (`addRule` after a run) | Rules are compiled up front; recompile to change them. |
| **The evaluated-conditions tree in `results`** | `results` carry `{ result, event, priority, name }` — not the per-condition tree json-rules-engine deep-clones each run (that clone is the main cost avoided here). |

## Behavioral edge cases

Even where rules are identical, a few malformed-input behaviors differ on
purpose (fail loud rather than guess):

- **Falsy `event`** (`null`/`false`/`0`/`''`) throws `CompileError` instead of
  defaulting to `{ type: 'unknown' }`.
- **`priority`** is parsed like json-rules-engine (`|| 1`, then `parseInt`), but a
  result `<= 0` throws instead of being stored.
- **Missing `value` on a leaf, or missing `event.type`** throws `CompileError`
  (json-rules-engine also rejects these).
- The **emitted event is your original event object** — json-rules-engine strips
  a falsy `params`; here it's returned as authored.

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
| `09-rule-results` | [`examples/01-basics.mjs`](../examples/01-basics.mjs) (return shape) |
| `10-condition-sharing` | [`examples/06-named-and-custom.mjs`](../examples/06-named-and-custom.mjs) (named conditions) |
| `13-using-operator-decorators` | [`examples/05-decorators.mjs`](../examples/05-decorators.mjs) |
| `03-dynamic-facts` | ❌ not supported (compute facts up front) |
| `04-fact-dependency` | ❌ not supported (compute facts up front) |
| `05-optimizing-runtime-with-fact-priorities` | ❌ sub-condition priorities not supported |
| `07-rule-chaining` | ❌ orchestrate via returned `events` |
| `11-using-facts-in-events` | ❌ fill event params after reading `events` |
| `12-using-custom-almanac` | ❌ no almanac concept |

## Not sure a rule behaves the same?

Run the same rules and facts through both engines and compare `events`. That's
exactly how this library is tested — a differential fuzzer checks output against
json-rules-engine 6.6.0 across tens of thousands of generated cases per run.
