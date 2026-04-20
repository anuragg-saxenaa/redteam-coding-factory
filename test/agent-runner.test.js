#!/usr/bin/env node
/**
 * AgentRunner unit tests
 * Tests construction, prompt building, availability check.
 * Does NOT actually spawn coding agents (those are integration tests).
 */

import { AgentRunner } from '../src/agent-runner.js';

let passed = 0;
let failed = 0;

function assert_(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// Test 1: Default construction
console.log('Test 1: Default construction');
{
  const runner = new AgentRunner();
  assert_(runner.agentBin === 'claude', 'default agent bin is claude');
  assert_(runner.timeoutMs === 10 * 60 * 1000, 'default timeout is 10 min');
  assert_(runner.onOutput === null, 'onOutput null by default');
  assert_(runner.onError === null, 'onError null by default');
  assert_(typeof runner._logDir === 'string', '_logDir is set');
}

// Test 2: Custom agent via agentBin
console.log('Test 2: Custom agent via agentBin');
{
  const runner = new AgentRunner({ agentBin: '/usr/local/bin/my-agent' });
  assert_(runner.agentBin === '/usr/local/bin/my-agent', 'custom agentBin set');
  assert_(runner.timeoutMs === 10 * 60 * 1000, 'timeout is still default');
}

// Test 3: Custom timeout
console.log('Test 3: Custom timeout');
{
  const runner = new AgentRunner({ timeoutMs: 60_000 });
  assert_(runner.timeoutMs === 60_000, 'custom timeout is 60s');
}

// Test 4: Custom log directory
console.log('Test 4: Custom log directory');
{
  const runner = new AgentRunner({ logDir: '/tmp/agent-logs' });
  assert_(runner._logDir === '/tmp/agent-logs', 'logDir is set to custom path');
}

// Test 5: Prompt building (_buildPrompt)
console.log('Test 5: Prompt building');
{
  const runner = new AgentRunner();
  const prompt = runner._buildPrompt(
    { id: 'task-1', title: 'Fix the bug', description: 'There is a null pointer', repo: '/repos/core', branch: 'main' }
  );
  assert_(prompt.includes('Fix the bug'), 'prompt includes title');
  assert_(prompt.includes('null pointer'), 'prompt includes description');
  assert_(prompt.includes('/repos/core'), 'prompt includes repo');
  assert_(prompt.includes('main'), 'prompt includes branch');
}

console.log(`\n=== AgentRunner Tests: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);