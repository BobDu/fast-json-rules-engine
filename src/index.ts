/**
 * fast-json-rules-engine
 *
 * Compiled, synchronous, zero-dependency evaluator for the json-rules-engine
 * rule format. Compile a rule set once, then evaluate many facts objects with
 * no per-run promises, clones, or event machinery.
 *
 *   import { compile } from 'fast-json-rules-engine'
 *   const evaluate = compile(rules)
 *   const { events } = evaluate(facts)
 *   const groupId = events[0]?.params?.groupId  // highest-priority match
 *
 * Independent project; not affiliated with json-rules-engine.
 */
export { compile } from './compile'
export { CompileError, UndefinedFactError } from './errors'
export { KNOWN_OPERATORS, KNOWN_DECORATORS } from './operators'
export type {
  AllCondition,
  AnyCondition,
  CompiledRules,
  CompileOptions,
  Condition,
  ConditionReference,
  EngineResult,
  Event,
  Facts,
  LeafCondition,
  NotCondition,
  OperatorFn,
  PathResolver,
  RuleDefinition,
  RuleResult,
  TopLevelCondition,
  ValueReference,
} from './types'
