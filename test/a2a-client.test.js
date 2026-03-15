/**
 * A2AClient unit tests
 * Verifies timeout retry, fallback dispatch, and hard-failure behavior.
 */

const assert = require('assert');
const A2AClient = require('../src/a2a-client');

let passed = 0;
let failed = 0;

function ok(condition, label) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed += 1;
  } else {
    console.error(`  \u2717 ${label}`);
    failed += 1;
  }
}

(async () => {
  console.log('Test 1: retries timeout then succeeds via sessions_send');
  {
    let callCount = 0;
    const client = new A2AClient({
      transport: async ({ method }) => {
        callCount += 1;
        if (method !== 'sessions_send') {
          throw new Error('unexpected method');
        }
        if (callCount < 3) {
          const err = new Error('request timed out');
          err.code = 'ETIMEDOUT';
          throw err;
        }
        return { sessionKey: 'agent:eng:task-1' };
      },
      maxAttempts: 3,
      baseBackoffMs: 1,
      jitterMs: 0,
    });

    const result = await client.send({ agentId: 'eng', message: 'hello' });
    const stats = client.getStats();

    ok(result.ok === true, 'send result reports success');
    ok(result.method === 'sessions_send', 'success path stays on sessions_send');
    ok(result.attempts === 3, 'completes after third attempt');
    ok(stats.retries === 2, 'records two retries');
    ok(stats.failures === 0, 'does not record failure');
  }

  console.log('Test 2: uses fallback method after timeout retries exhausted');
  {
    let sendCalls = 0;
    let spawnCalls = 0;
    const client = new A2AClient({
      transport: async ({ method }) => {
        if (method === 'sessions_send') {
          sendCalls += 1;
          const err = new Error('timeout while sending');
          err.code = 'TIMEOUT';
          throw err;
        }
        if (method === 'sessions_spawn') {
          spawnCalls += 1;
          return { sessionKey: 'agent:eng:task-fallback' };
        }
        throw new Error('unexpected method');
      },
      maxAttempts: 2,
      baseBackoffMs: 1,
      jitterMs: 0,
      fallbackMethod: 'sessions_spawn',
    });

    const result = await client.send({ agentId: 'eng', message: 'fallback-test' });
    const stats = client.getStats();

    ok(sendCalls === 2, 'exhausts configured sessions_send attempts');
    ok(spawnCalls === 1, 'invokes fallback once');
    ok(result.usedFallback === true, 'result indicates fallback usage');
    ok(result.method === 'sessions_spawn', 'result method is fallback method');
    ok(stats.fallbackUsed === 1, 'stats track fallback usage');
    ok(stats.failures === 0, 'fallback success avoids hard failure');
  }

  console.log('Test 3: throws explicit error when both primary and fallback fail');
  {
    const client = new A2AClient({
      transport: async ({ method }) => {
        if (method === 'sessions_send') {
          const err = new Error('operation timed out');
          err.code = 'ETIMEDOUT';
          throw err;
        }
        throw new Error('fallback unavailable');
      },
      maxAttempts: 2,
      baseBackoffMs: 1,
      jitterMs: 0,
    });

    let thrown = null;
    try {
      await client.send({ sessionKey: 'agent:ops:main', message: 'ping' });
    } catch (error) {
      thrown = error;
    }

    ok(Boolean(thrown), 'throws when all dispatch options fail');
    ok(thrown && thrown.code === 'A2A_SEND_FAILED', 'error has stable code');
    ok(
      thrown && thrown.details && thrown.details.fallbackMethod === 'sessions_spawn',
      'error details include fallback method'
    );
    ok(client.getStats().failures === 1, 'stats record terminal failure');
  }

  console.log('');
  console.log(`=== A2AClient Tests: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
