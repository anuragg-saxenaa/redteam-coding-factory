/**
 * Integration Test Suite for Coding Factory Phases 1-5
 * Simplified version using WorktreeManager APIs exclusively
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const CodingFactory = require('../src/factory');

const TEST_REPO_NAME = 'integration-test-repo';
const TEST_REPO_PATH = path.join(__dirname, TEST_REPO_NAME);
const TEST_BARE_REPO_PATH = path.join(__dirname, TEST_REPO_NAME + '.git');

const FACTORY_CONFIG = {
  baseRepo: TEST_BARE_REPO_PATH,
  dataDir: path.join(TEST_REPO_PATH, '.factory-data'),
  worktreeRoot: path.join(TEST_REPO_PATH, '.worktrees'),
  validationMode: 'default',
  enablePush: false,
  createPR: false,
  gitHubCliPath: 'gh'
};

function setupTestRepo() {
  console.log(`\n--- Setting up test repository ---`);
  if (fs.existsSync(TEST_REPO_PATH)) execSync(`rm -rf ${TEST_REPO_PATH}`);
  if (fs.existsSync(TEST_BARE_REPO_PATH)) execSync(`rm -rf ${TEST_BARE_REPO_PATH}`);

  execSync(`git init --bare ${TEST_BARE_REPO_PATH}`);
  execSync(`git clone ${TEST_BARE_REPO_PATH} ${TEST_REPO_PATH}`);
  execSync(`git -C ${TEST_REPO_PATH} config user.email "test@example.com"`);
  execSync(`git -C ${TEST_REPO_PATH} config user.name "Test User"`);
  
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'README.md'), '# Test Repo\n');
  fs.writeFileSync(path.join(TEST_REPO_PATH, 'package.json'), JSON.stringify({
    name: "test-proj",
    version: "1.0.0",
    scripts: { "lint": "echo 'Lint OK'", "test": "echo 'Tests OK' && exit 0" }
  }, null, 2));
  
  execSync(`git -C ${TEST_REPO_PATH} add .`);
  execSync(`git -C ${TEST_REPO_PATH} commit -m "Initial commit"`);
  execSync(`git -C ${TEST_REPO_PATH} push origin main`);
  console.log('Test repo setup complete.');
}

function teardownTestRepo() {
  console.log(`\n--- Tearing down test repository ---`);
  if (fs.existsSync(TEST_REPO_PATH)) execSync(`rm -rf ${TEST_REPO_PATH}`);
  if (fs.existsSync(TEST_BARE_REPO_PATH)) execSync(`rm -rf ${TEST_BARE_REPO_PATH}`);
  console.log('Test repo teardown complete.');
}

async function test1_DryRun(factory) {
  console.log('\n### Test 1: Dry Run (no push/PR) ###');
  const task = factory.submitTask({
    title: 'Dry Run Task',
    description: 'Test worktree → execute → validate → cleanup',
    repo: TEST_BARE_REPO_PATH,
    branch: 'main'
  });

  const result = await factory.processNext(false, false);
  if (!result || result.failed) throw new Error('Dry run failed');
  if (!result.validationResult.valid) throw new Error('Validation should pass');
  console.log('✓ Test 1 passed');
}

async function test2_PositivePR(factory) {
  console.log('\n### Test 2: Positive PR (validation passes) ###');
  factory.enablePush = true;
  factory.createPR = true;

  const task = factory.submitTask({
    title: 'Positive PR Task',
    description: 'Test successful PR creation',
    repo: TEST_BARE_REPO_PATH,
    branch: 'main'
  });

  const result = await factory.processNext(false, true);
  if (!result || result.failed) throw new Error('Positive PR test failed');
  if (!result.validationResult.valid) throw new Error('Validation should pass');
  
  factory.enablePush = false;
  factory.createPR = false;
  console.log('✓ Test 2 passed');
}

async function test3_NegativePath(factory) {
  console.log('\n### Test 3: Negative Path (validation fails, fix task enqueued) ###');
  const task = factory.submitTask({
    title: 'Negative Path Task',
    description: 'Test validation failure + fix task enqueue',
    repo: TEST_BARE_REPO_PATH,
    branch: 'main'
  });

  // Temporarily break tests in the repo
  const pkgPath = path.join(TEST_REPO_PATH, 'package.json');
  const origPkg = fs.readFileSync(pkgPath).toString();
  const badPkg = JSON.parse(origPkg);
  badPkg.scripts.test = "exit 1";
  fs.writeFileSync(pkgPath, JSON.stringify(badPkg, null, 2));
  execSync(`git -C ${TEST_REPO_PATH} add package.json && git -C ${TEST_REPO_PATH} commit -m "Break tests" && git -C ${TEST_REPO_PATH} push origin main`);

  const result = await factory.processNext(false, false);
  if (!result || !result.failed) throw new Error('Should have failed validation');
  if (!result.fixTaskId) throw new Error('Fix task should be enqueued');

  // Restore
  fs.writeFileSync(pkgPath, origPkg);
  execSync(`git -C ${TEST_REPO_PATH} add package.json && git -C ${TEST_REPO_PATH} commit -m "Fix tests" && git -C ${TEST_REPO_PATH} push origin main`);
  
  console.log('✓ Test 3 passed');
}

async function test4_ForceMode(factory) {
  console.log('\n### Test 4: Force Mode (override with logging) ###');
  factory.enablePush = true;

  const task = factory.submitTask({
    title: 'Force Mode Task',
    description: 'Test force override',
    repo: TEST_BARE_REPO_PATH,
    branch: 'main'
  });

  // Manually test force mode on CriticGate
  const evaluation = factory.criticGate.evaluate(factory.taskManager.get(task.id));
  if (!evaluation.canPush) {
    factory.criticGate.logForceOverride(task.id, 'Test force override');
    const taskRecord = factory.taskManager.get(task.id);
    if (!taskRecord.forceOverrides || taskRecord.forceOverrides.length === 0) {
      throw new Error('Force override not logged');
    }
  }

  factory.enablePush = false;
  console.log('✓ Test 4 passed');
}

async function main() {
  setupTestRepo();
  const factory = new CodingFactory(FACTORY_CONFIG);

  try {
    await test1_DryRun(factory);
    await test2_PositivePR(factory);
    await test3_NegativePath(factory);
    await test4_ForceMode(factory);
    console.log('\n=== ALL TESTS PASSED ===');
  } catch (error) {
    console.error('\n=== TEST FAILED ===');
    console.error(error);
    process.exit(1);
  } finally {
    teardownTestRepo();
  }
}

main();
