#!/usr/bin/env node
/**
 * metrics-writer.test.js
 * Tests for the MetricsWriter class.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetricsWriter } from '../src/metrics-writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_METRICS = path.join(__dirname, 'test-metrics-temp.json');

function cleanup() {
  if (fs.existsSync(TEST_METRICS)) fs.unlinkSync(TEST_METRICS);
}

function mkTask(overrides = {}) {
  return {
    id: 'test-task-id',
    title: 'Test Task',
    repo: 'test/repo',
    branch: 'main',
    ...overrides,
  };
}

// ─── record() ─────────────────────────────────────────────────────────────────

function testRecordPass() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  const entry = mw.record({
    task: mkTask({ id: 'task-pass' }),
    startTime: new Date('2026-04-19T00:00:00Z'),
    endTime:   new Date('2026-04-19T00:01:30Z'),
    passed: true,
    attempts: 1,
    stages: { lint: { success: true }, test: { success: true } },
    prUrl: 'https://github.com/test/repo/pull/1',
  });

  assert.strictEqual(entry.passed, true);
  assert.strictEqual(entry.durationMs, 90_000);
  assert.strictEqual(entry.durationSec, 90);
  assert.strictEqual(entry.prUrl, 'https://github.com/test/repo/pull/1');
  assert.deepStrictEqual(entry.stages, { lint: { success: true }, test: { success: true } });
  assert.strictEqual(entry.error, null);
  console.log('  ✓ record() — pass case');
}

function testRecordFail() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  const entry = mw.record({
    task: mkTask({ id: 'task-fail' }),
    startTime: new Date('2026-04-19T01:00:00Z'),
    endTime:   new Date('2026-04-19T01:02:00Z'),
    passed: false,
    attempts: 3,
    stages: { lint: { success: false }, test: { success: false } },
    error: 'ESLint: unused variable',
  });

  assert.strictEqual(entry.passed, false);
  assert.strictEqual(entry.attempts, 3);
  assert.strictEqual(entry.durationMs, 120_000);
  assert.strictEqual(entry.error, 'ESLint: unused variable');
  console.log('  ✓ record() — fail case');
}

function testRecordDefaults() {
  cleanup();
  const before = Date.now();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  const entry = mw.record({ task: mkTask({ id: 'task-defaults' }) });
  const after = Date.now();

  assert.strictEqual(entry.passed, undefined); // no default — caller must supply
  assert.strictEqual(entry.attempts, 1);          // default
  assert.strictEqual(entry.error, null);
  assert.strictEqual(entry.prUrl, null);
  assert(entry.durationMs >= 0);
  assert(entry.durationMs < 1000);              // nearly instant
  assert(entry.timestamp >= new Date(before).toISOString());
  assert(entry.timestamp <= new Date(after).toISOString());
  console.log('  ✓ record() — defaults');
}

// ─── recent() ─────────────────────────────────────────────────────────────────

function testRecent() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  for (let i = 0; i < 25; i++) {
    mw.record({ task: mkTask({ id: `task-${i}` }), passed: i % 2 === 0 });
  }

  const last5 = mw.recent(5);
  assert.strictEqual(last5.length, 5);
  assert.strictEqual(last5[0].id, 'task-20');  // 21st entry (0-indexed 20)
  assert.strictEqual(last5[4].id, 'task-24');  // 25th entry
  console.log('  ✓ recent()');
}

// ─── stats() ───────────────────────────────────────────────────────────────────

function testStatsEmpty() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  const stats = mw.stats();
  assert.strictEqual(stats.total, 0);
  console.log('  ✓ stats() — empty');
}

function testStatsAggregates() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  // 7 passed, 3 failed = 10 total
  for (let i = 0; i < 7; i++) mw.record({ task: mkTask({ id: `pass-${i}` }), passed: true });
  for (let i = 0; i < 3; i++) mw.record({ task: mkTask({ id: `fail-${i}` }), passed: false });

  const stats = mw.stats();
  assert.strictEqual(stats.total, 10);
  assert.strictEqual(stats.passed, 7);
  assert.strictEqual(stats.failed, 3);
  assert.strictEqual(stats.passRate, 70.0);
  assert(stats.avgDurationSec >= 0);  // may be 0 if no times supplied
  assert(stats.since !== null);
  assert(stats.latest !== null);
  console.log('  ✓ stats() — aggregates');
}

// ─── slackSummary() ────────────────────────────────────────────────────────────

function testSlackSummaryEmpty() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  const summary = mw.slackSummary();
  assert.strictEqual(summary, '_(no metrics recorded yet)_');
  console.log('  ✓ slackSummary() — empty');
}

function testSlackSummaryRecent() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  mw.record({ task: mkTask({ id: 'slack-1', title: 'Fix bug' }), passed: true, attempts: 1 });
  mw.record({ task: mkTask({ id: 'slack-2', title: 'Add test' }), passed: false, attempts: 2 });

  const summary = mw.slackSummary(2);
  assert(summary.includes('Factory Metrics'));
  assert(summary.includes('slack-1'));
  assert(summary.includes('slack-2'));
  assert(summary.includes('✅'));  // pass icon
  assert(summary.includes('❌'));  // fail icon
  assert(summary.includes('Pass rate:'));  // passRate in header
  console.log('  ✓ slackSummary() — recent runs');
}

// ─── rotation at MAX_ENTRIES ───────────────────────────────────────────────────

function testRotation() {
  cleanup();
  const mw = new MetricsWriter({ metricsPath: TEST_METRICS });
  // Write MAX_ENTRIES + 5 entries
  for (let i = 0; i < 505; i++) {
    mw.record({ task: mkTask({ id: `rot-${i}` }), passed: i % 2 === 0 });
  }

  const all = mw.recent(9999);  // no limit → returns all loaded
  assert(all.length <= 500, `should be capped at 500, got ${all.length}`);
  // Oldest entries should have been rotated out
  const hasRot0 = all.some(e => e.id === 'rot-0');
  const hasRot504 = all.some(e => e.id === 'rot-504');
  assert(!hasRot0,   'rot-0 should have been rotated out');
  assert(hasRot504,  'rot-504 should be in the last 500');
  console.log('  ✓ rotation at MAX_ENTRIES=500');
}

// ─── Run ───────────────────────────────────────────────────────────────────────

testRecordPass();
testRecordFail();
testRecordDefaults();
testRecent();
testStatsEmpty();
testStatsAggregates();
testSlackSummaryEmpty();
testSlackSummaryRecent();
testRotation();

cleanup();
console.log('\n✓ metrics-writer tests passed (8 suites)');