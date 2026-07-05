# Examples

Runnable scripts — each is real, copy-pasteable code (rules + facts + calls),
with expected output in comments. Build once, then run any file:

```sh
npm install && npm run build
node examples/01-basics.mjs
```

| File | Shows |
| --- | --- |
| `01-basics.mjs` | compile once / evaluate many / the return shape |
| `02-operators.mjs` | the ten built-in operators |
| `03-boolean-composition.mjs` | `all` / `any` / `not`, nested |
| `04-priority-and-stop.mjs` | `priority` ordering + `stopOnFirstEvent` |
| `05-decorators.mjs` | operator decorators (array quantifiers, `not`/`swap`, chaining) |
| `06-named-and-custom.mjs` | value-as-fact refs, named conditions, custom operators |
| `07-path.mjs` | `path` via an injected resolver (needs the `jsonpath-plus` dev dependency) |
| `08-user-segmentation.mjs` | end-to-end: pick a user's segment from a tiered rule set |
| `09-errors-and-undefined-facts.mjs` | fail-loud errors (`code`/`factId`/`ruleIndex`) + `allowUndefinedFacts` |

The examples import the package by name (`fast-json-rules-engine`) via Node's
self-referencing, so the code reads exactly like an app consuming the published
package. See [../docs/USAGE.md](../docs/USAGE.md) for the prose walkthrough.
