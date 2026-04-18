#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { WorktreeManager } from '../src/worktree-manager.js';

const TEST_ROOT = path.join(__dirname, '.worktree-manager-test');
const BASE_BARE = path.join(TEST_ROOT, 'base.git');
const BASE_CLONE = path.join(TEST_ROOT, 'base-work');
const WT_ROOT = path.join(TEST_ROOT, '.worktrees');

function sh(cmd) {
  execSync(cmd, { stdio: 'pipe' });
}

function cleanup() {
  if (fs.existsSync(TEST_ROOT)) {
    sh(`rm -rf ${TEST_ROOT}`);
  }
}

function setupRepo() {
  cleanup();
  fs.mkdirSync(TEST_ROOT, { recursive: true });

  sh(`git init --bare ${BASE_BARE}`);
  sh(`git clone ${BASE_BARE} ${BASE_CLONE}`);
  sh(`git -C ${BASE_CLONE} config user.email "test@example.com"`);
  sh(`git -C ${BASE_CLONE} config user.name "Test User"`);

  fs.writeFileSync(path.join(BASE_CLONE, 'README.md'), '# Worktree Manager Test\n');
  fs.writeFileSync(
    path.join(BASE_CLONE, 'package.json'),
    JSON.stringify({
      name: 'worktree-manager-test',
      version: '1.0.0',
      scripts: {
        lint: 'echo lint-ok',
        test: 'echo test-ok',
      },
    }, null, 2)
  );
  sh(`git -C ${BASE_CLONE} add .`);
  sh(`git -C ${BASE_CLONE} commit -m "initial"`);
  sh(`git -C ${BASE_CLONE} branch -M main`);
  sh(`git -C ${BASE_CLONE} push -u origin HEAD:main`);
}

function testCreateListRemovePersist() {
  const wm = new WorktreeManager(BASE_BARE, WT_ROOT);

  const created = wm.create('task-1', 'main', {
    owner: 'eng',
    ticketId: 'TICKET-20260320-033',
    labels: ['phase1', 'worktree-isolation'],
  });
  assert(created.id, 'created record should include id');
  assert(fs.existsSync(created.path), 'worktree path should exist after create');

  const activeList = wm.list({ status: 'active' });
  assert.strictEqual(activeList.length, 1, 'should list one active worktree');
  assert.strictEqual(created.owner, 'eng', 'created record should persist owner metadata');
  assert.strictEqual(created.ticketId, 'TICKET-20260320-033', 'created record should persist ticketId metadata');
  assert.deepStrictEqual(created.labels, ['phase1', 'worktree-isolation'], 'created record should persist labels metadata');

  const fetched = wm.getByTaskId('task-1');
  assert(fetched && fetched.id === created.id, 'getByTaskId should return created active worktree');

  const reloaded = new WorktreeManager(BASE_BARE, WT_ROOT);
  const fromDisk = reloaded.get(created.id);
  assert(fromDisk, 'metadata should persist across manager instances');
  assert.strictEqual(fromDisk.owner, 'eng', 'owner metadata should persist across reload');
  assert.strictEqual(fromDisk.ticketId, 'TICKET-20260320-033', 'ticket metadata should persist across reload');

  wm.remove(created.id);
  assert(!fs.existsSync(created.path), 'worktree path should be removed after remove');

  const removedRecord = wm.get(created.id);
  assert(removedRecord.status === 'removed', 'record should be marked removed');
  assert(removedRecord.removedAt, 'removed record should include removedAt');
}

function testRemoveSupportsForceForDirtyWorktree() {
  const wm = new WorktreeManager(BASE_BARE, WT_ROOT);
  const created = wm.create('task-dirty-force-remove', 'main');

  fs.writeFileSync(path.join(created.path, 'DIRTY.txt'), 'uncommitted changes\n');

  let removeFailed = false;
  try {
    wm.remove(created.id);
  } catch (error) {
    removeFailed = true;
  }
  assert(removeFailed, 'remove without force should fail on dirty worktree');

  wm.remove(created.id, { force: true });
  assert(!fs.existsSync(created.path), 'force remove should cleanup dirty worktree');

  const removedRecord = wm.get(created.id);
  assert(removedRecord.status === 'removed', 'force remove should still mark metadata removed');
}


function testCreateFallsBackWhenBranchAlreadyCheckedOut() {
  const fallbackRoot = path.join(TEST_ROOT, '.worktrees-fallback');
  const wm = new WorktreeManager(BASE_CLONE, fallbackRoot);

  const created = wm.create('task-branch-collision', 'main');
  assert(fs.existsSync(created.path), 'fallback worktree path should exist after create');
  assert(created.branch.startsWith('factory/main/'), 'fallback should use generated task branch');
  assert.strictEqual(created.baseBranch, 'main', 'record should preserve requested base branch');

  const branchName = execSync(`git -C ${created.path} rev-parse --abbrev-ref HEAD`, { stdio: 'pipe' })
    .toString()
    .trim();
  assert.strictEqual(branchName, created.branch, 'fallback worktree should check out generated branch');

  wm.remove(created.id);
}

function testCleanupStaleUsesPorcelain() {
  const wm = new WorktreeManager(BASE_BARE, WT_ROOT);
  const created = wm.create('task-stale', 'main');

  // Simulate drift: remove worktree registration directly via git,
  // then confirm cleanupStale marks metadata as stale.
  sh(`git -C ${BASE_BARE} worktree remove ${created.path}`);

  const cleanup = wm.cleanupStale();
  assert.strictEqual(cleanup.staleMarked, 1, 'cleanup should mark one stale worktree');

  const stale = wm.get(created.id);
  assert(stale, 'stale record should still exist in metadata');
  assert.strictEqual(stale.status, 'stale', 'stale record should be marked stale');
  assert(stale.removedAt, 'stale record should include removedAt timestamp');
}

function testPruneManagedRemovesOldTerminalMetadata() {
  const wm = new WorktreeManager(BASE_BARE, WT_ROOT);

  const removed = wm.create('task-prune-removed', 'main');
  wm.remove(removed.id);

  const stale = wm.create('task-prune-stale', 'main');
  sh(`git -C ${BASE_BARE} worktree remove ${stale.path}`);
  wm.cleanupStale();

  // age both records so they become eligible for pruning
  const removedRecord = wm.get(removed.id);
  const staleRecord = wm.get(stale.id);
  removedRecord.removedAt = '2000-01-01T00:00:00.000Z';
  staleRecord.removedAt = '2000-01-01T00:00:00.000Z';
  wm.persistWorktrees();

  const prune = wm.pruneManaged({ olderThanMs: 1 });
  assert(prune.prunedRecords >= 2, 'prune should remove old removed/stale metadata records');
  assert.strictEqual(wm.get(removed.id), undefined, 'removed metadata should be pruned');
  assert.strictEqual(wm.get(stale.id), undefined, 'stale metadata should be pruned');
}

function main() {
  setupRepo();
  try {
    testCreateListRemovePersist();
    testRemoveSupportsForceForDirtyWorktree();
    testCleanupStaleUsesPorcelain();
    testPruneManagedRemovesOldTerminalMetadata();
    testCreateFallsBackWhenBranchAlreadyCheckedOut();
    console.log('✓ worktree-manager tests passed');
  } finally {
    cleanup();
  }
}

main();
