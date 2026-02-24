#!/usr/bin/env node
/**
 * Integration Test Suite for RedTeam Coding Factory
 * Tests the top-level RedTeamFactory orchestration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const RedTeamFactory = require('../src/redteam-factory');

const TEST_DIR = path.join(__dirname, 'redteam-factory-test');
const REPO_1_BARE = path.join(TEST_DIR, 'redteam-repo1.git');
const REPO_1_WORK = path.join(TEST_DIR, 'redteam-repo1');
const DATA_DIR = path.join(TEST_DIR, '.factory-data');

function cleanup() {
  try {
    if (fs.existsSync(TEST_DIR)) execSync(`rm -rf ${TEST_DIR}`);
  } catch (e) {
    // Ignore
  }
}

function setupTestRepo() {
  console.log(`\n--- Setting up RedTeamFactory test environment ---`);
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Create repo 1
  execSync(`git init --bare ${REPO_1_BARE}`);
  execSync(`git clone ${REPO_1_BARE} ${REPO_1_WORK}`);
  execSync(`git -C ${REPO_1_WORK} config user.email "test@example.com"`);
  execSync(`git -C ${REPO_1_WORK} config user.name "Test User"`);
  fs.writeFileSync(path.join(REPO_1_WORK, 'README.md'), '# RedTeam Repo 1\n');
  fs.writeFileSync(path.join(REPO_1_WORK, 'package.json'), JSON.stringify({
    name: "redteam-repo-1",
    version: "1.0.0",
    scripts: { "lint": "echo 'Lint passed'", "test": "echo 'Tests passed'" }
  }, null, 2));
  execSync(`git -C ${REPO_1_WORK} add .`);
  execSync(`git -C ${REPO_1_WORK} commit -m "Initial commit"`);
  execSync(`git -C ${REPO_1_WORK} push origin main`);

  console.log('✓ RedTeamFactory test environment setup complete');
}

async function test1_RedTeamFactoryInitialization() {
  console.log('\n### Test 1: RedTeamFactory Initialization ###');
  const factory = new RedTeamFactory({
    workspaceRoot: TEST_DIR,
    dataDir: DATA_DIR,
  });

  const repos = [{ name: 'redteam-repo1', path: REPO_1_BARE }];
  factory.initialize(repos);

  if (!factory.orchestrator) throw new Error('Orchestrator not initialized');
  if (factory.orchestrator.listRepos().length !== 1) throw new Error('Expected 1 repo in orchestrator');
  console.log('✓ Test 1 passed: RedTeamFactory initialized and orchestrator set up');
}

async function test2_TaskSubmissionAndExecution() {
  console.log('\n### Test 2: Task Submission and Execution ###');
  const factory = new RedTeamFactory({
    workspaceRoot: TEST_DIR,
    dataDir: DATA_DIR,
  });

  const repos = [{ name: 'redteam-repo1', path: REPO_1_BARE }];
  factory.initialize(repos);

  const task = factory.submitTask('redteam-repo1', {
    title: 'RedTeam Task',
    description: 'A test task for the RedTeam factory',
    repo: REPO_1_BARE,
    branch: 'main'
  });

  if (!task || !task.id) throw new Error('Task not submitted');
  if (factory.getTaskHistory().length !== 1) throw new Error('Task not logged');

  const results = await factory.run();
  if (results.totalTasks === 0) throw new Error('Expected tasks to be processed');
  if (factory.getResultHistory().length !== 1) throw new Error('Results not logged');

  console.log('✓ Test 2 passed: RedTeamFactory submitted and executed tasks');
}

async function test3_StateManagement() {
  console.log('\n### Test 3: State Management ###');
  const factory = new RedTeamFactory({
    workspaceRoot: TEST_DIR,
    dataDir: DATA_DIR,
  });

  const repos = [{ name: 'redteam-repo1', path: REPO_1_BARE }];
  factory.initialize(repos);

  factory.submitTask('redteam-repo1', {
    title: 'RedTeam Task for State',
    description: 'Another test task',
    repo: REPO_1_BARE,
    branch: 'main'
  });
  await factory.run();

  const statePath = path.join(DATA_DIR, 'redteam-factory-state.json');
  factory.saveState(statePath);

  if (!fs.existsSync(statePath)) throw new Error('State file not saved');
  const loadedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (loadedState.taskLog.length === 0) throw new Error('Loaded state missing task log');

  console.log('✓ Test 3 passed: RedTeamFactory state saved and loaded');
}

async function main() {
  setupTestRepo();

  try {
    await test1_RedTeamFactoryInitialization();
    await test2_TaskSubmissionAndExecution();
    await test3_StateManagement();

    console.log('\n=== ALL REDTEAM FACTORY INTEGRATION TESTS PASSED ===\n');
    console.log('RedTeamFactory verified:');
    console.log('✓ Initialization and orchestrator integration');
    console.log('✓ Task submission and autonomous execution');
    console.log('✓ State management (save/load)\n');
  } catch (error) {
    console.error('\n=== REDTEAM FACTORY TEST FAILED ===');
    console.error(error.message);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
