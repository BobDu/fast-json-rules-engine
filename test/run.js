'use strict'
// Test entry point: register all suites, then run them. Requires the built
// dist (run `npm run build` first; the pretest hook does this).
const { run } = require('./harness')

require('./golden')
require('./fuzz')

run().then((ok) => {
  if (!ok) process.exitCode = 1
})
