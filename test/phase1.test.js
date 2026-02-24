/**
 * Phase 1 tests: task intake + worktree isolation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const CodingFactory = require('../src/factory');

// Test setup: create a temporary test repo
const testDir = path.join(__dirname, '.test-repo');
const worktreeDir = path.join(testDir, 'worktrees');
const dataDir = path.join(testDir, 'data');

function setupTestRepo() {
  // Clean up if exists
  if (fs.existsSync(testDir)) {
    execSync(`rm -rf ${testDir}`);
  }
  fs.mkdirSync(testDir, { recursive: true });

  // Initialize a git repo
  execSync(`git init ${testDir}`);
  execSync(`git -C ${testDir} config user.email "test@example.com"`);
  execSync(`git -C ${testDir} config user.name "Test User"`);

  // Create initial commit
  fs.writeFileSync(path.join(testDir, 'README.md'), '# Test Repo\n');
  execSync(`git -C ${testDir} add README.md`);
  execSync(`git -C ${testDir} commit -m "Initial commit"`);
}

function teardownTestRepo() {
  if (fs.existsSync(testDir)) {
    execSync(`rm -rf ${testDir}`);
  }
}

describe('Phase 1: Task Intake + Worktree Isolation', () => {
  let factory;

  before(() => {
    setupTestRepo();
    factory = new CodingFactory({
      baseRepo: testDir,
      dataDir,
      worktreeRoot: worktreeDir,
    });
  });

  after(() => {
    teardownTestRepo();
  });

  it('should intake a task', () => {
    const task = factory.submitTask({
      title: 'Implement feature X',
      description: 'Add feature X to the codebase',
      repo: testDir,
    });

    assert(task.id, 'Task should have an id');
    assert.strictEqual(task.status, 'queued', 'Task should be queued');
    assert.strictEqual(task.title, 'Implement feature X');
  });

  it('should process next task and create worktree', async () => {
    factory.submitTask({
      title: 'Test task 1',
      description: 'First test task',
      repo: testDir,
    });

    const result = await factory.processNext();

    assert(result, 'Should return a result');
    assert(result.taskId, 'Result should have taskId');
    assert(result.worktreeId, 'Result should have worktreeId');
    assert(result.worktreePath, 'Result should have worktreePath');
    assert(fs.existsSync(result.worktreePath), 'Worktree path should exist');
  });

  it('should track task status transitions', async () => {
    const task = factory.submitTask({
      title: 'Status test task',
      description: 'Test status transitions',
      repo: testDir,
    });

    assert.strictEqual(task.status, 'queued');

    const result = await factory.processNext();
    const inProgressTask = factory.taskManager.get(result.taskId);
    assert.strictEqual(inProgressTask.status, 'in_progress');

    factory.completeTask(result.taskId, { success: true });
    const completedTask = factory.taskManager.get(result.taskId);
    assert.strictEqual(completedTask.status, 'completed');
  });

  it('should clean up worktree on task completion', async () => {
    const task = factory.submitTask({
      title: 'Cleanup test',
      description: 'Test worktree cleanup',
      repo: testDir,
    });

    const result = await factory.processNext();
    const worktreePath = result.worktreePath;

    assert(fs.existsSync(worktreePath), 'Worktree should exist before cleanup');

    factory.completeTask(result.taskId, { success: true });

    // Worktree should be removed
    assert(!fs.existsSync(worktreePath), 'Worktree should be removed after completion');
  });

  it('should report factory status', async () => {
    factory.submitTask({
      title: 'Status task 1',
      description: 'Task for status check',
      repo: testDir,
    });

    factory.submitTask({
      title: 'Status task 2',
      description: 'Another task for status check',
      repo: testDir,
    });

    const status = factory.status();

    assert.strictEqual(status.queued, 2, 'Should have 2 queued tasks');
    assert(status.total >= 2, 'Total should be at least 2');
  });
});
