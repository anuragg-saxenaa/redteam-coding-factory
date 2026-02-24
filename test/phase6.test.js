#!/usr/bin/env node
/**
 * Integration Test Suite for Coding Factory Phase 6 — Multi-Repo Orchestration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const MultiRepoOrchestrator = require('../src/multi-repo-orchestrator');

const TEST_DIR = path.join(__dirname, 'phase6-test-repos');
const REPO_1_BARE = path.join(TEST_DIR, 'repo1.git');
const REPO_1_WORK = path.join(TEST_DIR, 'repo1');
const REPO_2_BARE = path.join(TEST_DIR, 'repo2.git');
const REPO_2_WORK = path.join(TEST_DIR, 'repo2');
const DATA_DIR = path.join(TEST_DIR, '.factory-data');

function cleanup() {
  try {
    if (fs.existsSync(TEST_DIR)) execSync(`rm -rf ${TEST_DIR}`);
  } catch (e) {
    // Ignore
  }
}

function setupTestRepos() {
  console.log(`\n--- Setting up multi-repo test environment ---`);
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Create repo 1
  execSync(`git init --bare ${REPO_1_BARE}`);
  execSync(`git clone ${REPO_1_BARE} ${REPO_1_WORK}`);
  execSync(`git -C ${REPO_1_WORK} config user.email "test@example.com"`);
  execSync(`git -C ${REPO_1_WORK} config user.name "Test User"`);
  fs.writeFileSync(path.join(REPO_1_WORK, 'README.md'), '# Repo 1\n');
  fs.writeFileSync(path.join(REPO_1_WORK, 'package.json'), JSON.stringify({
    name: "repo-1",
    version: "1.0.0",
    scripts: { "lint": "echo 'Lint passed'", "test": "echo 'Tests passed'" }
  }, null, 2));
  execSync(`git -C ${REPO_1_WORK} add .`);
  execSync(`git -C ${REPO_1_WORK} commit -m "Initial commit"`);
  execSync(`git -C ${REPO_1_WORK} push origin main`);

  // Create repo 2
  execSync(`git init --bare ${REPO_2_BARE}`);
  execSync(`git clone ${REPO_2_BARE} ${REPO_2_WORK}`);
  execSync(`git -C ${REPO_2_WORK} config user.email "test@example.com"`);
  execSync(`git -C ${REPO_2_WORK} config user.name "Test User"`);
  fs.writeFileSync(path.join(REPO_2_WORK, 'README.md'), '# Repo 2\n');
  fs.writeFileSync(path.join(REPO_2_WORK, 'package.json'), JSON.stringify({
    name: "repo-2",
    version: "1.0.0",
    scripts: { "lint": "echo 'Lint passed'", "test": "echo 'Tests passed'" }
  }, null, 2));
  execSync(`git -C ${REPO_2_WORK} add .`);
  execSync(`git -C ${REPO_2_WORK} commit -m "Initial commit"`);
  execSync(`git -C ${REPO_2_WORK} push origin main`);

  console.log('✓ Multi-repo test environment setup complete');
}

async function test1_MultiRepoRegistration() {
  console.log('\n### Test 1: Multi-Repo Registration ###');
  const orchestrator = new MultiRepoOrchestrator({
    repos: [
      { name: 'repo1', path: REPO_1_BARE, branch: 'main' },
      { name: 'repo2', path: REPO_2_BARE, branch: 'main' }
    ],
    dataDir: DATA_DIR
  });

  const repos = orchestrator.listRepos();
  if (repos.length !== 2) throw new Error('Expected 2 repos registered');
  if (!repos.includes('repo1') || !repos.includes('repo2')) throw new Error('Repos not registered correctly');
  console.log('✓ Test 1 passed: multi-repo registration verified');
}

async function test2_SingleRepoTasks() {
  console.log('\n### Test 2: Single-Repo Tasks ###');
  const orchestrator = new MultiRepoOrchestrator({
    repos: [
      { name: 'repo1', path: REPO_1_BARE, branch: 'main' },
      { name: 'repo2', path: REPO_2_BARE, branch: 'main' }
    ],
    dataDir: DATA_DIR
  });

  // Submit tasks to different repos
  const task1 = orchestrator.submitTask('repo1', {
    title: 'Task for Repo 1',
    description: 'Test task',
    repo: REPO_1_BARE,
    branch: 'main'
  });

  const task2 = orchestrator.submitTask('repo2', {
    title: 'Task for Repo 2',
    description: 'Test task',
    repo: REPO_2_BARE,
    branch: 'main'
  });

  if (!task1 || !task2) throw new Error('Tasks not submitted');
  if (orchestrator.globalTaskQueue.length !== 2) throw new Error('Expected 2 tasks in queue');
  console.log('✓ Test 2 passed: single-repo tasks submitted to multiple repos');
}

async function test3_CrossRepoTask() {
  console.log('\n### Test 3: Cross-Repo Task ###');
  const orchestrator = new MultiRepoOrchestrator({
    repos: [
      { name: 'repo1', path: REPO_1_BARE, branch: 'main' },
      { name: 'repo2', path: REPO_2_BARE, branch: 'main' }
    ],
    dataDir: DATA_DIR
  });

  const crossRepoTask = orchestrator.submitCrossRepoTask({
    title: 'Coordinated Update Across Repos',
    description: 'Update version in both repos',
    repos: [
      { name: 'repo1', changes: { file: 'package.json', field: 'version', value: '1.1.0' } },
      { name: 'repo2', changes: { file: 'package.json', field: 'version', value: '1.1.0' } }
    ],
    dependencies: []
  });

  if (!crossRepoTask || !crossRepoTask.id) throw new Error('Cross-repo task not created');
  if (!crossRepoTask.id.startsWith('cross-repo-')) throw new Error('Invalid cross-repo task ID');
  console.log('✓ Test 3 passed: cross-repo task created');
}

async function test4_DependencyTracking() {
  console.log('\n### Test 4: Dependency Tracking ###');
  const orchestrator = new MultiRepoOrchestrator({
    repos: [
      { name: 'repo1', path: REPO_1_BARE, branch: 'main' },
      { name: 'repo2', path: REPO_2_BARE, branch: 'main' }
    ],
    dataDir: DATA_DIR
  });

  // Submit task 1
  const task1 = orchestrator.submitTask('repo1', {
    title: 'Task 1',
    description: 'First task',
    repo: REPO_1_BARE,
    branch: 'main'
  });

  // Submit task 2 that depends on task 1
  const task2 = orchestrator.submitCrossRepoTask({
    title: 'Task 2 (depends on Task 1)',
    description: 'Second task',
    repos: [{ name: 'repo1', changes: {} }],
    dependencies: [task1.id]
  });

  if (!orchestrator.dependencyGraph.has(task1.id)) {
    throw new Error('Dependency not tracked');
  }

  const dependents = orchestrator.dependencyGraph.get(task1.id);
  if (!dependents.includes(task2.id)) {
    throw new Error('Dependent task not registered');
  }

  console.log('✓ Test 4 passed: dependency tracking verified');
}

async function test5_AutonomousLoop() {
  console.log('\n### Test 5: Autonomous Loop (Multi-Repo) ###');
  const orchestrator = new MultiRepoOrchestrator({
    repos: [
      { name: 'repo1', path: REPO_1_BARE, branch: 'main' },
      { name: 'repo2', path: REPO_2_BARE, branch: 'main' }
    ],
    dataDir: DATA_DIR
  });

  // Submit tasks to both repos
  orchestrator.submitTask('repo1', {
    title: 'Repo 1 Task',
    description: 'Test',
    repo: REPO_1_BARE,
    branch: 'main'
  });

  orchestrator.submitTask('repo2', {
    title: 'Repo 2 Task',
    description: 'Test',
    repo: REPO_2_BARE,
    branch: 'main'
  });

  // Run autonomous loop
  const results = await orchestrator.startAutonomousLoop();

  if (results.totalTasks < 2) {
    throw new Error('Expected at least 2 tasks to complete');
  }

  console.log(`✓ Test 5 passed: autonomous loop processed ${results.totalTasks} tasks`);
}

async function main() {
  setupTestRepos();

  try {
    await test1_MultiRepoRegistration();
    await test2_SingleRepoTasks();
    await test3_CrossRepoTask();
    await test4_DependencyTracking();
    await test5_AutonomousLoop();

    console.log('\n=== ALL PHASE 6 TESTS PASSED ===\n');
    console.log('Phase 6 verified:');
    console.log('✓ Multi-repo registration');
    console.log('✓ Single-repo task distribution');
    console.log('✓ Cross-repo task coordination');
    console.log('✓ Dependency tracking');
    console.log('✓ Autonomous loop across repos\n');
  } catch (error) {
    console.error('\n=== TEST FAILED ===');
    console.error(error.message);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
