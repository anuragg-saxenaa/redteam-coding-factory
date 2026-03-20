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

function createManager(execSyncImpl, extraConfig = {}) {
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
    ...extraConfig,
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
  }, { enableSecurityDiffScan: false });

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
  }, { enableSecurityDiffScan: false });

  let threw = false;
  try {
    manager.syncWithBaseBranch('/tmp/worktree-task-123', 'main');
  } catch (error) {
    threw = true;
    ok(/REBASE_CONFLICT/.test(error.message), 'throws REBASE_CONFLICT marker');
    ok(/branch=worktree\/fix-2/.test(error.message), 'conflict error includes branch context');
    ok(/base=main/.test(error.message), 'conflict error includes base branch context');
  }

  ok(threw, 'throws on conflict');
  ok(commands.some((c) => c.includes('rebase --abort')), 'attempts rebase --abort after conflict');
}

console.log('Test 3: createPushPR runs sync + security scan + push for successful validation');
{
  const commands = [];
  const manager = createManager((cmd) => {
    commands.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD')) {
      return Buffer.from('worktree/fix-3\n');
    }
    if (cmd.includes('merge-base HEAD origin/main')) {
      return Buffer.from('abc123\n');
    }
    if (cmd.includes('diff --name-only abc123..HEAD')) {
      return Buffer.from('src/index.js\nREADME.md\n');
    }
    return Buffer.from('');
  });

  const task = createTask();
  const result = manager.createPushPR(task, { createPR: false });

  ok(result.success === true, 'returns success');
  ok(commands.some((c) => c.includes('fetch origin main')), 'sync step fetches base branch');
  ok(commands.some((c) => c.includes('rebase origin/main')), 'sync step rebases on base branch');
  ok(commands.some((c) => c.includes('diff --name-only abc123..HEAD')), 'runs security diff scan before push');
  ok(commands.some((c) => c.includes('push origin worktree/fix-3')), 'pushes current branch to origin');
}

console.log('Test 4: createPushPR escalates on risky diff files');
{
  const commands = [];
  const escalations = [];
  const manager = createManager((cmd) => {
    commands.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD')) {
      return Buffer.from('worktree/fix-4\n');
    }
    if (cmd.includes('merge-base HEAD origin/main')) {
      return Buffer.from('def456\n');
    }
    if (cmd.includes('diff --name-only def456..HEAD')) {
      return Buffer.from('.github/workflows/pipeline.yml\n');
    }
    return Buffer.from('');
  }, {
    onSecurityEscalation: (payload) => escalations.push(payload),
  });

  let threw = false;
  try {
    manager.createPushPR(createTask(), { createPR: false });
  } catch (error) {
    threw = true;
    ok(/SECURITY_ESCALATION/.test(error.message), 'throws SECURITY_ESCALATION marker');
  }

  ok(threw, 'blocks push when risky workflow diff is detected');
  ok(!commands.some((c) => c.includes('push origin')), 'does not push when security scan escalates');
  ok(escalations.length === 1, 'emits one security escalation callback');
  ok(escalations[0]?.reason === 'SECURITY_ESCALATION', 'security escalation includes reason');
}

console.log('');
console.log(`=== PushPRManager Tests: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
