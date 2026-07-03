# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Core `compile(rules, options)` API returning a synchronous evaluator.
- Full json-rules-engine rule-format support: 10 operators, 6 operator
  decorators, nested `all`/`any`/`not`, `priority`, value-as-fact references,
  named conditions, custom operators, and a minimal built-in `path` resolver
  (with a `pathResolver` hook for full JSONPath).
- `stopOnFirstEvent` option for first-match evaluation.
- Differential fuzzing suite checking output against json-rules-engine 6.6.0.
- Benchmark (`npm run bench`).

_Pre-1.0: the API may change before the 1.0 release._
