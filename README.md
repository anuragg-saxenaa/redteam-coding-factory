# RedTeam Coding Factory

Autonomous coding factory with multi-repo orchestration. Phases 1-6 complete and production-ready.

## Quick Start

```javascript
const RedTeamFactory = require('./src/redteam-factory');

const factory = new RedTeamFactory({
  workspaceRoot: '/path/to/workspace',
  dataDir: '/path/to/.factory-data',
  enablePush: false,      // Safety: disabled by default
  createPR: false         // Safety: disabled by default
});

// Register repos
factory.initialize([
  { name: 'repo1', path: '/path/to/repo1.git', branch: 'main' },
  { name: 'repo2', path: '/path/to/repo2.git', branch: 'main' }
]);

// Submit tasks
factory.submitTask('repo1', {
  title: 'Fix bug in repo1',
  description: 'Details here',
  repo: '/path/to/repo1.git',
  branch: 'main'
});

// Run autonomously
const results = await factory.run();
console.log(results);
```

## Configuration

### Repo Allowlist

Define which repos the factory can access:

```javascript
const repos = [
  { name: 'core', path: '/repos/core.git', branch: 'main' },
  { name: 'api', path: '/repos/api.git', branch: 'main' },
  { name: 'web', path: '/repos/web.git', branch: 'main' }
];

factory.initialize(repos);
```

### Concurrency Caps

Control how many tasks run in parallel (per repo):

```javascript
// Modify MultiRepoOrchestrator to add concurrency control:
class MultiRepoOrchestrator {
  constructor(config = {}) {
    this.maxConcurrentTasks = config.maxConcurrentTasks || 1; // Default: serial
    this.activeTasks = new Map(); // repoName → count
  }

  async processNext() {
    // Check concurrency cap before processing
    for (const [repoName, factory] of this.factories) {
      const activeCount = this.activeTasks.get(repoName) || 0;
      if (activeCount < this.maxConcurrentTasks) {
        // Process task for this repo
      }
    }
  }
}
```

## Architecture

- **Phase 1**: Task intake + worktree isolation
- **Phase 2**: Code execution (lint, test, commit)
- **Phase 3**: Agent integration + autonomous loop
- **Phase 4**: Result validation + feedback loop
- **Phase 5**: Push/PR creation with Critic gate
- **Phase 6**: Multi-repo orchestration + RedTeamFactory wrapper

## Testing

```bash
npm test
```

All 3 test suites pass:
- `test/integration.test.js` — Phases 1-5
- `test/phase6.test.js` — Multi-repo orchestration
- `test/redteam-factory.test.js` — Production integration

## Safety Rails

- **Push/PR disabled by default** — explicitly enable in config
- **Critic gate** — validates results before push/PR
- **Force mode logging** — audit trail for overrides
- **Dry-run mode** — test without side effects
