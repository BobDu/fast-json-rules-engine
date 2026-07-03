'use strict'
// Minimal zero-dependency test harness: works on Node 14+ (no node:test).
// Tests register via test(name, fn); run() executes them sequentially so async
// reference comparisons stay ordered, and sets a nonzero exit code on failure.
const assert = require('assert')

const queue = []

function test(name, fn) {
  queue.push({ name, fn })
}

async function run() {
  let passed = 0
  const failures = []
  for (const { name, fn } of queue) {
    try {
      await fn()
      passed++
    } catch (err) {
      failures.push({ name, err })
    }
  }
  const total = passed + failures.length
  for (const { name, err } of failures) {
    console.error(`\n✗ ${name}\n  ${(err && err.stack) || err}`)
  }
  console.log(`\n${passed}/${total} passed${failures.length ? `, ${failures.length} FAILED` : ''}`)
  if (failures.length) process.exitCode = 1
  return failures.length === 0
}

module.exports = { test, run, assert }
