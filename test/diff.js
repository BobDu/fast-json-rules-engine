'use strict'
// Shared differential comparator: compile + evaluate with our engine, run the
// same through json-rules-engine, and assert identical behavior — including
// "both throw" for undefined facts / bad operators.
const assert = require('assert')
const { compile } = require('../dist/index.cjs')
const { referenceRun, normalizeOwn } = require('./reference')

function sortEvents(events) {
  return events
    .slice()
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (JSON.stringify(a.params) < JSON.stringify(b.params) ? -1 : 1))
}

async function expectMatch(rules, facts, options = {}, cmp = {}) {
  const ref = await referenceRun(rules, facts, options)

  let mine
  try {
    const evaluate = compile(rules, options)
    mine = normalizeOwn(evaluate(facts))
  } catch (err) {
    mine = { threw: true, error: err }
  }

  const ctx = () => JSON.stringify({ rules, facts, options })
  assert.strictEqual(
    mine.threw,
    ref.threw,
    `throw mismatch: mine=${mine.threw} ref=${ref.threw}${mine.error ? ' mineErr=' + mine.error.message : ''}${ref.error ? ' refErr=' + ref.error.message : ''} @ ${ctx()}`,
  )
  if (ref.threw) return

  if (cmp.orderInsensitive) {
    assert.deepStrictEqual(sortEvents(mine.events), sortEvents(ref.events), `events (set) mismatch @ ${ctx()}`)
    assert.deepStrictEqual(
      sortEvents(mine.failureEvents),
      sortEvents(ref.failureEvents),
      `failureEvents (set) mismatch @ ${ctx()}`,
    )
  } else {
    assert.deepStrictEqual(mine.events, ref.events, `events mismatch @ ${ctx()}`)
    assert.deepStrictEqual(mine.failureEvents, ref.failureEvents, `failureEvents mismatch @ ${ctx()}`)
  }
}

module.exports = { expectMatch }
