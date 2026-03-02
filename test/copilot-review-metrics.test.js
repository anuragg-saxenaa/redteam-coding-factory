#!/usr/bin/env node

const { evaluateCopilotReviewMetrics } = require('../src/copilot-review-metrics');

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

console.log('\nTest 1: passing policy gates');
const passPolicy = {
  minSampleSize: 4,
  minSnr: 1.0,
  minAdoptionRatePct: 40,
  maxIgnoredRatePct: 35,
};
const passEvents = [
  { prNumber: 1, submittedAt: '2026-02-21T10:00:00Z', isDraft: false, onNewPush: true, outcome: 'accepted' },
  { prNumber: 2, submittedAt: '2026-02-21T11:00:00Z', isDraft: false, onNewPush: true, outcome: 'partially_accepted' },
  { prNumber: 3, submittedAt: '2026-02-21T12:00:00Z', isDraft: false, onNewPush: true, outcome: 'rejected' },
  { prNumber: 4, submittedAt: '2026-02-21T13:00:00Z', isDraft: false, onNewPush: true, outcome: 'accepted' },
];
const result1 = evaluateCopilotReviewMetrics(passEvents, passPolicy);
assert(result1.pass === true, 'overall pass');
assert(result1.stats.signalToNoiseRatio >= 1.0, 'snr gate passes');

console.log('\nTest 2: failing SNR gate');
const failSnr = evaluateCopilotReviewMetrics([
  { prNumber: 1, submittedAt: '2026-02-21T10:00:00Z', isDraft: false, onNewPush: true, outcome: 'accepted' },
  { prNumber: 2, submittedAt: '2026-02-21T11:00:00Z', isDraft: false, onNewPush: true, outcome: 'ignored' },
  { prNumber: 3, submittedAt: '2026-02-21T12:00:00Z', isDraft: false, onNewPush: true, outcome: 'ignored' },
  { prNumber: 4, submittedAt: '2026-02-21T13:00:00Z', isDraft: false, onNewPush: true, outcome: 'rejected' },
], { ...passPolicy, minSnr: 1.1 });
assert(failSnr.pass === false, 'overall fail on snr');

console.log('\nTest 3: draft events excluded by default');
const withDraft = evaluateCopilotReviewMetrics([
  { prNumber: 1, submittedAt: '2026-02-21T10:00:00Z', isDraft: true, onNewPush: true, outcome: 'accepted' },
  { prNumber: 2, submittedAt: '2026-02-21T11:00:00Z', isDraft: false, onNewPush: true, outcome: 'accepted' },
  { prNumber: 3, submittedAt: '2026-02-21T12:00:00Z', isDraft: false, onNewPush: true, outcome: 'rejected' },
  { prNumber: 4, submittedAt: '2026-02-21T13:00:00Z', isDraft: false, onNewPush: true, outcome: 'accepted' },
], passPolicy);
assert(withDraft.stats.inScopeEvents === 3, 'draft excluded');

console.log(`\n=== Copilot Review Metrics Tests: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
