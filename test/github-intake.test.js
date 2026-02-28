/**
 * GitHubIntake unit tests
 * Tests construction, issue-to-task conversion, and deduplication logic.
 * Does NOT call gh CLI (those are integration tests requiring auth).
 */

const GitHubIntake = require('../src/github-intake');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// Test 1: Default construction
console.log('Test 1: Default construction');
{
  const intake = new GitHubIntake({ repo: 'owner/repo' });
  assert(intake.repo === 'owner/repo', 'repo set');
  assert(intake.label === 'factory-ready', 'default label');
  assert(intake.limit === 5, 'default limit');
  assert(intake.claimLabel === 'factory-in-progress', 'default claimLabel');
  assert(intake.autoClaim === true, 'default autoClaim');
}

// Test 2: Custom options
console.log('Test 2: Custom options');
{
  const intake = new GitHubIntake({
    repo: 'org/project',
    label: 'bug',
    assignee: 'alice',
    limit: 10,
    claimLabel: 'wip',
    autoClaim: false,
  });
  assert(intake.repo === 'org/project', 'custom repo');
  assert(intake.label === 'bug', 'custom label');
  assert(intake.assignee === 'alice', 'custom assignee');
  assert(intake.limit === 10, 'custom limit');
  assert(intake.claimLabel === 'wip', 'custom claimLabel');
  assert(intake.autoClaim === false, 'autoClaim disabled');
}

// Test 3: issueToTask conversion
console.log('Test 3: issueToTask conversion');
{
  const intake = new GitHubIntake({ repo: 'owner/repo' });
  const issue = {
    number: 42,
    title: 'Fix login crash',
    body: 'When a user clicks login, the app crashes.\nSteps to reproduce...',
    labels: [{ name: 'bug' }, { name: 'factory-ready' }],
    assignees: [{ login: 'bob' }],
    url: 'https://github.com/owner/repo/issues/42',
  };
  const task = intake.issueToTask(issue, '/repos/myproject', 'develop');

  assert(task.title === 'GH-42: Fix login crash', 'task title includes issue number');
  assert(task.description.includes('clicks login'), 'task description from issue body');
  assert(task.repo === '/repos/myproject', 'task repo set');
  assert(task.branch === 'develop', 'task branch set');
  assert(task.metadata.source === 'github', 'metadata source is github');
  assert(task.metadata.issueNumber === 42, 'metadata issueNumber');
  assert(task.metadata.issueUrl === 'https://github.com/owner/repo/issues/42', 'metadata issueUrl');
  assert(task.metadata.labels.includes('bug'), 'metadata includes labels');
}

// Test 4: issueToTask with empty body
console.log('Test 4: issueToTask with empty body');
{
  const intake = new GitHubIntake({ repo: 'owner/repo' });
  const issue = { number: 1, title: 'No body issue', body: null, labels: [], url: '' };
  const task = intake.issueToTask(issue, '/repos/x');
  assert(task.description === '', 'empty body → empty description');
}

// Test 5: issueToTask truncates long body
console.log('Test 5: issueToTask truncates long body');
{
  const intake = new GitHubIntake({ repo: 'owner/repo' });
  const longBody = 'x'.repeat(5000);
  const issue = { number: 99, title: 'Long', body: longBody, labels: [], url: '' };
  const task = intake.issueToTask(issue, '/repos/x');
  assert(task.description.length === 2000, 'body truncated to 2000 chars');
}

// Test 6: Deduplication via _claimed set
console.log('Test 6: Deduplication via _claimed set');
{
  const intake = new GitHubIntake({ repo: 'owner/repo' });
  assert(!intake._claimed.has(1), 'issue 1 not claimed yet');
  intake._claimed.add(1);
  assert(intake._claimed.has(1), 'issue 1 claimed after add');
  assert(!intake._claimed.has(2), 'issue 2 still unclaimed');
}

// Test 7: fetchIssues requires repo
console.log('Test 7: fetchIssues requires repo');
{
  const intake = new GitHubIntake({});
  let threw = false;
  try {
    intake.fetchIssues();
  } catch (e) {
    threw = true;
    assert(e.message.includes('repo is required'), 'error says repo is required');
  }
  assert(threw, 'throws without repo');
}

// Test 8: isAuthenticated returns boolean
console.log('Test 8: isAuthenticated returns boolean');
{
  const intake = new GitHubIntake({ repo: 'owner/repo' });
  const result = intake.isAuthenticated();
  assert(typeof result === 'boolean', 'isAuthenticated returns boolean');
}

// Test 9: Default branch in issueToTask
console.log('Test 9: Default branch in issueToTask');
{
  const intake = new GitHubIntake({ repo: 'owner/repo' });
  const issue = { number: 10, title: 'Test', body: 'body', labels: [], url: '' };
  const task = intake.issueToTask(issue, '/repos/x');
  assert(task.branch === 'main', 'default branch is main');
}

console.log(`\n=== GitHubIntake Tests: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
