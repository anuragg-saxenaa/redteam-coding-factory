# GOAL-006 Coordination Protocol (AUTO-030)

This protocol defines reliable A2A delivery behavior and conflict resolution rules for parallel work.

## Scope

- `sessions_send` timeout resiliency (retry + fallback)
- Parallel task ownership and conflict handling
- Operator verification targets for timeout rate

## A2A Delivery Contract

### Primary path

- Method: `sessions_send`
- Timeout: 45s default (`a2aTimeoutSeconds` configurable)
- Retry budget: 3 attempts default (`a2aMaxAttempts`)
- Retry condition: timeout-like failures only (`ETIMEDOUT`, `TIMEOUT`, or timeout message text)
- Backoff: exponential with jitter

### Fallback path

- Trigger: all primary timeout retries exhausted
- Method: `sessions_spawn` (configurable via `a2aFallbackMethod`)
- Outcome: dispatch is considered successful if fallback succeeds

### Failure contract

A dispatch is terminally failed only when:

1. `sessions_send` exhausts retries, and
2. fallback method also fails.

Terminal failures throw `A2A_SEND_FAILED` with structured error details.

## Parallel Work Conflict Resolution

When multiple agents can act on overlapping work, apply these rules in order.

1. **Single owner per issue/task**
   - Once an issue is claimed, one agent owns execution until completion or explicit handoff.
   - Ownership is represented by active claim labels and task IDs.

2. **First claim wins**
   - If duplicate workers detect the same issue, the earliest successful claim proceeds.
   - Later workers must skip and re-poll.

3. **No-force updates by default**
   - Parallel branches must never force-push over another agent's branch.
   - Use normal push/rebase flow and preserve all authored commits.

4. **Conflict detection before merge/push**
   - If rebase/merge conflicts appear, stop autonomous merge and mark for follow-up.
   - Post failure context to issue thread with conflict details.

5. **Escalation threshold**
   - If the same task conflicts twice in one run window, escalate to human review.
   - Include conflicting branch names, latest commit SHAs, and suggested next action.

6. **Deterministic handoff**
   - Explicit handoff message must include task ID, branch, and current blocker.
   - Receiving agent acknowledges before the sender releases ownership.

## RED Verification (P1)

Run:

```bash
npm run test:a2a
```

Pass criteria:

- A2A client tests pass (retry/fallback correctness)
- Simulated timeout-rate test reports `< 5%` terminal timeout rate

Current result (2026-03-02):

- Timeout rate: `0.00%` (`0/200`) with retry + fallback enabled
