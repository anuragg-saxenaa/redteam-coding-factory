/**
 * AgentRunner unit tests
 * Tests construction, prompt building, availability check, and preset validation.
 * Does NOT actually spawn codex/claude (those are integration tests).
 */

const AgentRunner = require('../src/agent-runner');

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

// Test 1: Default construction (codex preset)
console.log('Test 1: Default construction');
{
  const runner = new AgentRunner();
  assert(runner.agentName === 'codex', 'default agent is codex');
  assert(runner.timeoutMs === 5 * 60 * 1000, 'default timeout is 5 min');
  assert(runner.maxOutputBytes === 100 * 1024, 'default maxOutputBytes is 100KB');
  assert(runner._preset.bin === 'codex', 'preset bin is codex');
}

// Test 2: Claude preset
console.log('Test 2: Claude preset');
{
  const runner = new AgentRunner({ agent: 'claude' });
  assert(runner.agentName === 'claude', 'agent is claude');
  assert(runner._preset.bin === 'claude', 'preset bin is claude');
  const args = runner._preset.buildArgs('test prompt', '/tmp/wt');
  assert(args.includes('-p'), 'claude args include -p');
  assert(args.includes('test prompt'), 'claude args include prompt');
}

// Test 3: Custom agent
console.log('Test 3: Custom agent');
{
  const runner = new AgentRunner({
    agent: 'custom',
    customBin: '/usr/local/bin/my-agent',
    customArgs: (prompt) => ['--task', prompt],
  });
  assert(runner.agentName === 'custom', 'agent is custom');
  assert(runner._preset.bin === '/usr/local/bin/my-agent', 'custom bin set');
  const args = runner._preset.buildArgs('do stuff', '/tmp/wt');
  assert(args[0] === '--task', 'custom args first is --task');
  assert(args[1] === 'do stuff', 'custom args second is prompt');
}

// Test 4: Custom agent requires customBin
console.log('Test 4: Custom agent requires customBin');
{
  let threw = false;
  try {
    new AgentRunner({ agent: 'custom' });
  } catch (e) {
    threw = true;
    assert(e.message.includes('customBin required'), 'error mentions customBin');
  }
  assert(threw, 'throws without customBin');
}

// Test 5: Unknown preset throws
console.log('Test 5: Unknown preset throws');
{
  let threw = false;
  try {
    new AgentRunner({ agent: 'nonexistent' });
  } catch (e) {
    threw = true;
    assert(e.message.includes('unknown agent preset'), 'error mentions unknown preset');
  }
  assert(threw, 'throws on unknown preset');
}

// Test 6: Prompt building
console.log('Test 6: Prompt building');
{
  const runner = new AgentRunner();
  const prompt = runner.buildPrompt(
    { id: 'task-1', title: 'Fix the bug', description: 'There is a null pointer', repo: '/repos/core', branch: 'main' },
    '/tmp/worktrees/task-1'
  );
  assert(prompt.includes('Fix the bug'), 'prompt includes title');
  assert(prompt.includes('null pointer'), 'prompt includes description');
  assert(prompt.includes('/tmp/worktrees/task-1'), 'prompt includes worktree path');
  assert(prompt.includes('Do NOT push'), 'prompt tells agent not to push');
}

// Test 7: isAvailable returns boolean
console.log('Test 7: isAvailable returns boolean');
{
  const runner = new AgentRunner({ agent: 'custom', customBin: 'echo' });
  const avail = runner.isAvailable();
  assert(typeof avail === 'boolean', 'isAvailable returns boolean');
  // echo should be available on any Unix system
  assert(avail === true, 'echo is available');

  const runner2 = new AgentRunner({ agent: 'custom', customBin: 'this-binary-does-not-exist-xyz123' });
  assert(runner2.isAvailable() === false, 'nonexistent binary is not available');
}

// Test 8: Codex args structure
console.log('Test 8: Codex args structure');
{
  const runner = new AgentRunner();
  const args = runner._preset.buildArgs('my prompt', '/wt/path');
  assert(args.includes('--quiet'), 'codex args include --quiet');
  assert(args.includes('--full-auto'), 'codex args include --full-auto');
  assert(args.includes('my prompt'), 'codex args include prompt');
}

console.log(`\n=== AgentRunner Tests: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
