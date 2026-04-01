# 🏭 RedTeam Coding Factory

> Autonomous coding factory with multi-repo orchestration — Phases 1–6 complete and production-deployed.

[![Tests](https://img.shields.io/badge/tests-3%20suites%20passing-brightgreen)](#testing)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)

---

## 🚀 What Is This?

**RedTeam Coding Factory** is a production-grade, autonomous software engineering pipeline. It watches GitHub repos for issues, implements fixes using AI agents, runs lint/test gates, and opens pull requests — all without human intervention.

It runs 24/7 inside the **OpenClaw RedOS** infrastructure and currently manages contributions across multiple open-source repositories.

---

## ⚡ Live Production Status

The factory is actively running the following autonomous workers:

| Worker | Description | Schedule |
|---|---|---|
| **9router IssueWatcher** | Polls `decolua/9router`, picks fixable issues, implements fixes, opens PRs | Every 15 min |
| **Self-Healing Monitor** | Checks PR CI status and auto-fixes failures | Every 4 hours |
| **OSS Contributor** | Finds OSS repos with 5000+ stars and contributes fixes | Daily |

**Autonomously created PRs:** [#387](https://github.com/decolua/9router/pull/387) · [#394](https://github.com/decolua/9router/pull/394) · [#396](https://github.com/decolua/9router/pull/396)

---

## 📦 Quick Start

### CLI (Recommended for Production)

```bash
# Install globally
npm install -g redteam-coding-factory

# Run with a config file
redteam-factory run --config factory.config.json

# Run with config + custom tasks
redteam-factory run --config factory.config.json --tasks tasks.json

# Validate and preview task normalization
redteam-factory tasks --config factory.config.json --tasks tasks.json

# Show help
redteam-factory --help
```

### CI/CD Integration

```bash
cd scripts/
./redteam-ci-cd.sh
```

The CI/CD entrypoint script provides:
- Input validation for config files
- Logging to timestamped files
- Error handling with proper exit codes
- Production-ready execution

### Programmatic (Node.js)

```javascript
const RedTeamFactory = require('./src/redteam-factory');

const factory = new RedTeamFactory({
  workspaceRoot: '/path/to/workspace',
  dataDir: '/path/to/.factory-data',
  enablePush: false,   // Safety: disabled by default
  createPR: false      // Safety: disabled by default
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

---

## ⚙️ Configuration

### `factory.config.json`

```json
{
  "pipeline": "git",
  "version": "1.0.0",
  "tasks": ["build", "test", "deploy"],
  "environment": {
    "node_version": "20",
    "python_version": "3.11"
  }
}
```

### `tasks.json`

```json
{
  "build": {
    "description": "Build the project",
    "commands": ["npm install", "npm run build"]
  },
  "test": {
    "description": "Run tests",
    "commands": ["npm test"]
  },
  "deploy": {
    "description": "Deploy to production",
    "commands": ["npm run deploy"]
  }
}
```

> 💡 See `factory.config.json.example` and `tasks.json.example` for full reference configurations.

---

## 🏗️ Architecture

The factory is structured around 6 production phases:

| Phase | Description |
|---|---|
| **Phase 1** | Task intake + worktree isolation (with run metrics + optional Slack `#redos-eng` webhook) |
| **Phase 2** | Code execution — lint, test, commit |
| **Phase 3** | Agent integration + autonomous loop |
| **Phase 4** | Result validation + feedback loop |
| **Phase 5** | Push/PR creation with Critic gate |
| **Phase 6** | Multi-repo orchestration + `RedTeamFactory` wrapper |

### Agent Integration (Phase 3)

`AgentIntegration` spawns real agents via `AgentRunner` with full async result tracking:

- `setAgent(name)` — configure which CLI to use (`claude`, `codex`, or custom)
- `spawnAgent(task, worktree)` — starts the agent process in the worktree, returns a session key
- `waitForAgent(sessionKey)` — awaits real completion, respects timeout

> **Key fix (2026-03-23):** `waitForAgent` previously simulated a 5s sleep and always returned `"completed"`. It now awaits the actual agent process.

A2A dispatch runs first; falls back to `AgentRunner` if transport is unavailable. The multi-repo orchestrator propagates `useAgent` and `enablePush` through cross-repo tasks.

### A2A Reliability & Coordination

A2A dispatch includes timeout-aware retries with fallback routing:

- **Primary:** `sessions_send`
- **Retry policy:** Timeout-only retries with exponential backoff + jitter
- **Fallback:** `sessions_spawn` when retries are exhausted

Run focused A2A verification:
```bash
npm run test:a2a
```

Protocol and conflict rules for parallel work: [`docs/A2A-COORDINATION-PROTOCOL.md`](docs/A2A-COORDINATION-PROTOCOL.md)

---

## 🧪 Testing

```bash
npm test
```

All 3 test suites pass:

| Suite | Coverage |
|---|---|
| `test/integration.test.js` | Phases 1–5 |
| `test/phase6.test.js` | Multi-repo orchestration |
| `test/redteam-factory.test.js` | Production integration |

> Metrics are written to `dataDir/metrics.json` (runtime state) so test runs don't dirty the git repo.

---

## 📊 Benchmark Policy

**SWE-bench Verified** is the canonical capability metric for this factory.

- Policy: [`docs/BENCHMARK-POLICY.md`](docs/BENCHMARK-POLICY.md)
- Standard report template: [`ops/templates/swe-bench-verified-report.md`](ops/templates/swe-bench-verified-report.md)

> Runtime metrics (`dataDir/metrics.json`) are operational health signals, **not** benchmark scorecards.

---

## 🔒 LLM Test Governance Gate

CI enforces governance checks for LLM-generated tests before merge:

- Golden dataset must not regress (`baseline-report.json` vs `candidate-report.json`)
- Candidate flake rate must stay below policy threshold
- Candidate line coverage must not regress vs baseline

Reference files:
- Policy: `ops/llm-governance/policy.json`
- Baseline report: `ops/llm-governance/baseline-report.json`
- Candidate report: `ops/llm-governance/candidate-report.json`
- Check script: `scripts/check-llm-test-governance.sh`

---

## 🛡️ Safety Rails

| Guard | Purpose |
|---|---|
| **Push/PR disabled by default** | Must be explicitly enabled in config |
| **Critic gate** | Validates results before push/PR |
| **Force mode logging** | Full audit trail for overrides |
| **Dry-run mode** | Test the pipeline without side effects |

---

## 🚢 Production Deployment

See [`PRODUCTION-DEPLOYMENT.md`](PRODUCTION-DEPLOYMENT.md) for full deployment instructions including environment setup, secrets management, and monitoring.

---

## 📁 Repository Structure

```
redteam-coding-factory/
├── src/                    # Core factory source code
├── test/                   # Test suites (integration, phase6, factory)
├── scripts/                # CI/CD and governance shell scripts
├── docs/                   # Architecture docs, A2A protocol, benchmark policy
├── ops/                    # LLM governance policies and SWE-bench templates
├── tasks/                  # Task definition files
├── integrations/           # External service integrations
├── .github/workflows/      # GitHub Actions CI/CD pipelines
├── factory.config.json     # Active factory configuration
├── tasks.json              # Active task definitions
├── cli-entrypoint.js       # CLI entry point
└── PRODUCTION-DEPLOYMENT.md
```

---

## 🤝 Contributing

Contributions are welcome! The factory follows the A2A coordination protocol documented in [`docs/A2A-COORDINATION-PROTOCOL.md`](docs/A2A-COORDINATION-PROTOCOL.md). Please read it before submitting PRs to avoid conflicts with autonomous workers.

---

*Built and maintained by [@anuragg-saxenaa](https://github.com/anuragg-saxenaa)*
