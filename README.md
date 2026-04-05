# 🏭 RedTeam Coding Factory

> Autonomous, multi-stream coding factory — picks GitHub issues, implements full fixes across Java/Spring AI/TypeScript/Python/Mobile stacks, and opens PRs without human intervention. Pluggable into any OpenClaw agent or AI agent flow.

[![Tests](https://img.shields.io/badge/tests-3%20suites%20passing-brightgreen)](#testing)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)

---

## 🚀 What Is This?

**RedTeam Coding Factory** is a production-grade, autonomous software engineering pipeline. It operates across 3 workflow paths and 5 technology streams, running 24/7 inside **OpenClaw RedOS**.

**3 Workflow Paths:**
1. **Research → ENG** — RESEARCH agent discovers trending OSS repos (any language, 5k+ stars), writes specs, delegates to ENG for full implementation
2. **Issue Watcher** — ENG watches GitHub issues every 15 min, implements fixes autonomously, opens PRs
3. **On-Demand via RED** — User sends a repo to RED (CEO) via Telegram; RED delegates directly to ENG

**Use it as:**
- A standalone cron job in your own OpenClaw setup
- An A2A sub-agent called from any AI agent flow
- An npm library embedded in your own orchestration

---

## 🔄 Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RedTeam Coding Factory                           │
│                                                                     │
│  PATH 1 — Autonomous OSS Discovery                                  │
│  ──────────────────────────────────                                 │
│  RESEARCH agent (every 3h)                                          │
│    ↓ searches internet for trending repos (any language, 5k+ stars) │
│    ↓ evaluates: activity, open issues, stack fit                    │
│    ↓ writes spec to backlog.md                                      │
│    ↓ sessions_spawn → ENG                                           │
│  ENG: full implementation → tests → commit → PR (--no-edit)        │
│                                                                     │
│  PATH 2 — Issue Watcher (always-on)                                 │
│  ──────────────────────────────────                                 │
│  ENG polls decolua/9router every 15 min                             │
│    ↓ picks concrete bug (<50 lines)                                 │
│    ↓ implements full fix → tests → commit                          │
│    ↓ gh pr create --no-edit                                         │
│                                                                     │
│  PATH 3 — On-Demand: Telegram → RED → ENG                          │
│  ─────────────────────────────────────────                          │
│  User sends repo to RED (CEO) via Telegram                          │
│    ↓ RED delegates DIRECTLY to ENG (no research step)              │
│    ↓ ENG: clone → pick issue → implement → PR                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Live Production Status

| Stream | Repos | Schedule | Stack |
|---|---|---|---|
| **A — Java/Spring** | spring-projects/spring-ai, langchain4j | Tue/Thu/Sat | Java 21 + Spring AI + LangChain4j |
| **B — TypeScript** | decolua/9router, FellouAI/eko | Mon/Wed | Node.js ESM, vitest |
| **C — Python** | PathOnAIOrg/LiteMultiAgent | Fri | Python 3.12, pytest |
| **D — Mobile** | nicklockwood/SwiftFormat, react-native-community | Sun | Swift/SPM + React Native |
| **E — Claude+MCP** | Backlog Java projects | On-demand | Claude Code + context7 + Spring AI docs |

**IssueWatcher:** decolua/9router — every 15 min  
**PR Monitor:** all streams — every 4 hours (auto-fix CI failures)  
**OSS Discovery:** RESEARCH agent — every 3 hours  

**Recent autonomous PRs:** [#482](https://github.com/decolua/9router/pull/482) · [#487](https://github.com/decolua/9router/pull/487) · [#493](https://github.com/decolua/9router/pull/493)

---

## 🏗️ Full System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RedTeam Coding Factory                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │               Factory Orchestrator                            │   │
│  │   RedTeamFactory → MultiRepoOrchestrator → IssueWatcher       │   │
│  └──────┬──────────────┬──────────────┬──────────┬──────────────┘   │
│         │              │              │          │                   │
│         ▼              ▼              ▼          ▼                   │
│  ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Stream A   │ │ Stream B   │ │ Stream C │ │   Stream D       │   │
│  │ Java 21    │ │ TypeScript │ │  Python  │ │  iOS Swift       │   │
│  │ Spring AI  │ │ Node.js    │ │  pytest  │ │  React Native    │   │
│  │ LangChain4j│ │ vitest     │ │  FastAPI │ │  Android/Gradle  │   │
│  │ Maven/JUnit│ │ ESM/tsc    │ │          │ │  SPM/swift test  │   │
│  └────────────┘ └────────────┘ └──────────┘ └──────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Stream E                                   │   │
│  │         Claude Code + MCP + Java Expert Agent                 │   │
│  │   ccs-smart.sh + context7 (Spring AI docs) + exa-mcp          │   │
│  │   → Deep Java: Spring Boot scaffolding, AI integrations       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Execution Pipeline (all streams)                 │   │
│  │                                                               │   │
│  │  Issue → Worktree → AgentIntegration → CodeExecutor           │   │
│  │       → CriticGate → PushPRManager → MetricsWriter            │   │
│  │       → SelfHealingCI (watch CI, auto-fix failures)           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │           OpenClaw Agent Layer                                │   │
│  │                                                               │   │
│  │  RESEARCH ──(sessions_spawn)──▶ ENG ◀──(Telegram)── RED      │   │
│  │  (OSS discovery,               (implements,         (CEO,     │   │
│  │   any language,                 tests,               on-demand │  │
│  │   10k+ stars)                   PRs)                 delegation│  │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Production Phases

| Phase | Description | Status |
|---|---|---|
| **Phase 1** | Task intake + worktree isolation + Slack webhook | ✅ |
| **Phase 2** | Code execution — lint, test, commit | ✅ |
| **Phase 3** | Agent integration (real `waitForAgent`, no fake sleep) | ✅ |
| **Phase 4** | Result validation + feedback loop | ✅ |
| **Phase 5** | Push/PR with Critic gate + `--no-edit` | ✅ |
| **Phase 6** | Multi-repo orchestration + `RedTeamFactory` wrapper | ✅ |
| **Phase 7** | Multi-stream parallel execution (A/B/C/D/E) | 🚧 |
| **Phase 8** | Research→ENG OSS discovery pipeline | ✅ |
| **Phase 9** | On-demand RED→ENG Telegram delegation | ✅ |

---

## 📦 Quick Start

### Path 1: Research → ENG (Autonomous OSS Discovery)

RESEARCH runs every 3h. When it finds a good repo, it delegates to ENG automatically.

```json
{
  "id": "inner-loop-research-0001",
  "agentId": "research",
  "schedule": { "kind": "cron", "expr": "30 */3 * * *" },
  "payload": {
    "kind": "agentTurn",
    "message": "Search for trending OSS repos (5k+ stars, any language). Write spec to backlog.md. sessions_spawn ENG to implement."
  }
}
```

### Path 2: Issue Watcher (standalone cron)

```json
{
  "id": "coding-factory-issuewatcher",
  "agentId": "eng",
  "schedule": { "kind": "cron", "expr": "*/15 * * * *" },
  "payload": {
    "kind": "agentTurn",
    "message": "Run the coding factory IssueWatcher for decolua/9router. Use Stream A for Java issues, Stream B for JS/TS issues."
  }
}
```

### Path 3: On-Demand via RED (Telegram)

User sends to RED via Telegram:
```
Implement issue fixes for github.com/org/repo
```

RED delegates to ENG:
```javascript
await sessions_spawn({
  agentId: "eng",
  message: "On-demand task from Telegram. Repo: org/repo. Pick concrete issue, implement full fix, run tests, open PR with --no-edit. Log to pr-log.md."
});
```

### Programmatic (Node.js)

```javascript
const RedTeamFactory = require('./src/redteam-factory');

const factory = new RedTeamFactory({
  workspaceRoot: '/path/to/workspace',
  dataDir: '/path/to/.factory-data',
  stream: 'java-spring',   // 'java-spring' | 'typescript' | 'python' | 'mobile' | 'claude-mcp'
  enablePush: true,
  createPR: true
});

factory.initialize([
  { name: 'spring-ai', path: '/path/to/spring-ai', branch: 'main' }
]);

const results = await factory.run();
console.log(results);
```

---

## 🔧 Stream Configuration

### Stream A — Java / Spring Boot / Spring AI / LangChain4j

```json
{
  "stream": "java-spring",
  "buildCommand": "mvn verify",
  "testCommand": "mvn test",
  "javaVersion": "21",
  "frameworks": ["spring-boot-3", "spring-ai-1.0", "langchain4j-0.36"]
}
```

**Key Spring AI pattern:**
```java
@Bean
ChatClient chatClient(ChatClient.Builder builder) {
    return builder.defaultSystem("You are a helpful assistant").build();
}
String response = chatClient.prompt().user(msg).tools(myTool).call().content();
```

**LangChain4j AI Service:**
```java
interface MyAgent {
    @SystemMessage("Expert Java developer")
    String review(@UserMessage String code);
}
MyAgent agent = AiServices.builder(MyAgent.class).chatLanguageModel(model).build();
```

### Stream D — Mobile (iOS Swift + React Native)

```json
{
  "stream": "mobile",
  "ios": { "buildCommand": "swift build", "testCommand": "swift test" },
  "android": { "buildCommand": "./gradlew build", "testCommand": "./gradlew test" },
  "reactNative": { "buildCommand": "npm run build", "testCommand": "npm test" }
}
```

### Stream E — Claude Code + MCP + Java Expert

```json
{
  "stream": "claude-mcp",
  "agent": "claude",
  "mcpServers": ["context7", "exa-mcp"],
  "systemPrompt": "You are a Java expert. Use context7 to fetch Spring AI/LangChain4j docs before coding. Always implement fully — no stubs."
}
```

---

## ⚙️ Configuration Files

### `factory.config.json`

```json
{
  "pipeline": "git",
  "version": "1.0.0",
  "stream": "java-spring",
  "model": "minimax/MiniMax-M2.7",
  "fallbackModel": "9router/cu/default",
  "maxTasksPerRun": 2,
  "enablePush": true,
  "createPR": true,
  "prFlags": "--no-edit"
}
```

### `tasks.json`

```json
{
  "build": { "commands": ["mvn verify"] },
  "test":  { "commands": ["mvn test"] },
  "lint":  { "commands": ["mvn checkstyle:check"] }
}
```

---

## 🤝 Integration with Other OpenClaw Agents / AI Flows

```javascript
// PATH 1 — RESEARCH discovers, delegates to ENG
// (automated via inner-loop-research-0001 cron every 3h)
await sessions_spawn({
  agentId: "eng",
  message: "OSS discovery brief ready. New READY item in backlog.md: spring-ai-mcp-bridge. Implement using Stream A (Java 21 + Spring AI). Full implementation, tests, PR with --no-edit."
});

// PATH 3 — RED delegates on-demand Telegram request to ENG
// (RED receives GitHub URL via Telegram, spawns ENG directly)
await sessions_spawn({
  agentId: "eng",
  message: "On-demand task from Telegram (Anurag). Repo: decolua/9router. Pick most concrete open issue, implement full fix, open PR with --no-edit."
});

// From any other AI agent framework (LangChain, AutoGen, etc.)
fetch('http://localhost:18789/v1/agent/eng/message', {
  headers: { 'Authorization': 'Bearer <token>' },
  body: JSON.stringify({ message: 'Run coding factory: Stream A, spring-ai repo' })
});
```

---

## 🧪 Testing

```bash
npm test
```

| Suite | Coverage |
|---|---|
| `test/integration.test.js` | Phases 1–5 |
| `test/phase6.test.js` | Multi-repo orchestration |
| `test/redteam-factory.test.js` | Production integration |

```bash
npm run test:a2a    # A2A coordination tests
npm run test:phase6 # Multi-repo orchestration
```

---

## 🔒 Implementation Contract

Every factory output is guaranteed:
- ✅ **Fully implemented** — no `// TODO`, no stubs, no `throw new UnsupportedOperationException()`
- ✅ **Tested** — real assertions, repo's own test framework
- ✅ **Builds clean** — `mvn verify` / `npm run build` / `pytest` / `swift build` passes
- ✅ **PR uses `--no-edit`** — never opens editor in non-TTY sessions

---

## 🛡️ Safety Rails

| Guard | Purpose |
|---|---|
| `--no-edit` on `gh pr create` | Prevents TTY hang in cron/agent context |
| Push/PR disabled by default | Must be explicitly enabled in config |
| Critic gate | Validates implementation before push |
| CriticGate rejects stubs | Placeholder code is rejected and retried |
| Dry-run mode | Test pipeline without side effects |
| RESEARCH star threshold | Only contributes to repos with 5k+ stars |

---

## 📁 Repository Structure

```
redteam-coding-factory/
├── src/
│   ├── factory.js               # Main factory orchestrator
│   ├── redteam-factory.js       # RedTeamFactory wrapper (Phase 6)
│   ├── issue-watcher.js         # GitHub issue polling + dispatch
│   ├── agent-integration.js     # AgentRunner + A2A dispatch
│   ├── multi-repo-orchestrator.js # Cross-repo task routing
│   ├── code-executor.js         # Lint/test/build runner
│   ├── push-pr-manager.js       # git push + gh pr create --no-edit
│   ├── critic-gate.js           # Implementation quality gate
│   ├── self-healing-ci.js       # CI failure monitor + auto-fix
│   └── dashboard/               # Real-time status dashboard
├── docs/
│   ├── ARCHITECTURE.md          # Full architecture + stream diagrams
│   ├── A2A-COORDINATION-PROTOCOL.md
│   └── BENCHMARK-POLICY.md
├── test/                        # 3 test suites
├── scripts/                     # CI/CD + governance scripts
├── factory.config.json          # Active configuration
├── tasks.json                   # Build/test commands
└── PRODUCTION-DEPLOYMENT.md
```

---

## 🚢 Production Deployment

See [`PRODUCTION-DEPLOYMENT.md`](PRODUCTION-DEPLOYMENT.md) for full setup including OpenClaw integration, secrets, and monitoring.

**TL;DR for OpenClaw:**
1. Clone this repo into `workspace-eng/repos/redteam-coding-factory`
2. Add an `eng-coding-factory` cron that calls the factory via `sessions_spawn`
3. Set `model: minimax/MiniMax-M2.7` (Coding Plan key required)
4. RESEARCH inner-loop handles OSS discovery automatically — no extra config needed

---

## 🤝 Contributing

PRs welcome! This factory uses itself to manage its own contributions. Read [`docs/A2A-COORDINATION-PROTOCOL.md`](docs/A2A-COORDINATION-PROTOCOL.md) before submitting to avoid conflicts with autonomous workers.

---

*Built and maintained by [@anuragg-saxenaa](https://github.com/anuragg-saxenaa) · Running 24/7 inside OpenClaw RedOS*
