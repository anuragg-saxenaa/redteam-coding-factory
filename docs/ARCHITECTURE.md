# Architecture

## Goal
Produce PRs autonomously across multiple technology stacks with verifiable accountability:
- every task is a GitHub Issue
- every change is a PR linked to the issue
- CI failures and review comments route back into the same session
- humans only get pinged for judgment calls (L4/L5 approvals)

---

## Multi-Stream Design (Current)

The factory runs **5 parallel streams**, each targeting a different tech ecosystem:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RedTeam Coding Factory                           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Factory Orchestrator                      │   │
│  │  RedTeamFactory → MultiRepoOrchestrator → IssueWatcher       │   │
│  └──────┬──────────────┬──────────────┬──────────┬─────────────┘   │
│         │              │              │          │                  │
│         ▼              ▼              ▼          ▼                  │
│  ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Stream A   │ │ Stream B   │ │ Stream C │ │   Stream D       │   │
│  │ Java/Spring│ │ TypeScript │ │  Python  │ │  Mobile          │   │
│  │ Spring AI  │ │ Node.js    │ │ FastAPI  │ │  iOS Swift       │   │
│  │ LangChain4j│ │ ESM/vitest │ │ pytest   │ │  React Native    │   │
│  └────────────┘ └────────────┘ └──────────┘ └──────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Stream E                                  │   │
│  │          Claude Code + MCP + Java Expert Agent               │   │
│  │  ccs-smart.sh + context7 MCP + exa-mcp → deep Java tasks    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 Execution Pipeline (all streams)             │   │
│  │  Issue → Worktree → AgentIntegration → CodeExecutor          │   │
│  │       → CriticGate → PushPRManager → MetricsWriter           │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Streams

### Stream A — Java / Spring Boot / Spring AI / LangChain4j
**Target repos:** `spring-projects/spring-ai`, `langchain4j/langchain4j`, `spring-projects/spring-boot`
**Build:** Maven 3.9 (`mvn verify`), Gradle 8 (`./gradlew build`)
**Test:** JUnit 5, Mockito, Testcontainers
**Java:** 21 (LTS)
**AI frameworks:** Spring AI 1.0 (ChatClient, AI Services, MCP), LangChain4j 0.36 (AI Services, Tools, Memory)

### Stream B — JavaScript / TypeScript
**Target repos:** `decolua/9router`, `FellouAI/eko`, `affaan-m/everything-claude-code`
**Build:** npm/pnpm, `tsc`, `npm run build`
**Test:** vitest, jest
**Runtime:** Node.js 22, ESM modules

### Stream C — Python
**Target repos:** `PathOnAIOrg/LiteMultiAgent`, `coasty-ai/open-computer-use`
**Build:** pip, `pytest`, `python -m pytest`
**Version:** Python 3.12+

### Stream D — Mobile (iOS Swift + React Native / Android)
**iOS repos:** `nicklockwood/SwiftFormat`, `apple/swift-argument-parser`
**RN/Android repos:** `react-native-community/react-native-webview`, `Shopify/flash-list`
**iOS:** Swift Package Manager (`swift build`, `swift test`)
**Android:** Gradle (`./gradlew build`, `./gradlew test`)
**React Native:** npm + Metro (`npm test`)

### Stream E — Claude Code + MCP + Java Expert Agent
Deep Java tasks using Claude Code with MCP plugins:
- `context7` — live Spring AI/LangChain4j docs
- `exa-mcp` — web search for latest API changes
- `cloud-code-bridge` — Claude Code for multi-file edits
Handles: Spring Boot scaffolding, Spring AI integrations, multi-file Java refactors

---

## Production Phases

| Phase | Description | Status |
|---|---|---|
| **Phase 1** | Task intake + worktree isolation + Slack webhook | ✅ Production |
| **Phase 2** | Code execution — lint, test, commit | ✅ Production |
| **Phase 3** | Agent integration + autonomous loop (real `waitForAgent`) | ✅ Production |
| **Phase 4** | Result validation + feedback loop | ✅ Production |
| **Phase 5** | Push/PR creation with Critic gate + `--no-edit` | ✅ Production |
| **Phase 6** | Multi-repo orchestration + `RedTeamFactory` wrapper | ✅ Production |
| **Phase 7** | Multi-stream (A/B/C/D/E) parallel execution | 🚧 Active |

---

## Execution Pipeline

```
GitHub Issue
    │
    ▼
IssueWatcher.poll()
    │  filters: concrete bugs, <60 lines, no open PR from anuragg-saxenaa
    ▼
WorktreeManager.create()
    │  git checkout -b fix/issue-<N>-<slug>
    ▼
AgentIntegration.spawnAgent()
    │  real AgentRunner process, stream-appropriate model
    │  Stream A/E: MiniMax-M2.7 + context7 MCP
    │  Stream B/C/D: MiniMax-M2.5
    ▼
CodeExecutor.run()
    │  lint + test with stream-appropriate tools
    │  Java: mvn verify | TS: npm run build | Python: pytest | Swift: swift test
    ▼
CriticGate.evaluate()
    │  validates implementation quality, rejects stubs/placeholders
    ▼
PushPRManager.submit()
    │  git push fork fix/...
    │  gh pr create --no-edit --title "fix: ..." --body "Closes #N"
    ▼
MetricsWriter.record()
    │  JSONL metrics + pr-log.md
    ▼
SelfHealingCI.monitor()
    │  watch CI, fix failures, push to same branch
```

---

## A2A Reliability & Coordination

A2A dispatch includes timeout-aware retries with fallback routing:

- **Primary:** `sessions_send` to ENG agent
- **Retry policy:** Timeout-only retries with exponential backoff + jitter
- **Fallback:** `sessions_spawn` when retries are exhausted

Protocol and conflict rules: [`A2A-COORDINATION-PROTOCOL.md`](A2A-COORDINATION-PROTOCOL.md)

---

## Model Configuration

| Stream | Primary Model | Fallback |
|---|---|---|
| A, E (Java/Spring AI) | MiniMax-M2.7 (1M ctx) | 9router/cu/default |
| B, C, D | MiniMax-M2.5 (200K ctx) | 9router/cc/claude-haiku-4-5 |

Provider: MiniMax Coding Plan (`sk-cp-...`) — unlimited subscription.
Never use `sk-api-...` Pay-as-you-go keys (separate balance, exhausts).

---

## Implementation Contract

Every output from the factory is guaranteed:
- ✅ **Fully implemented** — no `// TODO`, no stubs, no `throw new UnsupportedOperationException()`
- ✅ **Tested** — real assertions with the repo's own test framework
- ✅ **Builds clean** — `mvn verify` / `npm run build` / `pytest` / `swift build` passes
- ✅ **Conventional commits** — `fix:`, `feat:`, `refactor:` prefixes with issue reference
