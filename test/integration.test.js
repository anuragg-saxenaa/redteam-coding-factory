/**
 * Integration Test Orchestrator for RedTeam Coding Factory
 *
 * This script runs a series of end-to-end tests for the Coding Factory,
 * covering phases 1-5: task intake, worktree isolation, code execution,
 * agent integration (simulated), result validation, feedback loop, and push/PR creation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const CodingFactory = require('../src/factory');

// --- Configuration ---
const TEST_REPO_NAME = 'integration-test-repo';
const TEST_REPO_PATH = path.join(__dirname, TEST_REPO_NAME);
const TEST_BARE_REPO_PATH = path.join(__dirname, TEST_REPO_NAME + '.git');
const FACTORY_CONFIG = {
  baseRepo: TEST_BARE_REPO_PATH, // Point to bare repo from the start
  dataDir: path.join(TEST_REPO_PATH, '.factory-data'),
  worktreeRoot: path.join(TEST_REPO_PATH, '.worktrees'),
  validationMode: 'default',
  enablePush: false,
  createPR: false,
  gitHubCliPath: 'gh'
};

// --- Helper Functions ---
function setupTestRepo() {
  console.log(`\n--- Setting up test repository: ${TEST_REPO_PATH} ---`);
  
  // Clean up any existing repos
  if (fs.existsSync(TEST_REPO_PATH)) {
    execSync(`rm -rf ${TEST_REPO_PATH}`);
  }
  if (fs.existsSync(TEST_BARE_REPO_PATH)) {
    execSync(`rm -rf ${TEST_BARE_REPO_PATH}`);
  }

  // Create a bare repository
  execSync(`git init --bare ${TEST_BARE_REPO_PATH}`);

  // Clone it to a working directory to make an initial commit
  execSync(`git clone ${TEST_BARE_REPO_PATH} ${TEST_REPO_PATH}`);
  
  execSync(`git -C ${TEST_REPO_PATH} config user.email "test@example.com"`);
  execSync(`git -C ${TEST_REPO_PATH} config user.name "Test User"`);
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'README.md'), '# Integration Test Repo\n');
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'package.json'), JSON.stringify({
    name: "test-proj",
    version: "1.0.0",
    scripts: {
      "lint": "echo 'Linting passed.'",
      "test": "echo 'Tests passed.' && exit 0"
    }
  }, null, 2));
  execSync(`git -C ${TEST_REPO_PATH} add .`);
  execSync(`git -C ${TEST_REPO_PATH} commit -m "Initial commit for integration tests"`);
  
  // Push initial commit to bare repo
  execSync(`git -C ${TEST_REPO_PATH} push origin main`);

  console.log('Test repo setup complete.');
}

function teardownTestRepo() {
  console.log(`\n--- Tearing down test repository: ${TEST_REPO_PATH} ---`);
  if (fs.existsSync(TEST_REPO_PATH)) {
    execSync(`rm -rf ${TEST_REPO_PATH}`);
  }
  if (fs.existsSync(TEST_BARE_REPO_PATH)) {
    execSync(`rm -rf ${TEST_BARE_REPO_PATH}`);
  }
  console.log('Test repo teardown complete.');
}

async function runTest(name, testFn) {
  console.log(`\n### Running Test: ${name} ###`);
  try {
    await testFn();
    console.log(`### Test PASSED: ${name} ###`);
    return true;
  } catch (error) {
    console.error(`### Test FAILED: ${name} ###`);
    console.error(error);
    return false;
  }
}

// --- Test Scenarios ---

// Scenario 1: End-to-end dry run (no push/PR)
async function testScenario1(factory) {
  const task = factory.submitTask({
    title: 'Trivial feature addition (Dry Run)',
    description: 'Add a simple hello world function to demonstrate dry run flow.',
    repo: TEST_REPO_PATH,
    branch: 'main'
  });

  const result = await factory.processNext(false, false); // useAgent=false, doPushPR=false

  if (!result) throw new Error('Task processing failed for dry run');
  if (result.failed) throw new Error(`Task failed: ${result.executionResult.errors || result.validationResult.errors}`);

  const taskRecord = factory.taskManager.get(task.id);
  if (taskRecord.status !== 'completed') throw new Error(`Task status incorrect: ${taskRecord.status}`);
  if (fs.existsSync(result.worktreePath)) throw new Error('Worktree should have been cleaned up');
  if (!taskRecord.validationResult.valid) throw new Error('Validation should have passed');

  console.log('Scenario 1: End-to-end dry run successful.');
}

// Scenario 2: Positive push/PR run (with flags enabled, requires GitHub CLI setup)
async function testScenario2(factory) {
  // Temporarily enable push/PR
  factory.enablePush = true;
  factory.createPR = true;
  
  // Need to simulate a code change for a commit/PR
  const task = factory.submitTask({
    title: 'Positive PR Test: Add new file',
    description: 'Adding a new file via an autonomous PR.',
    repo: TEST_REPO_PATH,
    branch: 'main' // Target main for PR
  });

  // Simulate agent making a change
  // In a real agent workflow, this would be done by the agent in the worktree
  const worktreePath = path.join(FACTORY_CONFIG.worktreeRoot, 'temp-wt-id-for-pr'); // Simplified
  execSync(`git -C ${TEST_REPO_PATH} worktree add ${worktreePath} main`);
  fs.writeFileSync(path.join(worktreePath, 'new_feature.js'), 'console.log("Hello from feature!");\n');
  execSync(`git -C ${worktreePath} add new_feature.js`);
  execSync(`git -C ${worktreePath} commit -m "feat: add new_feature.js"`);
  execSync(`git -C ${TEST_REPO_PATH} worktree remove ${worktreePath}`); // Clean up temp wt


  const result = await factory.processNext(false, true); // useAgent=false, doPushPR=true

  // Reset flags
  factory.enablePush = false;
  factory.createPR = false;

  if (!result) throw new Error('Task processing failed for positive PR run');
  if (result.failed) throw new Error(`Task failed: ${result.executionResult.errors || result.validationResult.errors}`);

  const taskRecord = factory.taskManager.get(task.id);
  if (taskRecord.status !== 'completed') throw new Error(`Task status incorrect: ${taskRecord.status}`);
  if (!taskRecord.validationResult.valid) throw new Error('Validation should have passed');
  if (!result.pushPRResult || !result.pushPRResult.prUrl) throw new Error('PR was not created or URL missing');

  console.log(`Scenario 2: Positive push/PR run successful. PR URL: ${result.pushPRResult.prUrl}`);
}

// Scenario 3: Negative path (lint/test fail, CriticGate blocks, fix task enqueued)
async function testScenario3(factory) {
  const task = factory.submitTask({
    title: 'Negative Test: Lint/Test Fail',
    description: 'This task is designed to fail linting and testing.',
    repo: TEST_REPO_PATH,
    branch: 'main'
  });

  // Temporarily modify package.json in test repo to make tests fail
  const originalPackageJson = fs.readFileSync(path.join(TEST_REPO_PATH, 'package.json')).toString();
  const failingPackageJson = JSON.parse(originalPackageJson);
  failingPackageJson.scripts.test = "echo 'Tests failed intentionally.' && exit 1";
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'package.json'), JSON.stringify(failingPackageJson, null, 2));
  
  // Simulate agent making a change that passes lint but fails test (e.g. invalid logic)
  const worktreePath = path.join(FACTORY_CONFIG.worktreeRoot, 'temp-wt-id-for-fail'); // Simplified
  execSync(`git -C ${TEST_REPO_PATH} worktree add ${worktreePath} main`);
  fs.writeFileSync(path.join(worktreePath, 'bad_code.js'), 'const a = "a\n'); // Lint will fail
  execSync(`git -C ${worktreePath} add bad_code.js`);
  execSync(`git -C ${worktreePath} commit -m "feat: add bad_code.js"`);
  execSync(`git -C ${TEST_REPO_PATH} worktree remove ${worktreePath}`); // Clean up temp wt

  const result = await factory.processNext(false, true); // useAgent=false, doPushPR=true

  // Restore original package.json
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'package.json'), originalPackageJson);

  if (!result) throw new Error('Task processing failed for negative path');
  if (!result.failed) throw new Error('Task should have failed validation');

  const taskRecord = factory.taskManager.get(task.id);
  if (taskRecord.status !== 'failed') throw new Error(`Task status incorrect: ${taskRecord.status}`);
  if (taskRecord.validationResult.valid) throw new Error('Validation should have failed');
  if (!taskRecord.fixTaskId) throw new Error('Fix task should have been enqueued');

  const fixTaskRecord = factory.taskManager.get(taskRecord.fixTaskId);
  if (!fixTaskRecord || !fixTaskRecord.isFixTask) throw new Error('Enqueued task is not a valid fix task');
  
  console.log('Scenario 3: Negative path (validation fail, fix task enqueued) successful.');
}

// Scenario 4: Force mode auditability
async function testScenario4(factory) {
  factory.enablePush = true; // Need to enable push to test force mode
  
  const task = factory.submitTask({
    title: 'Force Mode Test: Skip failing checks',
    description: 'This task will fail checks but will be pushed/PRd using force mode.',
    repo: TEST_REPO_PATH,
    branch: 'main'
  });

  // Simulate agent making a change that fails tests
  const worktreePath = path.join(FACTORY_CONFIG.worktreeRoot, 'temp-wt-id-for-force'); // Simplified
  execSync(`git -C ${TEST_REPO_PATH} worktree add ${worktreePath} main`);
  fs.writeFileSync(path.join(worktreePath, 'failing_test_code.js'), 'throw new Error("Forced failure");\n');
  execSync(`git -C ${worktreePath} add failing_test_code.js`);
  execSync(`git -C ${worktreePath} commit -m "feat: add failing_test_code.js"`);
  execSync(`git -C ${TEST_REPO_PATH} worktree remove ${worktreePath}`); // Clean up temp wt


  // Manually process with forceMode (this would typically be a config override)
  // For this test, we'll call createPushPR directly with forceMode
  const evaluation = factory.criticGate.evaluate(factory.taskManager.get(task.id));
  if (evaluation.canPush) throw new Error('CriticGate should have blocked without force mode');

  const pushPRResult = factory.pushPRManager.createPushPR(factory.taskManager.get(task.id), { forceMode: true, createPR: false });

  if (!pushPRResult.success) throw new Error('Push/PR should have succeeded with force mode');

  const taskRecord = factory.taskManager.get(task.id);
  if (!taskRecord.forceOverrides || taskRecord.forceOverrides.length === 0) {
    throw new Error('Force override was not logged to task record');
  }

  console.log('Scenario 4: Force mode auditability successful.');

  factory.enablePush = false; // Reset
}


// --- Main Execution ---
async function main() {
  setupTestRepo();
  const factory = new CodingFactory(FACTORY_CONFIG);

  const tests = [
    () => testScenario1(factory),
    () => testScenario2(factory), // Requires gh CLI configured and permission to create PRs
    () => testScenario3(factory),
    () => testScenario4(factory),
  ];

  let allTestsPassed = true;
  for (const test of tests) {
    const passed = await runTest(test.name || 'Anonymous Test', test);
    if (!passed) {
      allTestsPassed = false;
      // break; // Stop on first failure if desired
    }
  }

  if (allTestsPassed) {
    console.log('\n=== All Integration Tests PASSED! ===');
  } else {
    console.error('\n=== Some Integration Tests FAILED! ===');
  }

  teardownTestRepo();
}

main().catch(console.error);
