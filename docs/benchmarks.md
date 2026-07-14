---
description: Benchmark numbers for fast-json-rules-engine vs json-rules-engine, with the exact setup, caveats, and how to reproduce them on your own rules.
---

# Benchmarks

30 rules, each a flat `all` of 2–4 comparisons with distinct priorities,
evaluated against a pool of facts objects (the sample matches 7 of 30 rules) —
the shape of a typical segmentation/tiering config. All facts are plain
synchronous values. Node 24.

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

## Why the gap exists

json-rules-engine's per-run cost — a deep clone of every rule's condition tree
plus a fully promise-based evaluation — is the price of its runtime dynamism
(async facts, event handlers, result-tree introspection). Those features are
exactly what this library drops: rules compile once into plain synchronous
predicate functions, so a run is just function calls over your facts object.

## Caveats

- Numbers vary by machine and by rule/fact shape. Treat them as an order of
  magnitude, not a constant.
- The ~190× headline applies to the **compile-once-reuse** pattern. If you
  compile fresh on every call, expect ~13×.
- The workload is synthetic. The honest way to evaluate is to run the bench
  against your own rule set.

## Reproduce it

```sh
git clone https://github.com/BobDu/fast-json-rules-engine
cd fast-json-rules-engine
npm ci
npm run bench
```

The script is
[`bench/bench.mjs`](https://github.com/BobDu/fast-json-rules-engine/blob/main/bench/bench.mjs)
— swap in your own rules and facts to measure the shape you actually run in
production.
