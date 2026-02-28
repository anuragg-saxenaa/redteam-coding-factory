# RedTeam Coding Factory

Autonomous coding factory with multi-repo orchestration. Phases 1-6 complete and production-ready.

## Quick Start

### CLI (Recommended for Production)

```bash
# Install globally or use npx
npm install -g redteam-coding-factory

# Run with config file
redteam-factory run --config factory.config.json

# Run with config + custom tasks
redteam-factory run --config factory.config.json --tasks tasks.json

# Show help
redteam-factory --help
```

### CI/CD Integration (Production)

```bash
# Use the CI/CD entrypoint script
cd scripts/
./redteam-ci-cd.sh
```

### Programmatic (Node.js)

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

## CI/CD Configuration

### Factory Configuration

Create `factory.config.json` in your project root:

```json
{
  "pipeline": "git",
  "version": "1.0.0",
  "tasks": [
    "build",
    "test",
    "deploy"
  ],
  "environment": {
    "node_version": "20",
    "python_version": "3.11"
  }
}
```

### Task Definitions

Create `tasks.json` to define specific commands for each task:

```json
{
  "build": {
    "description": "Build the project",
    "commands": [
      "npm install",
      "npm run build"
    ]
  },
  "test": {
    "description": "Run tests",
    "commands": [
      "npm test"
    ]
  },
  "deploy": {
    "description": "Deploy to production",
    "commands": [
      "npm run deploy"
    ]
  }
}
```

### CI/CD Entrypoint

The CI/CD entrypoint script (`scripts/redteam-ci-cd.sh`) provides production-ready execution:

```bash
cd scripts/
./redteam-ci-cd.sh
```

This script includes:
- Input validation for config files
- Logging to timestamped files
- Error handling and exit codes
- Production-ready execution

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

Metrics are written to `dataDir/metrics.json` (runtime state) so test runs don't dirty the git repo.

All 3 test suites pass:
- `test/integration.test.js` — Phases 1-5
- `test/phase6.test.js` — Multi-repo orchestration
- `test/redteam-factory.test.js` — Production integration

## Safety Rails

- **Push/PR disabled by default** — explicitly enable in config
- **Critic gate** — validates results before push/PR
- **Force mode logging** — audit trail for overrides
- **Dry-run mode** — test without side effects

## Production Deployment

See [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md) for detailed deployment instructions.