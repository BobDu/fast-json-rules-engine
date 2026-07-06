# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-05

### Added

- Core `compile(rules, options)` API returning a synchronous evaluator.
- Full json-rules-engine rule-format support: 10 operators, 6 operator
  decorators, nested `all`/`any`/`not`, `priority`, value-as-fact references,
  named conditions, and custom operators. `path` support is via an injected
  `pathResolver` — no JSONPath engine is bundled; inject jsonpath-plus, or a rule
  using `path` throws `CompileError` at compile time.
- Returned events are normalized to json-rules-engine's `{ type, params? }` shape
  (falsy `params` and non-`type`/`params` keys dropped) as fresh engine-owned
  objects reused across evaluations; `params` aliases the source rule, so treat
  returned events as read-only.
- `stopOnFirstEvent` option for first-match evaluation.
- `allowUndefinedConditions` option: an unknown named condition compiles to `false`
  instead of throwing (matches json-rules-engine).
- `RuleResult.ruleIndex` (the rule's position in the input array) for tracing which
  rule produced a result — an extension over json-rules-engine.
- Differential fuzzing suite checking output against json-rules-engine 6.6.0.
- Benchmark (`npm run bench`).

_Pre-1.0: the API may change before the 1.0 release._

[0.1.0]: https://github.com/BobDu/fast-json-rules-engine/releases/tag/v0.1.0
