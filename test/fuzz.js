'use strict'
// Differential fuzzer: generate random rule sets + facts, evaluate with both
// engines, assert identical output. This is the credibility anchor — it turns
// "looks equivalent" into a continuously-checked guarantee. Seeds are fixed for
// CI reproducibility; a failing case prints its seed and inputs.
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

function randomLeaf(rng) {
  const fact = pick(rng, FACT_NAMES)
  const r = rng()
  let leaf
  if (r < 0.5) {
    leaf = { fact, operator: pick(rng, SCALAR_OPERATORS), value: randomScalar(rng) }
  } else if (r < 0.68) {
    leaf = { fact, operator: rng() < 0.5 ? 'in' : 'notIn', value: randomArray(rng) }
  } else if (r < 0.8) {
    leaf = { fact, operator: rng() < 0.5 ? 'contains' : 'doesNotContain', value: randomScalar(rng) }
  } else if (r < 0.9) {
    // decorators
    const dec = pick(rng, ['everyFact', 'someFact'])
    leaf = { fact, operator: `${dec}:${pick(rng, SCALAR_OPERATORS)}`, value: pick(rng, NUMBERS) }
  } else if (r < 0.96) {
    const dec = pick(rng, ['everyValue', 'someValue'])
    leaf = { fact, operator: `${dec}:equal`, value: randomArray(rng) }
  } else {
    // value referencing another fact
    leaf = { fact, operator: pick(rng, SCALAR_OPERATORS), value: { fact: pick(rng, FACT_NAMES) } }
  }
  // occasionally read via a simple path into a nested fact
  if (rng() < 0.12) {
    leaf.fact = 'nested'
    leaf.path = '$.profile.level'
  }
  return leaf
}

function randomCondition(rng, depth) {
  if (depth <= 0 || rng() < 0.5) return randomLeaf(rng)
  return randomBooleanCondition(rng, depth)
}

// json-rules-engine requires the root of a rule's conditions to be a boolean
// (all/any/not), never a bare leaf — so the root always uses this.
function randomBooleanCondition(rng, depth) {
  const r = rng()
  if (r < 0.45) {
    const n = 1 + Math.floor(rng() * 3)
    return { all: Array.from({ length: n }, () => randomCondition(rng, depth - 1)) }
  }
  if (r < 0.9) {
    const n = 1 + Math.floor(rng() * 3)
    return { any: Array.from({ length: n }, () => randomCondition(rng, depth - 1)) }
  }
  return { not: randomCondition(rng, depth - 1) }
}

// distinct priorities → deterministic event order, so we compare exactly
function distinctPriorities(rng, n) {
  const pool = Array.from({ length: n * 3 }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n)
}

function randomRuleSet(rng) {
  const n = 2 + Math.floor(rng() * 6)
  const priorities = distinctPriorities(rng, n)
  return Array.from({ length: n }, (_, i) => ({
    conditions: randomBooleanCondition(rng, 3),
    event: { type: `e${i}`, params: { groupId: `${1000 + i}` } },
    priority: priorities[i],
  }))
}

function randomFacts(rng) {
  const facts = {}
  for (const name of FACT_NAMES) {
    // sometimes omit a fact entirely (exercises undefined-fact behavior)
    if (rng() < 0.2) continue
    facts[name] = name === 'arr' ? randomArray(rng) : randomFactValue(rng)
  }
  return facts
}

function makeFuzzTest(label, baseSeed, iterations) {
  test(`fuzz: ${label} (${iterations} iters, seed ${baseSeed})`, async () => {
    for (let i = 0; i < iterations; i++) {
      const seed = baseSeed + i
      const rng = mulberry32(seed)
      const rules = randomRuleSet(rng)
      const facts = randomFacts(rng)
      const allowUndefinedFacts = rng() < 0.5
      try {
        await expectMatch(rules, facts, { allowUndefinedFacts })
      } catch (err) {
        err.message = `[seed ${seed}] ${err.message}`
        throw err
      }
    }
  })
}

const N = Number(process.env.FJRE_FUZZ_N || 3000)
makeFuzzTest('allowUndefinedFacts mixed', Number(process.env.FJRE_FUZZ_SEED || 1), N)
