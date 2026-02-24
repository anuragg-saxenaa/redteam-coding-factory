# RedTeam Factory — Production Deployment Guide

Based on 2026 autonomous coding agent best practices and industry research.

## Architecture Alignment with Industry Standards

The RedTeam Coding Factory implements key production patterns from 2026 agentic AI trends:

### ✅ Multi-Agent Orchestration (Control Plane)
- **Implementation**: `MultiRepoOrchestrator` coordinates specialized agents across repos
- **Benefit**: Handles task allocation, inter-agent communication, parallel reasoning
- **Scaling**: Supports extended autonomous operation (days/weeks on complex tasks)

### ✅ Bounded Autonomy with Oversight
- **Implementation**: `CriticGate` validates results before push/PR; force mode logs overrides
- **Benefit**: Limits agents to well-defined lanes; humans handle exceptions
- **Safety**: Push/PR disabled by default; explicit enable required

### ✅ Governance and Policy Enforcement
- **Implementation**: Exec allowlist, task logging, state persistence
- **Benefit**: Version control for concurrent contributions, audit trail for all actions
- **Compliance**: All task submissions logged; results persisted for review

### ✅ Bounded Execution Lanes
- **Implementation**: Per-repo task queues, dependency tracking, dry-run mode
- **Benefit**: Prevents runaway execution; respects task dependencies
- **Control**: Concurrency caps per repo (configurable)

## Production Deployment Checklist

### Pre-Deployment
- [ ] Configure repo allowlist (repos array with name/path/branch)
- [ ] Set concurrency caps per repo (default: serial/1)
- [ ] Enable push/PR only after validation (default: disabled)
- [ ] Configure monitoring/alerting for task failures
- [ ] Set up log aggregation for audit trail

### Deployment
- [ ] Run full test suite: `npm test`
- [ ] Verify all 3 test suites pass (integration, phase6, redteam-factory)
- [ ] Export factory state before first production run
- [ ] Start with dry-run mode (enablePush=false, createPR=false)
- [ ] Monitor first 10 tasks for anomalies

### Post-Deployment
- [ ] Monitor task completion rates and latencies
- [ ] Review force mode overrides weekly
- [ ] Audit push/PR activity (if enabled)
- [ ] Collect metrics on agent effectiveness
- [ ] Iterate on repo allowlist and concurrency caps

## Operational Visibility

### Task Monitoring
```javascript
const factory = new RedTeamFactory(config);
factory.initialize(repos);

// Submit tasks
factory.submitTask('repo1', task);

// Monitor progress
const history = factory.getTaskHistory();
const results = factory.getResultHistory();

// Export state for analysis
factory.saveState('/path/to/state.json');
```

### Metrics to Track
- **Task success rate**: completed / total
- **Average task latency**: time from submission to completion
- **Repo distribution**: tasks per repo
- **Validation pass rate**: passed validation / total
- **Force mode usage**: overrides / total tasks

### Alerting Rules
- Task failure rate > 10% → escalate to RED
- Task latency > 5 min → investigate
- Force mode override → log and review
- Dependency deadlock → escalate

## Scaling Considerations

### Horizontal Scaling
- Add repos to allowlist dynamically
- Increase concurrency caps as infrastructure grows
- Monitor resource utilization (CPU, memory, disk)

### Vertical Scaling
- Increase worktree pool size
- Optimize git operations (shallow clones, sparse checkout)
- Cache dependencies between tasks

### Multi-Region Deployment
- Deploy separate factory instances per region
- Use cross-region task coordination (future phase)
- Implement geo-aware repo routing

## Security Posture

### Current Controls
- ✅ Exec allowlist (deny-by-default)
- ✅ Push/PR disabled by default
- ✅ Critic gate validation
- ✅ Force mode audit logging
- ✅ Task state persistence

### Recommended Additions
- [ ] Rate limiting per repo
- [ ] Task timeout enforcement
- [ ] Resource quotas (CPU, memory, disk)
- [ ] Network isolation (if applicable)
- [ ] Secrets management for git credentials

## Troubleshooting

### Task Stuck in Queue
- Check dependency graph for cycles
- Verify repo is registered and accessible
- Review task logs for validation errors

### High Failure Rate
- Check git operations (network, permissions)
- Review linter/test output in task logs
- Verify repo state (branch exists, no conflicts)

### Performance Degradation
- Monitor concurrency cap utilization
- Check system resources (CPU, memory, disk)
- Review task latency distribution

## Next Steps

1. **Dry-run validation**: Deploy with enablePush=false, createPR=false
2. **Metrics collection**: Set up monitoring and alerting
3. **Gradual rollout**: Enable push/PR for low-risk repos first
4. **Feedback loop**: Collect metrics, iterate on configuration
5. **Scale**: Add repos and increase concurrency as confidence grows
