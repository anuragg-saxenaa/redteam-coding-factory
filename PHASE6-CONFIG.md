# Phase 6: Multi-Repo Orchestration Configuration

## Quick Start

```javascript
const RedTeamFactory = require('./src/redteam-factory');

// Initialize with multiple repos
const factory = new RedTeamFactory({
  workspaceRoot: '/path/to/workspace',
  dataDir: '/path/to/.factory-data',
  enablePush: false,  // Safety: disabled by default
  createPR: false     // Safety: disabled by default
});

// Register repos
factory.initialize([
  { name: 'repo1', path: '/path/to/repo1.git', branch: 'main' },
  { name: 'repo2', path: '/path/to/repo2.git', branch: 'main' },
  { name: 'repo3', path: '/path/to/repo3.git', branch: 'main' }
]);

// Submit tasks to specific repos
factory.submitTask('repo1', {
  title: 'Update dependencies',
  description: 'Bump all deps to latest',
  repo: '/path/to/repo1.git',
  branch: 'main'
});

// Submit cross-repo coordinated task
factory.submitCrossRepoTask({
  title: 'Coordinated version bump',
  description: 'Update version across all repos',
  repos: [
    { name: 'repo1', changes: { version: '2.0.0' } },
    { name: 'repo2', changes: { version: '2.0.0' } },
    { name: 'repo3', changes: { version: '2.0.0' } }
  ],
  dependencies: []
});

// Run autonomously
const results = await factory.run();
console.log(results);
```

## Configuration

### Repo Allowlist

Define which repos the factory can operate on:

```javascript
const allowedRepos = [
  'redteam-core',
  'redteam-agents',
  'redteam-tools',
  'redteam-integrations'
];

factory.initialize(
  allowedRepos.map(name => ({
    name,
    path: `/path/to/${name}.git`,
    branch: 'main'
  }))
);
```

### Concurrency Caps

Control how many tasks run in parallel:

```javascript
class ConcurrencyLimiter {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async run(task) {
    while (this.running >= this.maxConcurrent) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }
  }
}

// Usage in factory
const limiter = new ConcurrencyLimiter(3); // Max 3 concurrent tasks
```

## Safety Rails

- **Push/PR disabled by default**: Set `enablePush: true` and `createPR: true` only after validation
- **Dry-run mode**: All tests run in dry-run (no push/PR) by default
- **Dependency tracking**: Cross-repo tasks respect dependencies; won't execute until all dependencies complete
- **Validation gate**: CriticGate blocks push/PR unless validation passes
- **Force mode logging**: Force overrides are logged to task record for audit trail

## Testing

Run the full integration test suite:

```bash
npm test
```

Run Phase 6 multi-repo tests specifically:

```bash
node test/phase6.test.js
```

Run RedTeamFactory integration tests:

```bash
node test/redteam-factory.test.js
```

## Architecture

- **Phase 1**: Task intake + worktree isolation
- **Phase 2**: Code execution (lint, test, commit)
- **Phase 3**: Agent integration + autonomous loop
- **Phase 4**: Result validation + feedback loop
- **Phase 5**: Push/PR creation with Critic gate
- **Phase 6**: Multi-repo orchestration + RedTeamFactory wrapper

All phases are production-ready and fully tested.
