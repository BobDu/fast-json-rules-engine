import { test, expectTypeOf } from 'vitest'
import { compile } from '../src/index'
import type {
  CompiledRules,
  CompileOptions,
  EngineResult,
  Event,
  Facts,
  Rule,
  RuleResult,
} from '../src/index'

// Type-level contract over the public .d.ts surface. These are checked by
// `tsc -p tsconfig.test.json` (the typecheck script); at runtime they are no-ops.

test('public type surface', () => {
  // compile accepts a single rule or an array, and returns a compiled engine
  // whose synchronous `run(facts)` produces the result.
  expectTypeOf(compile).parameter(0).toEqualTypeOf<Rule | Rule[]>()
  expectTypeOf(compile).parameter(1).toEqualTypeOf<CompileOptions | undefined>()
  expectTypeOf(compile).returns.toEqualTypeOf<CompiledRules>()
  expectTypeOf<CompiledRules['run']>().toEqualTypeOf<(facts: Facts) => EngineResult>()

  // EngineResult exposes the four output surfaces
  expectTypeOf<EngineResult['events']>().toEqualTypeOf<Event[]>()
  expectTypeOf<EngineResult['failureEvents']>().toEqualTypeOf<Event[]>()
  expectTypeOf<EngineResult['results']>().toEqualTypeOf<RuleResult[]>()
  expectTypeOf<EngineResult['failureResults']>().toEqualTypeOf<RuleResult[]>()

  // Event is generic; params defaults to Record<string, unknown> and is optional
  expectTypeOf<Event['params']>().toEqualTypeOf<Record<string, unknown> | undefined>()
  expectTypeOf<Event<{ tier: string }>['params']>().toEqualTypeOf<{ tier: string } | undefined>()

  // Regression guard: an interface-typed facts object (no implicit index
  // signature) is accepted at the call site — Facts must stay `Record<string, any>`.
  interface MyFacts {
    country: string
    spend: number
  }
  const engine = compile([{ conditions: { all: [] }, event: { type: 't' } }])
  const myFacts: MyFacts = { country: 'US', spend: 10 }
  expectTypeOf(engine.run(myFacts)).toEqualTypeOf<EngineResult>()

  expectTypeOf<CompileOptions['allowUndefinedFacts']>().toEqualTypeOf<boolean | undefined>()
  expectTypeOf<CompileOptions['allowUndefinedConditions']>().toEqualTypeOf<boolean | undefined>()
})
