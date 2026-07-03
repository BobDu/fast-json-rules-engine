'use strict'
// Differential fuzzer: generate random rule sets + facts, evaluate with both
// engines, assert identical output. This is the credibility anchor — it turns
// "looks equivalent" into a continuously-checked guarantee. Seeds are fixed for
// CI reproducibility; a failing case prints its seed and inputs.
//
// Suites exercise, differentially against json-rules-engine 6.6.0:
//   - core: operators, decorators, nested all/any/not, value-refs, paths,
//     allowUndefinedFacts (both modes)
//   - stopOnFirstEvent: our option vs json-rules-engine on('success')->stop()
//   - named conditions: { condition: name } vs engine.setCondition
//   - custom operators: options.operators vs engine.addOperator
const { test } = require('./harness')
const { expectMatch } = require('./diff')

// --- deterministic PRNG (mulberry32) ---------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FACT_NAMES = ['a', 'b', 'c', 'arr', 'nested']
const SCALAR_OPERATORS = ['equal', 'notEqual', 'greaterThan', 'greaterThanInclusive', 'lessThan', 'lessThanInclusive']
const NUMBERS = [0, 1, -1, 5, 10, 100, 3.5, -2.5]
const STRINGS = ['US', 'GB', 'BR', 'x', '']
const SCALARS = [...NUMBERS, ...STRINGS, true, false]

// Custom operators — identical functions handed to both engines.
const CUSTOM_OPERATORS = {
  startsWith: (a, b) => typeof a === 'string' && typeof b === 'string' && a.indexOf(b) === 0,
  divisibleBy: (a, b) => Number.isInteger(a) && Number.isInteger(b) && b !== 0 && a % b === 0,
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}
function randomScalar(rng) {
  return pick(rng, SCALARS)
}
function randomArray(rng) {
  const n = 1 + Math.floor(rng() * 4)
  const useNums = rng() < 0.5
  const out = []
  for (let i = 0; i < n; i++) out.push(useNums ? pick(rng, NUMBERS) : pick(rng, STRINGS))
  return out
}
function randomFactValue(rng) {
  const r = rng()
  if (r < 0.4) return pick(rng, NUMBERS)
  if (r < 0.65) return pick(rng, STRINGS)
  if (r < 0.78) return rng() < 0.5
  if (r < 0.9) return randomArray(rng)
  if (r < 0.96) return { profile: { level: pick(rng, NUMBERS) } }
  return null
}

function randomLeaf(rng, feats) {
  // Optionally emit a reference to a named condition.
  if (feats.conditions && feats.conditions.length && rng() < 0.25) {
    return { condition: pick(rng, feats.conditions) }
  }
  const fact = pick(rng, FACT_NAMES)
  const r = rng()
  let leaf
  if (feats.customOps && r < 0.12) {
    const op = pick(rng, ['startsWith', 'divisibleBy'])
    leaf = { fact, operator: op, value: op === 'startsWith' ? pick(rng, STRINGS) : pick(rng, [1, 2, 5, 10]) }
  } else if (r < 0.5) {
    leaf = { fact, operator: pick(rng, SCALAR_OPERATORS), value: randomScalar(rng) }
  } else if (r < 0.68) {
    leaf = { fact, operator: rng() < 0.5 ? 'in' : 'notIn', value: randomArray(rng) }
  } else if (r < 0.8) {
    leaf = { fact, operator: rng() < 0.5 ? 'contains' : 'doesNotContain', value: randomScalar(rng) }
  } else if (r < 0.9) {
    const dec = pick(rng, ['everyFact', 'someFact'])
    leaf = { fact, operator: `${dec}:${pick(rng, SCALAR_OPERATORS)}`, value: pick(rng, NUMBERS) }
  } else if (r < 0.96) {
    const dec = pick(rng, ['everyValue', 'someValue'])
    leaf = { fact, operator: `${dec}:equal`, value: randomArray(rng) }
  } else {
    leaf = { fact, operator: pick(rng, SCALAR_OPERATORS), value: { fact: pick(rng, FACT_NAMES) } }
  }
  if (rng() < 0.12) {
    leaf.fact = 'nested'
    leaf.path = '$.profile.level'
  }
  return leaf
}

function randomCondition(rng, depth, feats) {
  if (depth <= 0 || rng() < 0.5) return randomLeaf(rng, feats)
  return randomBooleanCondition(rng, depth, feats)
}

// json-rules-engine requires the root of a rule's/named condition to be a
// boolean (all/any/not), never a bare leaf.
function randomBooleanCondition(rng, depth, feats) {
  const r = rng()
  if (r < 0.45) {
    const n = 1 + Math.floor(rng() * 3)
    return { all: Array.from({ length: n }, () => randomCondition(rng, depth - 1, feats)) }
  }
  if (r < 0.9) {
    const n = 1 + Math.floor(rng() * 3)
    return { any: Array.from({ length: n }, () => randomCondition(rng, depth - 1, feats)) }
  }
  return { not: randomCondition(rng, depth - 1, feats) }
}

function distinctPriorities(rng, n) {
  const pool = Array.from({ length: n * 3 }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n)
}

function randomRuleSet(rng, feats) {
  const n = 2 + Math.floor(rng() * 6)
  const priorities = distinctPriorities(rng, n)
  return Array.from({ length: n }, (_, i) => ({
    conditions: randomBooleanCondition(rng, 3, feats),
    event: { type: `e${i}`, params: { groupId: `${1000 + i}` } },
    priority: priorities[i],
  }))
}

function randomFacts(rng) {
  const facts = {}
  for (const name of FACT_NAMES) {
    if (rng() < 0.2) continue
    facts[name] = name === 'arr' ? randomArray(rng) : randomFactValue(rng)
  }
  return facts
}

// A pool of boolean-rooted named conditions referencing only base facts.
function buildNamedConditions(rng) {
  const conditions = {}
  const names = []
  const count = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < count; i++) {
    const name = `cond_${i}`
    names.push(name)
    conditions[name] = randomBooleanCondition(rng, 2, { conditions: [], customOps: false })
  }
  return { conditions, names }
}

function makeFuzzTest(label, baseSeed, iterations, mode) {
  test(`fuzz[${label}]: ${iterations} iters, seed ${baseSeed}`, async () => {
    for (let i = 0; i < iterations; i++) {
      const seed = baseSeed + i
      const rng = mulberry32(seed)

      const options = { allowUndefinedFacts: rng() < 0.5 }
      const feats = { conditions: [], customOps: false }

      if (mode === 'stop') options.stopOnFirstEvent = true
      if (mode === 'customOps') {
        options.operators = CUSTOM_OPERATORS
        feats.customOps = true
      }
      if (mode === 'named') {
        const pool = buildNamedConditions(rng)
        options.conditions = pool.conditions
        feats.conditions = pool.names
      }

      const rules = randomRuleSet(rng, feats)
      const facts = randomFacts(rng)
      try {
        await expectMatch(rules, facts, options)
      } catch (err) {
        err.message = `[seed ${seed}] ${err.message}`
        throw err
      }
    }
  })
}

const N = Number(process.env.FJRE_FUZZ_N || 3000)
const S = Number(process.env.FJRE_FUZZ_SEED || 1)
makeFuzzTest('core', S, N, 'core')
makeFuzzTest('stopOnFirstEvent', S + 1000000, N, 'stop')
makeFuzzTest('namedConditions', S + 2000000, N, 'named')
makeFuzzTest('customOperators', S + 3000000, N, 'customOps')
