// Benchmark: fast-json-rules-engine vs json-rules-engine on a realistic,
// fully-synthetic rule set (user tiering). Reports median µs per evaluation.
//
//   npm run build && node bench/bench.mjs
//
// The rule set mimics the shape common in production segmentation configs:
// ~30 rules, each a flat `all` of 2-4 comparisons, distinct priorities. Facts
// are a pool of ~20-field objects (same shape, varied values) so the compiled
// closures' property reads stay polymorphic — closer to real traffic than
// hammering one object, which V8 can fully monomorphize.
//
// json-rules-engine appears three ways: a fresh engine per eval, a reused engine
// running to completion, and a reused engine doing first-match via engine.stop()
// on the first success — the last is the FAIR baseline for stopOnFirstEvent.
import { performance } from 'node:perf_hooks'
import { compile } from '../dist/index.mjs'
import pkg from 'json-rules-engine'
const { Engine } = pkg

const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'JP', 'KR', 'BR', 'IN', 'MX', 'ID']
const OPS = ['equal', 'greaterThan', 'greaterThanInclusive', 'lessThan', 'lessThanInclusive']

// Deterministic PRNG so the rule set is stable across runs.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(42)
const pick = (arr) => arr[Math.floor(rng() * arr.length)]

const RULE_COUNT = 30
function buildRules() {
  const rules = []
  const priorities = Array.from({ length: RULE_COUNT }, (_, i) => i + 1).sort(() => rng() - 0.5)
  for (let i = 0; i < RULE_COUNT; i++) {
    const nConds = 2 + Math.floor(rng() * 3)
    const all = []
    for (let c = 0; c < nConds; c++) {
      const which = rng()
      if (which < 0.4) all.push({ fact: 'spend', operator: pick(OPS), value: Math.floor(rng() * 500) })
      else if (which < 0.7) all.push({ fact: 'level', operator: pick(OPS), value: Math.floor(rng() * 100) })
      else if (which < 0.85) all.push({ fact: 'country', operator: rng() < 0.5 ? 'in' : 'notIn', value: [pick(COUNTRIES), pick(COUNTRIES)] })
      else all.push({ fact: 'daysActive', operator: pick(OPS), value: Math.floor(rng() * 60) })
    }
    rules.push({ conditions: { all }, event: { type: `tier${i}`, params: { groupId: `${1000 + i}` } }, priority: priorities[i] })
  }
  return rules
}

const rules = buildRules()

// Pool of facts objects (same shape, varied values) for polymorphic reads.
function makeFacts(seed) {
  const r = mulberry32(seed)
  return {
    spend: Math.floor(r() * 500), level: Math.floor(r() * 100),
    country: COUNTRIES[Math.floor(r() * COUNTRIES.length)], daysActive: Math.floor(r() * 60),
    platform: 'android', sessions: Math.floor(r() * 300), iap: 3, region: 'latam',
    vip: r() < 0.5, cohort: 'c12', lang: 'pt', tz: 'America/Sao_Paulo', build: 362,
    retDay: 30, adRev: 12, churn: 0.2, ltv: 88, refCount: 2, notif: true, ab: 'B',
  }
}
const FACTS_POOL = Array.from({ length: 16 }, (_, i) => makeFacts(100 + i))
const F = (i) => FACTS_POOL[i & 15]

async function median(label, iters, runOnce, isAsync) {
  const samples = []
  for (let i = 0; i < Math.min(iters, 2000); i++) isAsync ? await runOnce(i) : runOnce(i)
  for (let r = 0; r < 7; r++) {
    const t0 = performance.now()
    if (isAsync) for (let i = 0; i < iters; i++) await runOnce(i)
    else for (let i = 0; i < iters; i++) runOnce(i)
    samples.push(((performance.now() - t0) * 1000) / iters)
  }
  samples.sort((a, b) => a - b)
  return { label, us: samples[3] }
}

function makeReusedEngine() {
  const engine = new Engine([], { allowUndefinedFacts: false })
  for (const r of rules) engine.addRule(JSON.parse(JSON.stringify(r)))
  return engine
}

async function main() {
  const evaluate = compile(rules)
  const evaluateStop = compile(rules, { stopOnFirstEvent: true })
  const reused = makeReusedEngine()
  const reusedStop = makeReusedEngine()
  reusedStop.on('success', () => reusedStop.stop())

  // Sanity: full-run events match json-rules-engine on every facts object, and
  // first-match modes (ours vs engine.stop()) agree — so the comparison is fair.
  for (const f of FACTS_POOL) {
    const mine = evaluate.run(f).events.map((e) => e.params.groupId)
    const theirs = (await reused.run(f)).events.map((e) => e.params.groupId)
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) { console.error('MISMATCH', mine, theirs); process.exit(1) }
  }
  const myStop = evaluateStop.run(FACTS_POOL[0]).events.map((e) => e.params.groupId)
  const theirStop = (await reusedStop.run(FACTS_POOL[0])).events.map((e) => e.params.groupId)
  if (JSON.stringify(myStop) !== JSON.stringify(theirStop)) { console.error('STOP MISMATCH', myStop, theirStop); process.exit(1) }
  const sampleMatches = evaluate.run(FACTS_POOL[0]).events.length

  const results = []
  results.push(await median('json-rules-engine: new Engine + addRule + run (per eval)', 3000, async (i) => {
    const e = makeReusedEngine(); await e.run(F(i))
  }, true))
  results.push(await median('json-rules-engine: reused engine, full run', 5000, async (i) => {
    await reused.run(F(i))
  }, true))
  results.push(await median('json-rules-engine: reused engine, first-match via engine.stop()', 5000, async (i) => {
    await reusedStop.run(F(i))
  }, true))
  results.push(await median('fast-json-rules-engine: compile-per-eval', 20000, (i) => {
    compile(rules).run(F(i))
  }, false))
  results.push(await median('fast-json-rules-engine: compiled once, run', 200000, (i) => {
    evaluate.run(F(i))
  }, false))
  results.push(await median('fast-json-rules-engine: compiled once, stopOnFirstEvent', 200000, (i) => {
    evaluateStop.run(F(i))
  }, false))

  const base = results[1].us // reused full-run json-rules-engine as the 1x baseline
  console.log(`\nRule set: ${RULE_COUNT} rules, flat all[] of 2-4 comparisons, distinct priorities`)
  console.log(`Facts: pool of ${FACTS_POOL.length} objects; the sample matches ${sampleMatches} of ${RULE_COUNT} rules`)
  console.log(`Node ${process.version}\n`)
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length))
  console.log(pad('variant', 62), pad('µs/eval', 12), 'vs full run')
  console.log('-'.repeat(90))
  for (const r of results) console.log(pad(r.label, 62), pad(r.us.toFixed(3), 12), `${(base / r.us).toFixed(1)}x`)
}

main()
