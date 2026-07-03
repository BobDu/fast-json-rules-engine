'use strict'
// Reference oracle: runs the SAME rules through the real json-rules-engine and
// normalizes its output to the shape fast-json-rules-engine returns, so the two
// can be compared directly. Also captures the throw/no-throw outcome, since
// undefined-fact behavior is part of the contract we replicate.
const { Engine } = require('json-rules-engine')

function normalizeEvents(events) {
  return events.map((e) => ({ type: e.type, params: e.params === undefined ? undefined : e.params }))
}

// Deep clone so json-rules-engine's internal mutation never touches our inputs.
function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

/**
 * @returns {Promise<{ threw: boolean, events?, failureEvents?, error? }>}
 */
async function referenceRun(rules, facts, options = {}) {
  const engineOptions = {}
  if (options.allowUndefinedFacts !== undefined) {
    engineOptions.allowUndefinedFacts = options.allowUndefinedFacts
  }
  const engine = new Engine([], engineOptions)
  if (options.operators) {
    for (const [name, fn] of Object.entries(options.operators)) engine.addOperator(name, fn)
  }
  if (options.conditions) {
    for (const [name, cond] of Object.entries(options.conditions)) engine.setCondition(name, clone(cond))
  }
  const list = Array.isArray(rules) ? rules : [rules]
  for (const r of list) engine.addRule(clone(r))
  // Mirror our stopOnFirstEvent via json-rules-engine's stop()-on-success.
  if (options.stopOnFirstEvent) engine.on('success', () => engine.stop())

  try {
    const res = await engine.run(facts)
    return {
      threw: false,
      events: normalizeEvents(res.events),
      failureEvents: normalizeEvents(res.failureEvents),
    }
  } catch (err) {
    return { threw: true, error: err }
  }
}

// Normalize our engine's output to the same comparable shape.
function normalizeOwn(result) {
  return {
    threw: false,
    events: result.events.map((e) => ({ type: e.type, params: e.params })),
    failureEvents: result.failureEvents.map((e) => ({ type: e.type, params: e.params })),
  }
}

module.exports = { referenceRun, normalizeOwn }
