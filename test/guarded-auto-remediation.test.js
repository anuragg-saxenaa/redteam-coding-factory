#!/usr/bin/env node
/**
 * Guarded Auto-Remediation Integration Tests — TICKET-2026-02-25-02
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const WorktreeManager = require('../src/worktree-manager');
const CodeExecutor = require('../src/code-executor');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guarded-remed-'));
  const bare = path.join(root, 'repo.git');
  const work = path.join(root, 'repo');

  execSync(`git init --bare ${bare}`);
  execSync(`git clone ${bare} ${work}`);
  execSync(`git -C ${work} config user.email "test@example.com"`);
  execSync(`git -C ${work} config user.name "Test User"`);

  fs.writeFileSync(path.join(work, 'lint.sh'), '#!/bin/bash\nif [ -f .lint-fixed ]; then echo "lint ok"; exit 0; fi\necho "eslint no-unused-vars"; exit 1\n');
  fs.writeFileSync(path.join(work, 'test.sh'), '#!/bin/bash\necho "tests ok"\nexit 0\n');
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({
    name: 'guarded-remediation-repo',
    version: '1.0.0',
    scripts: {
      lint: 'bash lint.sh',
      test: 'bash test.sh'
    }
  }, null, 2));

  execSync(`git -C ${work} add .`);
  execSync(`git -C ${work} commit -m "init"`);
  execSync(`git -C ${work} push origin main`);

  return { root, bare, work };
}

function cleanup(dir) {
  try {
    execSync(`rm -rf ${dir}`);
  } catch (_) {
    // ignore
  }
}

(async () => {
  console.log('\nTest 1: remediation fixes lint and pipeline succeeds');
  const env = setupRepo();

  try {
    const wtm = new WorktreeManager(env.bare, path.join(env.root, 'worktrees'));
    const wt = wtm.create('task-1', 'main');

    const executor = new CodeExecutor(wtm, {
      maxRetries: 2,
      maxRetryBudget: 4,
      enableAutoRemediation: true,
      remediationGenerator: () => ({
        scope: { type: 'lint-only', files: ['lint.sh'], risk: 'low' },
        commands: ['touch .lint-fixed'],
      }),
    });

    const result = await executor.execute({
      id: 'task-1',
      title: 'Fix lint',
      description: 'auto fix lint',
      worktreeId: wt.id,
    });

    assert(result.success === true, 'executor completes successfully');
    assert(Array.isArray(result.healingDetails.remediations) && result.healingDetails.remediations.length >= 1, 'records remediation event');
    assert(result.healingDetails.budget && result.healingDetails.budget.used >= 1, 'records retry budget usage');
  } finally {
    cleanup(env.root);
  }

  console.log('\nTest 2: budget exhaustion surfaces escalation details');
  const env2 = setupRepo();

  try {
    const wtm2 = new WorktreeManager(env2.bare, path.join(env2.root, 'worktrees'));
    const wt2 = wtm2.create('task-2', 'main');

    const executor2 = new CodeExecutor(wtm2, {
      maxRetries: 3,
      maxRetryBudget: 1,
      enableAutoRemediation: false,
    });

    const result2 = await executor2.execute({
      id: 'task-2',
      title: 'Fail lint',
      description: 'lint should fail',
      worktreeId: wt2.id,
    });

    assert(result2.success === false, 'executor fails with tiny budget');
    assert(Array.isArray(result2.healingDetails.escalations) && result2.healingDetails.escalations.length >= 1, 'escalation event is present');
    assert(result2.healingDetails.budget && result2.healingDetails.budget.max === 1, 'budget max captured');
  } finally {
    cleanup(env2.root);
  }

  console.log(`\n=== Guarded Auto-Remediation Tests: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
