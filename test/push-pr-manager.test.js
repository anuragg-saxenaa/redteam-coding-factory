#!/usr/bin/env node
/**
 * PushPRManager tests — conflict/rebase reactions (Phase 2 scale)
 */

const assert = require('assert');
const PushPRManager = require('../src/push-pr-manager');

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

function createTask() {
  return {
    id: 'task-123',
    title: 'Test task',
    description: 'test',
    repo: 'org/repo',
    branch: 'main',
    validationResult: {
      steps: [
        { name: 'lint', success: true },
        { name: 'test', success: true },
      ],
    },
  };
}

function createManager(execSyncImpl) {
  const wt = {
    getByTaskId: () => ({ path: '/tmp/worktree-task-123' }),
  };
  const tm = {
    get: () => null,
    persistQueue: () => {},
  };

  return new PushPRManager(wt, tm, {
    enablePush: true,
    execSync: execSyncImpl,
  });
}

console.log('Test 1: syncWithBaseBranch executes fetch + rebase');
{
  const commands = [];
  const manager = createManager((cmd) => {
    commands.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD')) {
      return Buffer.from('worktree/fix-1\n');
    }
    return Buffer.from('');
  });

  const branch = manager.syncWithBaseBranch('/tmp/worktree-task-123', 'main');
  ok(branch === 'worktree/fix-1', 'returns current branch name');
  ok(commands.some((c) => c.includes('fetch origin main')), 'runs git fetch origin main');
  ok(commands.some((c) => c.includes('rebase origin/main')), 'runs git rebase origin/main');
}

console.log('Test 2: syncWithBaseBranch surfaces REBASE_CONFLICT and aborts rebase');
{
  const commands = [];
  const manager = createManager((cmd) => {
    commands.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD')) {
      return Buffer.from('worktree/fix-2\n');
    }
    if (cmd.includes('rebase origin/main')) {
      const err = new Error('rebase failed');
      err.stderr = Buffer.from('CONFLICT (content): Merge conflict in src/index.js');
      throw err;
    }
    return Buffer.from('');
  });

  let threw = false;
  try {
    manager.syncWithBaseBranch('/tmp/worktree-task-123', 'main');
  } catch (error) {
    threw = true;
    ok(/REBASE_CONFLICT/.test(error.message), 'throws REBASE_CONFLICT marker');
  }

  ok(threw, 'throws on conflict');
  ok(commands.some((c) => c.includes('rebase --abort')), 'attempts rebase --abort after conflict');
}

console.log('Test 3: createPushPR runs sync + push for successful validation');
{
  const commands = [];
  const manager = createManager((cmd) => {
    commands.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD')) {
      return Buffer.from('worktree/fix-3\n');
    }
    return Buffer.from('');
  });

  const task = createTask();
  const result = manager.createPushPR(task, { createPR: false });

  ok(result.success === true, 'returns success');
  ok(commands.some((c) => c.includes('fetch origin main')), 'sync step fetches base branch');
  ok(commands.some((c) => c.includes('rebase origin/main')), 'sync step rebases on base branch');
  ok(commands.some((c) => c.includes('push origin worktree/fix-3')), 'pushes current branch to origin');
}

console.log('');
console.log(`=== PushPRManager Tests: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
