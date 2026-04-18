#!/usr/bin/env node
/**
 * Issue Watcher Tests — Phase 2
 * Tests the polling daemon that bridges GitHub issues → factory pipeline
 */

import { IssueWatcher } from '../src/issue-watcher.js';
import assert from 'assert';

let passed = 0;
let failed = 0;

function ok(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// --- Test 1: Construction with defaults ---
console.log('Test 1: Default construction');
{
  const watcher = new IssueWatcher({
    repo: 'test/repo',
    repoPath: '/tmp/test-repo',
  });
  ok(watcher.repo === 'test/repo', 'repo set');
  ok(watcher.repoPath === '/tmp/test-repo', 'repoPath set');
  ok(watcher.branch === 'main', 'default branch');
  ok(watcher.pollIntervalMs === 60000, 'default poll interval 60s');
  ok(watcher.maxConcurrent === 1, 'default max concurrent 1');
  ok(watcher.enablePush === false, 'push disabled by default');
  ok(watcher.createPR === false, 'PR disabled by default');
  ok(watcher.autoClose === false, 'autoClose disabled by default');
  ok(watcher.agentName === 'codex', 'default agent is codex');
  ok(watcher._running === false, 'not running initially');
  ok(watcher.stopReason === null, 'stop reason unset by default');
}

// --- Test 2: Custom config ---
console.log('Test 2: Custom construction');
{
  const watcher = new IssueWatcher({
    repo: 'org/my-repo',
    repoPath: '/tmp/issue-watcher-test-repo',
    dataDir: '/tmp/issue-watcher-test-data',
    branch: 'develop',
    pollIntervalMs: 30000,
    maxConcurrent: 3,
    enablePush: true,
    createPR: true,
    autoClose: true,
    agent: 'claude',
    agentTimeoutMs: 10 * 60 * 1000,
    label: 'auto-fix',
  });
  ok(watcher.repo === 'org/my-repo', 'custom repo');
  ok(watcher.branch === 'develop', 'custom branch');
  ok(watcher.pollIntervalMs === 30000, 'custom poll interval');
  ok(watcher.maxConcurrent === 3, 'custom max concurrent');
  ok(watcher.enablePush === true, 'push enabled');
  ok(watcher.createPR === true, 'PR enabled');
  ok(watcher.autoClose === true, 'autoClose enabled');
  ok(watcher.agentName === 'claude', 'custom agent');
  ok(watcher.factory.agentIntegration.defaultTimeoutMs === 10 * 60 * 1000, 'agent timeout propagated to integration');
}

// --- Test 3: Stats tracking ---
console.log('Test 3: Stats tracking');
{
  const watcher = new IssueWatcher({
    repo: 'test/repo',
    repoPath: '/tmp/test-repo',
  });
  const stats = watcher.stats();
  ok(stats.polled === 0, 'initial polled 0');
  ok(stats.started === 0, 'initial started 0');
  ok(stats.completed === 0, 'initial completed 0');
  ok(stats.failed === 0, 'initial failed 0');
  ok(stats.skipped === 0, 'initial skipped 0');
  ok(stats.active === 0, 'initial active 0');
  ok(stats.running === false, 'initial not running');
  ok(stats.processed === 0, 'initial processed 0');
}

// --- Test 4: Requires repo for start ---
console.log('Test 4: Requires repo for start');
{
  const watcher = new IssueWatcher({ repoPath: '/tmp/test' });
  let threw = false;
  try {
    watcher.start();
  } catch (err) {
    threw = true;
    ok(err.message.includes('repo is required'), 'error mentions repo');
  }
  ok(threw, 'throws without repo');
}

// --- Test 5: Requires repoPath for start ---
console.log('Test 5: Requires repoPath for start');
{
  const watcher = new IssueWatcher({ repo: 'test/repo' });
  let threw = false;
  try {
    watcher.start();
  } catch (err) {
    threw = true;
    ok(err.message.includes('repoPath is required'), 'error mentions repoPath');
  }
  ok(threw, 'throws without repoPath');
}

// --- Test 6: Stop sets state correctly ---
console.log('Test 6: Stop sets state');
{
  const watcher = new IssueWatcher({
    repo: 'test/repo',
    repoPath: '/tmp/test-repo',
  });
  // Manually set running state
  watcher._running = true;
  watcher._timer = setInterval(() => {}, 99999);
  watcher.stop();
  ok(watcher._running === false, 'stopped after stop()');
  ok(watcher._timer === null, 'timer cleared');
}

async function runAsyncTests() {
  // --- Test 7: pollOnce requires config ---
  console.log('Test 7: pollOnce requires config');
  {
    const watcher = new IssueWatcher({ repo: 'test/repo', repoPath: '/tmp/test' });
    // Remove repo to force error
    watcher.repo = null;
    let threw = false;
    try {
      await watcher.pollOnce();
    } catch (err) {
      threw = true;
      ok(err.message.includes('repo is required'), 'pollOnce error mentions repo');
    }
    // Restore
    watcher.repo = 'test/repo';
    if (threw) passed++; else { console.error('  ✗ pollOnce throws without repo'); failed++; }
  }

  // --- Test 8: Concurrency limit respected ---
  console.log('Test 8: Concurrency limit');
  {
    const watcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
      maxConcurrent: 1,
    });
    // Simulate active task
    watcher._activeTasks = 1;
    // _poll should return empty when at capacity
    const results = await watcher._poll();
    if (results.length === 0) { console.log('  ✓ returns empty when at capacity'); passed++; }
    else { console.error('  ✗ failed concurrency check'); failed++; }
  }

  // --- Test 9: Stop condition maxTasksPerRun ---
  console.log('Test 9: maxTasksPerRun stop condition');
  {
    const watcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
      maxTasksPerRun: 1,
    });
    watcher._stats.completed = 1;
    const results = await watcher._poll();
    const stats = watcher.stats();
    if (results.length === 0) { console.log('  ✓ returns no tasks when task budget reached'); passed++; }
    else { console.error('  ✗ should not process when task budget reached'); failed++; }
    if (typeof stats.stopReason === 'string' && stats.stopReason.includes('task budget reached')) { console.log('  ✓ captures task budget stop reason'); passed++; }
    else { console.error('  ✗ missing task budget stop reason'); failed++; }
  }

  // --- Test 10: Poll processes up to available slots in parallel ---
  console.log('Test 10: parallel task dispatch within concurrency cap');
  {
    const watcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
      maxConcurrent: 2,
    });

    watcher.intake.poll = () => ([
      { metadata: { issueNumber: 11 }, title: 'Issue 11' },
      { metadata: { issueNumber: 12 }, title: 'Issue 12' },
      { metadata: { issueNumber: 13 }, title: 'Issue 13' },
    ]);

    let started = 0;
    watcher._processIssue = async (_task, issueNumber) => {
      started++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      watcher._stats.completed++;
      watcher._activeTasks--;
      return { issueNumber, success: true };
    };

    const results = await watcher._poll();
    if (results.length === 2) { console.log('  ✓ dispatches only up to concurrency slots'); passed++; }
    else { console.error(`  ✗ expected 2 results, got ${results.length}`); failed++; }
    if (started === 2) { console.log('  ✓ starts only two workers when maxConcurrent=2'); passed++; }
    else { console.error(`  ✗ expected 2 workers, got ${started}`); failed++; }
  }

  // --- Test 11: Failed issue is eligible for re-processing ---
  console.log('Test 11: failed issues are removed from processed cache');
  {
    const watcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
    });

    watcher.intake.commentOnIssue = () => {};
    watcher._removeInProgressLabel = () => {};
    watcher.factory.submitTask = () => ({ id: 'task-11' });
    watcher.factory.processNext = async () => ({ failed: true, executionResult: { error: 'boom' } });

    await watcher._processIssue({ title: 'Issue 11' }, 11);
    if (watcher._processedIssues.has(11)) {
      console.error('  ✗ failed issue should be removed from processed cache');
      failed++;
    } else {
      console.log('  ✓ failed issue removed from processed cache');
      passed++;
    }
  }

  // --- Test 12: Rebase conflict comments include branch/base context ---
  console.log('Test 12: conflict hint includes branch/base context');
  {
    const watcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
    });

    watcher.intake.commentOnIssue = () => {};
    watcher._removeInProgressLabel = () => {};
    watcher.factory.submitTask = () => ({ id: 'task-12' });

    let failureComment = '';
    watcher.intake.commentOnIssue = (_issueNumber, body) => {
      failureComment = body;
    };

    watcher.factory.processNext = async () => ({
      failed: true,
      pushPRError: '[PushPRManager] REBASE_CONFLICT: branch=worktree/fix-4 base=main; conflict detected',
    });

    await watcher._processIssue({ title: 'Issue 12' }, 12);

    if (/branch=`worktree\/fix-4`/.test(failureComment) && /base=`main`/.test(failureComment)) {
      console.log('  ✓ conflict comment contains branch/base context');
      passed++;
    } else {
      console.error('  ✗ conflict comment missing branch/base context');
      failed++;
    }
  }

  // --- Test 13: Worktree maintenance config defaults and overrides ---
  console.log('Test 13: worktree maintenance config');
  {
    const defaultWatcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
    });
    if (defaultWatcher.worktreeMaintenance.enabled === true
      && defaultWatcher.worktreeMaintenance.runEveryPolls === 5
      && defaultWatcher.worktreeMaintenance.pruneOlderHours === 168) {
      console.log('  ✓ default maintenance config applied');
      passed++;
    } else {
      console.error('  ✗ default maintenance config mismatch');
      failed++;
    }

    const customWatcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
      worktreeMaintenance: {
        enabled: false,
        runEveryPolls: 2,
        pruneOlderHours: 24,
      },
    });

    if (customWatcher.worktreeMaintenance.enabled === false
      && customWatcher.worktreeMaintenance.runEveryPolls === 2
      && customWatcher.worktreeMaintenance.pruneOlderHours === 24) {
      console.log('  ✓ custom maintenance config applied');
      passed++;
    } else {
      console.error('  ✗ custom maintenance config mismatch');
      failed++;
    }
  }

  // --- Test 14: Periodic maintenance runs every N polls ---
  console.log('Test 14: periodic maintenance cadence');
  {
    const watcher = new IssueWatcher({
      repo: 'test/repo',
      repoPath: '/tmp/test-repo',
      worktreeMaintenance: {
        enabled: true,
        runEveryPolls: 2,
        pruneOlderHours: 1,
      },
    });

    let maintenanceRuns = 0;
    watcher._runWorktreeMaintenance = () => {
      maintenanceRuns += 1;
      return { staleMarked: 0, dirsPruned: 0, prunedRecords: 0 };
    };
    watcher.intake.poll = () => [];

    await watcher._poll(); // cycle 1
    await watcher._poll(); // cycle 2 => maintenance
    await watcher._poll(); // cycle 3
    await watcher._poll(); // cycle 4 => maintenance

    if (maintenanceRuns === 2) {
      console.log('  ✓ maintenance runs on configured poll cadence');
      passed++;
    } else {
      console.error(`  ✗ expected 2 maintenance runs, got ${maintenanceRuns}`);
      failed++;
    }
  }

  // --- Summary ---
  console.log('');
  console.log(`=== Issue Watcher Tests: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runAsyncTests();
