/**
 * AgentIntegration unit tests
 * Verifies timeout behavior and constructor options used by IssueWatcher.
 */

const AgentIntegration = require('../src/agent-integration');

function timeoutError() {
  const err = new Error('request timed out');
  err.code = 'ETIMEDOUT';
  return err;
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

(async () => {
  console.log('Test 1: default constructor options');
  {
    const integration = new AgentIntegration({});
    assert(integration.defaultTimeoutMs === 5 * 60 * 1000, 'default timeout is 5 min');
    assert(integration.simulatedWorkMs === 5000, 'default simulated work is 5s');
  }

  console.log('Test 2: custom constructor options');
  {
    const integration = new AgentIntegration({}, 'eng', {
      defaultTimeoutMs: 1234,
      simulatedWorkMs: 50,
    });
    assert(integration.defaultTimeoutMs === 1234, 'custom default timeout applied');
    assert(integration.simulatedWorkMs === 50, 'custom simulated work applied');
  }

  console.log('Test 3: spawnAgent retries and uses fallback transport path');
  {
    let sendCalls = 0;
    let spawnCalls = 0;
    const integration = new AgentIntegration({}, 'eng', {
      defaultTimeoutMs: 500,
      simulatedWorkMs: 20,
      a2aMaxAttempts: 2,
      a2aBackoffMs: 1,
      a2aJitterMs: 0,
      transport: async ({ method }) => {
        if (method === 'sessions_send') {
          sendCalls += 1;
          throw timeoutError();
        }
        if (method === 'sessions_spawn') {
          spawnCalls += 1;
          return { sessionKey: 'agent:eng:from-fallback' };
        }
        throw new Error('unexpected method');
      },
    });

    const spawned = await integration.spawnAgent(
      { id: 'task-1', title: 'T', description: 'D' },
      { path: '/tmp/repo', branch: 'main' }
    );

    assert(sendCalls === 2, 'sessions_send retried for timeout');
    assert(spawnCalls === 1, 'fallback dispatch used once');
    assert(spawned.agentSessionKey === 'agent:eng:from-fallback', 'uses fallback session key from transport');

    const stats = integration.getA2AStats();
    assert(stats.fallbackUsed === 1, 'A2A stats capture fallback usage');
  }

  console.log('Test 4: waitForAgent completes before timeout');
  {
    const integration = new AgentIntegration({}, 'eng', {
      defaultTimeoutMs: 500,
      simulatedWorkMs: 20,
      transport: async () => ({ sessionKey: 'agent:eng:task-1' }),
    });
    const result = await integration.waitForAgent('agent:eng:task-1');
    assert(result.status === 'completed', 'status is completed');
    assert(Boolean(result.completedAt), 'completedAt provided');
  }

  console.log('Test 5: waitForAgent returns timeout status');
  {
    const integration = new AgentIntegration({}, 'eng', {
      simulatedWorkMs: 200,
    });
    const result = await integration.waitForAgent('agent:eng:task-2', 25);
    assert(result.status === 'timeout', 'status is timeout');
    assert(typeof result.error === 'string' && result.error.includes('25ms'), 'timeout error includes timeoutMs');
    assert(Boolean(result.timedOutAt), 'timedOutAt provided');
  }

  console.log('');
  console.log(`=== AgentIntegration Tests: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
