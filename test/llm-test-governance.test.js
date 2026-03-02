#!/usr/bin/env node

const { evaluateGovernance } = require('../src/llm-test-governance');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  OK ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

console.log('\nTest 1: happy path passes all governance gates');
const policy = { maxFlakeRatePct: 2, allowCoverageDropPct: 0 };
const baseline = {
  goldenCases: [
    { id: 'g1', passed: true },
    { id: 'g2', passed: true }
  ],
  flakeRatePct: 1,
  coverage: { linePct: 90 }
};
const candidate = {
  goldenCases: [
    { id: 'g1', passed: true },
    { id: 'g2', passed: true }
  ],
  flakeRatePct: 2,
  coverage: { linePct: 90 }
};

const result1 = evaluateGovernance(policy, baseline, candidate);
assert(result1.pass === true, 'overall pass');
assert(result1.checks.every((c) => c.pass === true), 'all checks pass');

console.log('\nTest 2: regression on golden case fails gate');
const result2 = evaluateGovernance(policy, baseline, {
  ...candidate,
  goldenCases: [
    { id: 'g1', passed: true },
    { id: 'g2', passed: false }
  ]
});
assert(result2.pass === false, 'overall fail on golden regression');
assert(result2.stats.goldenRegressionCount === 1, 'counts one golden regression');

console.log('\nTest 3: flake and coverage gates fail independently');
const result3 = evaluateGovernance(policy, baseline, {
  ...candidate,
  flakeRatePct: 3,
  coverage: { linePct: 89.9 }
});
const flakeCheck = result3.checks.find((c) => c.name === 'flake_rate_threshold');
const coverageCheck = result3.checks.find((c) => c.name === 'coverage_non_regression');
assert(flakeCheck && flakeCheck.pass === false, 'flake threshold check fails');
assert(coverageCheck && coverageCheck.pass === false, 'coverage non-regression check fails');

console.log(`\n=== LLM Test Governance Tests: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
