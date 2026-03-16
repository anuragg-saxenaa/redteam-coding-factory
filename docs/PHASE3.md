# Phase 3 — Agent Integration & Autonomous Loop

## Overview
Phase 3 integrates the coding agent directly into the factory pipeline, enabling fully autonomous task completion without human intervention in the loop.

## Implementation

### Agent Integration (src/agent-integration.js)
- Spawns sub-agents to work on tasks inside isolated worktrees
- Uses A2A (Agent-to-Agent) protocol for reliable dispatch
- Supports timeout-aware retries with fallback routing
- Primary: `sessions_send` with exponential backoff
- Fallback: `sessions_spawn` when primary fails

### Agent Prompt Template
```
You are an autonomous coding agent. Your task:
- Task ID: {taskId}
- Title: {title}
- Description: {description}
- Worktree Path: {worktreePath}
- Branch: {branch}

Your job:
1. Navigate to the worktree
2. Understand the task
3. Make code changes
4. Run linting and tests
5. Commit changes
6. Report back
```

### A2A Reliability
- Timeout-aware retries with exponential backoff + jitter
- Fallback routing when primary dispatch fails
- Stats tracking for timeout-rate monitoring

## Integration Points

### factory.js (processNext)
- Phase 3: Spawn agent for autonomous work
- Uses AgentIntegration.spawnAgent() 
- Waits for completion with configurable timeout

### Self-Healing Agent Loop
- Agent failures trigger auto-remediation
- Max remediation attempts configurable
- Failed agents can be retried with modified prompts

## Next Steps (Phase 4)
- Add result validation before PR creation
- Implement feedback loop for failed agent runs
- Add human-in-the-loop for complex decisions
