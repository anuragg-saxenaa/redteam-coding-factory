#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const TEST_ROOT = path.join(__dirname, '.factory-status-board-test');
const REPO_ROOT = path.join(TEST_ROOT, 'repo');
const WORKTREE_BASE = path.join(REPO_ROOT, '.worktrees');
const METRICS_PATH = path.join(REPO_ROOT, 'ops', 'metrics.json');
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'factory-status-board.js');

function cleanup() {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function setupFixtures() {
  cleanup();
  fs.mkdirSync(WORKTREE_BASE, { recursive: true });
  fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });

  const statusA = [
    'run_id=factory-run-20260320-100000',
    'created_at=2026-03-20T10:00:00Z',
    'task=Implement status board',
    'result=success',
    'attempts=1',
    'escalation_required=false',
    'pr_status=skipped',
    'slack_post_status=sent',
  ].join('\n');

  const statusB = [
    'run_id=factory-run-20260320-110000',
    'created_at=2026-03-20T11:00:00Z',
    'task=Fix CI loop edge case',
    'result=failed',
    'attempts=3',
    'escalation_required=true',
    'escalation_reason=ci_failed_after_max_reaction_attempts',
    'pr_status=created',
    'pr_url=https://github.com/example/repo/pull/123',
    'slack_post_status=failed',
  ].join('\n');

  fs.writeFileSync(path.join(WORKTREE_BASE, 'factory-run-20260320-100000.status'), `${statusA}\n`);
  fs.writeFileSync(path.join(WORKTREE_BASE, 'factory-run-20260320-110000.status'), `${statusB}\n`);

  fs.writeFileSync(
    METRICS_PATH,
    JSON.stringify([
      { result: 'success', task: 'Implement status board' },
      { result: 'failed', task: 'Fix CI loop edge case' },
    ], null, 2) + '\n'
  );
}

function runJson(limit = 10) {
  const output = execFileSync('node', [
    SCRIPT_PATH,
    '--repo', REPO_ROOT,
    '--limit', String(limit),
    '--format', 'json',
  ], { stdio: 'pipe' }).toString();

  return JSON.parse(output);
}

function testSummaryJson() {
  const summary = runJson();

  assert.strictEqual(summary.totals.runs, 2, 'should count total runs from status files');
  assert.strictEqual(summary.totals.success, 1, 'should count successful runs');
  assert.strictEqual(summary.totals.failed, 1, 'should count failed runs');
  assert.strictEqual(summary.totals.escalated, 1, 'should count escalated runs');

  assert.strictEqual(summary.metrics.records, 2, 'should include metrics record count');
  assert.strictEqual(summary.metrics.success, 1, 'should include metrics success count');
  assert.strictEqual(summary.metrics.failed, 1, 'should include metrics failed count');

  assert.strictEqual(summary.recent.length, 2, 'should include recent runs');
  assert.strictEqual(summary.recent[0].runId, 'factory-run-20260320-110000', 'latest run should be first');
  assert.strictEqual(summary.recent[0].escalationRequired, true, 'escalation flag should be parsed');
}

function testLimit() {
  const summary = runJson(1);
  assert.strictEqual(summary.recent.length, 1, 'limit should cap recent runs list');
}

function main() {
  setupFixtures();
  try {
    testSummaryJson();
    testLimit();
    console.log('✓ factory-status-board tests passed');
  } finally {
    cleanup();
  }
}

main();
