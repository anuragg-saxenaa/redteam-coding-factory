# Phase 2 — Code Quality Gates

## Overview
Phase 2 adds a **lint gate** before test execution in the factory-run workflow. This ensures code quality standards are enforced before running expensive test suites.

## Implementation

### Lint Gate (factory-run.sh)
- Runs `npm run lint` (or `$LINT_CMD`) before tests
- On lint failure: attempts `--fix` auto-fix once
- If auto-fix succeeds but lint still fails → task fails
- If auto-fix fails → task fails
- Only proceeds to tests if lint passes

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `LINT_CMD` | `npm run lint` | Lint command to run |
| `TEST_CMD` | `npm test` | Test command to run |

## Self-Healing CI
The `src/code-executor.js` module includes self-healing CI with:
- **Lint stage**: Auto-retry with classification (LINT_ERROR, TYPE_ERROR)
- **Test stage**: Auto-retry on TEST_FAILURE
- **Commit stage**: Auto-retry on commit failures

Each stage wrapped in `SelfHealingCI.runStage()` with configurable retry budgets.

## Next Steps (Phase 3)
- Add type checking gate (TypeScript)
- Add security scan gate (npm audit)
- Integrate with GitHub PR comments for detailed lint feedback
