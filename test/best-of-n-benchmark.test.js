#!/usr/bin/env node

const { evaluateBestOfN, selectBestCandidate } = require('../src/best-of-n-benchmark');

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

console.log('\nTest 1: deterministic comparator prioritizes solved + ciPass');
const selected = selectBestCandidate([
  { attempt: 1, candidateId: 'c', solved: false, ciPass: true, patchScore: 0.99, testsPassed: 50, runtimeSec: 10 },
  { attempt: 2, candidateId: 'b', solved: true, ciPass: false, patchScore: 0.8, testsPassed: 45, runtimeSec: 20 },
  { attempt: 3, candidateId: 'a', solved: true, ciPass: true, patchScore: 0.7, testsPassed: 40, runtimeSec: 30 },
]);
assert(selected.candidateId === 'a', 'selects solved+ciPass candidate first');

console.log('\nTest 2: best-of-N improves solved count over single-shot baseline');
const report = evaluateBestOfN({
  n: 3,
  tasks: [
    {
      taskId: 't1',
      attempts: [
        { attempt: 1, candidateId: 't1-a1', solved: false, ciPass: false, patchScore: 0.2, testsPassed: 5, runtimeSec: 90 },
        { attempt: 2, candidateId: 't1-a2', solved: true, ciPass: true, patchScore: 0.9, testsPassed: 12, runtimeSec: 110 },
      ],
    },
    {
      taskId: 't2',
      attempts: [
        { attempt: 1, candidateId: 't2-a1', solved: false, ciPass: true, patchScore: 0.4, testsPassed: 8, runtimeSec: 80 },
        { attempt: 2, candidateId: 't2-a2', solved: false, ciPass: true, patchScore: 0.5, testsPassed: 9, runtimeSec: 85 },
      ],
    },
    {
      taskId: 't3',
      attempts: [
        { attempt: 1, candidateId: 't3-a1', solved: true, ciPass: true, patchScore: 0.7, testsPassed: 10, runtimeSec: 70 },
      ],
    },
  ],
});

assert(report.baseline.solved === 1, 'baseline solved count is 1');
assert(report.bestOfN.solved === 2, 'best-of-3 solved count is 2');
assert(report.delta.solveRatePoints > 0, 'solve rate delta is positive');
assert(report.selections.bestOfN.find((s) => s.taskId === 't1').attempt === 2, 'selects improved attempt for t1');

console.log('\nTest 3: n bound limits selection window');
const n1Report = evaluateBestOfN({
  n: 1,
  tasks: [
    {
      taskId: 'n1',
      attempts: [
        { attempt: 1, candidateId: 'n1-a1', solved: false, ciPass: true, patchScore: 0.4, testsPassed: 4, runtimeSec: 10 },
        { attempt: 2, candidateId: 'n1-a2', solved: true, ciPass: true, patchScore: 0.9, testsPassed: 9, runtimeSec: 20 },
      ],
    },
  ],
});
assert(n1Report.bestOfN.solved === 0, 'best-of-1 does not look beyond attempt 1');

console.log(`\n=== Best-of-N Tests: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
