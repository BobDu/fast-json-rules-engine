---
layout: home
description: Compiled, synchronous, zero-dependency rules engine compatible with the json-rules-engine rule format — compile once, no Promise overhead per run.

hero:
  name: fast-json-rules-engine
  text: Same rules JSON, compiled once
  tagline: A compiled, synchronous, zero-dependency engine for the json-rules-engine rule format — no promises, no clones.
  actions:
    - theme: brand
      text: Usage guide
      link: /USAGE
    - theme: alt
      text: Migrate from json-rules-engine
      link: /MIGRATING
    - theme: alt
      text: GitHub
      link: https://github.com/BobDu/fast-json-rules-engine

features:
  - icon: ⚡
    title: Compiled, not interpreted
    details: compile(rules) once into plain predicate functions; engine.run(facts) is synchronous — no Promise or clone overhead per evaluation.
  - icon: 🔁
    title: Speaks json-rules-engine
    details: Same rule JSON, same events output. Verified by differential fuzzing against json-rules-engine 6.6.0, whose rule-evaluation core is unchanged through current 7.x.
  - icon: 📦
    title: Zero dependencies, Node 14+
    details: CJS + ESM with bundled types in a ~18 kB unpacked dist. Runs on stacks that can't adopt json-rules-engine 7's Node 18 / ESM-only requirements.
  - icon: 📊
    title: Honest benchmarks
    details: ~190× faster when you compile once and reuse; ~13× compiling fresh per call. Synthetic 30-rule set — the bench script ships in the repo, point it at your own rules.
---

## Quick start

```sh
npm install fast-json-rules-engine
```

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
]

// Compile once (e.g. when your config loads), reuse for every request.
const engine = compile(rules)

const { events } = engine.run({ country: 'US', spend: 250 })
// events -> [{ type: 'whale', params: { tier: 'gold' } }]
```

`engine.run(facts)` returns synchronously — no `await`, no `.then()`. Rules are
near-static and facts change every call, so the pattern is always **compile
once, run many**.

## What it trades away

The speed comes from dropping json-rules-engine's runtime dynamism: async
facts, event handlers, the evaluated conditions tree, and mutating rules on a
live engine are **deliberately not supported** — recompile instead of patching
a running engine. If your facts are plain values and you evaluate the same
rules over and over, that trade is usually free. See the
[migration guide](/MIGRATING) for the full compatibility matrix.
