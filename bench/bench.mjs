// Benchmark: fast-json-rules-engine vs json-rules-engine on a realistic,
// fully-synthetic rule set (user tiering). Reports median µs per evaluation.
//
//   npm run build && node bench/bench.mjs
//
// The rule set mimics the shape common in production segmentation configs:
// ~30 rules, each a flat `all` of 2-4 comparisons, distinct priorities, first
// (highest-priority) match wins. Facts are a ~20-field static object.
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
const facts = {
  spend: 240, level: 55, country: 'BR', daysActive: 33, platform: 'android',
  sessions: 140, iap: 3, region: 'latam', vip: false, cohort: 'c12',
  lang: 'pt', tz: 'America/Sao_Paulo', build: 362, retDay: 30, adRev: 12,
  churn: 0.2, ltv: 88, refCount: 2, notif: true, ab: 'B',
}

async function median(label, iters, runOnce, isAsync) {
  const samples = []
  // warmup
  for (let i = 0; i < Math.min(iters, 2000); i++) isAsync ? await runOnce() : runOnce()
  for (let r = 0; r < 7; r++) {
    const t0 = performance.now()
    if (isAsync) for (let i = 0; i < iters; i++) await runOnce()
    else for (let i = 0; i < iters; i++) runOnce()
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

  // Sanity: compiled events (priority order) match json-rules-engine.
  const mine = evaluate(facts).events.map((e) => e.params.groupId)
  const theirs = (await reused.run(facts)).events.map((e) => e.params.groupId)
  if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
    console.error('MISMATCH', mine, theirs)
    process.exit(1)
  }

  const results = []
  results.push(await median('json-rules-engine: new Engine + addRule + run (per eval)', 3000, async () => {
    const e = makeReusedEngine()
    await e.run(facts)
  }, true))
  results.push(await median('json-rules-engine: reused engine, run (per eval)', 5000, async () => {
    await reused.run(facts)
  }, true))
  results.push(await median('fast-json-rules-engine: compile-per-eval', 20000, () => {
    compile(rules)(facts)
  }, false))
  results.push(await median('fast-json-rules-engine: compiled once, evaluate', 200000, () => {
    evaluate(facts)
  }, false))
  results.push(await median('fast-json-rules-engine: compiled once, stopOnFirstEvent', 200000, () => {
    evaluateStop(facts)
  }, false))

  const base = results[1].us // reused json-rules-engine as the fair baseline
  console.log(`\nRule set: ${RULE_COUNT} rules, flat all[] of 2-4 comparisons, distinct priorities`)
  console.log(`Node ${process.version}\n`)
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length))
  console.log(pad('variant', 58), pad('µs/eval', 12), 'vs reused')
  console.log('-'.repeat(85))
  for (const r of results) {
    console.log(pad(r.label, 58), pad(r.us.toFixed(3), 12), `${(base / r.us).toFixed(1)}x`)
  }
}

main()
