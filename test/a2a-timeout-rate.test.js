#!/usr/bin/env node
/**
import assert from 'assert';
 * A2A timeout-rate verification
 * Simulates transient timeout conditions and checks final timeout rate < 5%.
 */

import { A2AClient } from '../src/a2a-client.js';

const totalRequests = 200;
const attemptsByMessage = new Map();
let completed = 0;
let timedOutFinal = 0;

const client = new A2AClient({
  maxAttempts: 3,
  baseBackoffMs: 1,
  jitterMs: 0,
  transport: async ({ method, payload }) => {
    const key = payload.message;
    const attempt = (attemptsByMessage.get(key) || 0) + 1;
    attemptsByMessage.set(key, attempt);

    // Deterministic transient timeout model:
    // - 20% timeout on attempt 1
    // - 4% timeout on attempt 2
    // - 1% timeout on attempt 3 (handled by fallback)
    const id = Number(key.replace('msg-', ''));
    const attempt1Timeout = id % 5 === 0;
    const attempt2Timeout = id % 25 === 0;
    const attempt3Timeout = id % 100 === 0;

    if (method === 'sessions_send') {
      const shouldTimeout =
        (attempt === 1 && attempt1Timeout) ||
        (attempt === 2 && attempt2Timeout) ||
        (attempt === 3 && attempt3Timeout);

      if (shouldTimeout) {
        const err = new Error('operation timed out');
        err.code = 'ETIMEDOUT';
        throw err;
      }

      return { sessionKey: `agent:eng:${key}` };
    }

    if (method === 'sessions_spawn') {
      return { sessionKey: `agent:eng:fallback:${key}` };
    }

    throw new Error(`unexpected method: ${method}`);
  },
});

for (let i = 1; i <= totalRequests; i++) {
  try {
    await client.send({ agentId: 'eng', message: `msg-${i}` });
    completed += 1;
  } catch (_) {
    timedOutFinal += 1;
  }
}

const timeoutRate = (timedOutFinal / totalRequests) * 100;
const stats = client.getStats();

console.log(`A2A timeout-rate check: ${timeoutRate.toFixed(2)}% (${timedOutFinal}/${totalRequests})`);
console.log(`A2A stats: ${JSON.stringify(stats)}`);

if (timeoutRate >= 5) {
  throw new Error(`timeout rate threshold failed: ${timeoutRate.toFixed(2)}% >= 5%`);
}

if (completed !== totalRequests) {
  throw new Error('expected all simulated requests to complete with retry/fallback enabled');
}
