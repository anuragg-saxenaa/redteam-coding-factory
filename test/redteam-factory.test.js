#!/usr/bin/env node
/**
 * Integration Test Suite for RedTeam Coding Factory
 * Tests the top-level RedTeamFactory orchestration
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { RedTeamFactory } from '../src/redteam-factory.js';

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
  execSync(`git -C ${REPO_1_WORK} config init.defaultBranch main`);
  fs.writeFileSync(path.join(REPO_1_WORK, 'README.md'), '# RedTeam Repo 1\n');
  fs.writeFileSync(path.join(REPO_1_WORK, 'package.json'), JSON.stringify({
    name: "redteam-repo-1",
    version: "1.0.0",
    scripts: { "lint": "echo 'Lint passed'", "test": "echo 'Tests passed'" }
  }, null, 2));

  execSync(`git -C ${REPO_1_WORK} add .`);
  execSync(`git -C ${REPO_1_WORK} commit -m "Initial commit"`);
  execSync(`git -C ${REPO_1_WORK} branch -M main`);
  execSync(`git -C ${REPO_1_WORK} push origin main`);

  console.log('✓ Test repo setup complete');
}

async function main() {
  setupTestRepo();

  try {
    const factory = new RedTeamFactory({
      baseRepo: REPO_1_BARE,
      dataDir: DATA_DIR,
      worktreeRoot: path.join(TEST_DIR, '.worktrees'),
    });

    // Verify construction
    const status = factory.status();
    assert(status, 'factory should report status');

    console.log('\n=== ALL REDTEAM FACTORY TESTS PASSED ===\n');
  } catch (error) {
    console.error('\n=== TEST FAILED ===');
    console.error(error.message);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
