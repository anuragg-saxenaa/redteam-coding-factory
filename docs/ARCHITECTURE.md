# Architecture

## Goal
Produce PRs autonomously across multiple technology stacks with verifiable accountability:
- every task is a GitHub Issue (or backlog spec)
- every change is a PR linked to the issue
- CI failures and review comments route back into the same session
- humans only get pinged for judgment calls (L4/L5 approvals) or on-demand requests via Telegram

---

## 3-Part Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RedTeam Coding Factory                           │
│                         3 Workflow Paths                            │
│                                                                     │
│  PATH 1 — Autonomous OSS Discovery (RESEARCH → ENG)                │
│  ──────────────────────────────────────────────────                 │
│                                                                     │
│   RESEARCH                          ENG                             │
│   (every 3h)                        (triggered via A2A)             │
│       │                                  │                          │
│       ▼                                  ▼                          │
│   web_search trending repos         reads backlog.md spec           │
│   (any language, 5k+ stars)         clones repo                     │
│   evaluate: stars, issues, fit      picks concrete issue            │
│   write spec → backlog.md           implements FULL fix             │
│   sessions_spawn(eng) ──────────▶   runs tests                      │
│                                     git push + PR --no-edit         │
│                                                                     │
│  PATH 2 — Issue Watcher (ENG, always-on)                           │
│  ────────────────────────────────────────                           │
│                                                                     │
│   [GitHub Issues]                   ENG (every 15 min)             │
│       │                                  │                          │
│       ▼                                  ▼                          │
│   decolua/9router issues            IssueWatcher.poll()             │
│   tagged: bug, help wanted          pick concrete bug (<50 lines)   │
│                                     implement full fix               │
│                                     mvn/npm/pytest/swift test       │
│                                     gh pr create --no-edit          │
│                                                                     │
│  PATH 3 — On-Demand: Telegram → RED → ENG                          │
│  ─────────────────────────────────────────                          │
│                                                                     │
│   User (Telegram)                   RED (CEO)         ENG           │
│       │                                │               │             │
│       ▼                                ▼               ▼             │
│   "fix org/repo"  ──────────▶    receives msg    sessions_spawn     │
│                                  acknowledges ──▶ clone repo         │
│                                  (no research)   pick issue          │
│                                                  implement           │
│                                                  PR --no-edit        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Stream Design

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
| **Phase 8** | Research→ENG OSS discovery pipeline | ✅ Production |
| **Phase 9** | On-demand RED→ENG Telegram delegation | ✅ Production |

---

## Execution Pipeline (PATH 2 — Issue Watcher detail)

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

## RESEARCH → ENG Pipeline (PATH 1 detail)

```
RESEARCH inner-loop (every 3h)
    │
    ▼
Check backlog.md — count READY items
    │  if >= 5: skip OSS discovery
    │  if < 5: run discovery
    ▼
web_search trending repos
    │  queries: "trending github 2026 AI developer tools"
    │  filter: stars >= 5000, active commits, open issues
    ▼
Evaluate stack fit
    │  Java → Stream A | TS/JS → Stream B | Python → Stream C | Swift/RN → Stream D
    ▼
Write spec to backlog.md
    │  ## N | repo-name ⭐ READY
    │  Stack, Repo, Stars, Pain source, What to do, Stream
    ▼
sessions_spawn(agentId="eng")
    │  message: "New READY item in backlog.md: <repo>. Implement using Stream X."
    ▼
ENG picks up task
    │  reads spec → clones repo → picks issue → implements → tests → PR
```

---

## On-Demand Pipeline (PATH 3 detail)

```
User → Telegram → RED (CEO agent)
    │  message: "fix issues in org/repo" or GitHub URL
    │
    ▼
RED recognizes on-demand repo request
    │  pattern: GitHub URL or "implement/fix/add/pr for <repo>"
    │
    ▼
RED acknowledges to user (within 60s)
    │  "Delegated to ENG ✓ — will implement and open PR"
    │
    ▼
sessions_spawn(agentId="eng")
    │  NO research step — ENG goes directly
    │  message: "On-demand task. Repo: org/repo. Pick issue, implement, PR --no-edit."
    │
    ▼
ENG executes full pipeline
    │  gh repo clone → issue list → pick → implement → test → push → PR
```

---

## A2A Reliability & Coordination

A2A dispatch includes timeout-aware retries with fallback routing:

- **Primary:** `sessions_spawn` to ENG agent
- **Retry policy:** Timeout-only retries with exponential backoff + jitter
- **Fallback:** Write to `workspace/AUTONOMOUS.md` as `PENDING[ENG]` — ENG reads on next heartbeat

Protocol and conflict rules: [`A2A-COORDINATION-PROTOCOL.md`](A2A-COORDINATION-PROTOCOL.md)

---

## Model Configuration

| Stream | Primary Model | Fallback |
|---|---|---|
| A, E (Java/Spring AI) | MiniMax-M2.7 (1M ctx) | 9router/cu/default |
| B, C, D | MiniMax-M2.5 (200K ctx) | 9router/cc/claude-haiku-4-5 |
| RESEARCH | MiniMax-M2.5 | 9router/cu/default |
| RED (CEO) | MiniMax-M2.5 | 9router/cu/default |

Provider: MiniMax Coding Plan (`sk-cp-...`) — unlimited subscription.
Never use `sk-api-...` Pay-as-you-go keys (separate balance, exhausts).

---

## Implementation Contract

Every output from the factory is guaranteed:
- ✅ **Fully implemented** — no `// TODO`, no stubs, no `throw new UnsupportedOperationException()`
- ✅ **Tested** — real assertions with the repo's own test framework
- ✅ **Builds clean** — `mvn verify` / `npm run build` / `pytest` / `swift build` passes
- ✅ **Conventional commits** — `fix:`, `feat:`, `refactor:` prefixes with issue reference
