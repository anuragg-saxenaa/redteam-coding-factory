#!/usr/bin/env node
/**
 * MCP Server End-to-End Integration Test
 * Spawns the MCP server over stdio, sends JSON-RPC requests, verifies responses.
 */

const { spawn } = require('child_process');
const path = require('path');

const SERVER_SCRIPT = path.join(__dirname, '../src/mcp-server.js');
const WORKSPACE = path.join(__dirname, 'mcp-e2e-workspace');
const EXPECTED_TOOLS = [
  'run_issue_watcher',
  'run_oss_discovery',
  'get_pr_log',
  'get_factory_status',
  'run_self_healing_pipeline',
  'acquire_worktree',
  'validate_implementation',
];

let responseBuffer = '';
let currentResolve = null;
let requestId = 0;

function cleanup() {
  const { execSync } = require('child_process');
  try { execSync(`rm -rf "${WORKSPACE}"`); } catch (_) {}
}

function sendRequest(proc, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    proc.stdout.once('data', (chunk) => {
      try {
        resolve(JSON.parse(chunk.toString()));
      } catch {
        resolve(null);
      }
    });
    proc.stdin.write(payload + '\n');
    setTimeout(() => reject(new Error(`Request ${method} timed out`)), 10_000);
  });
}

async function sendInitialize(proc) {
  return sendRequest(proc, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    clientInfo: { name: 'e2e-test', version: '1.0.0' },
  });
}

async function sendListTools(proc) {
  return sendRequest(proc, 'tools/list');
}

async function sendCallTool(proc, name, args = {}) {
  return sendRequest(proc, 'tools/call', { name, arguments: args });
}

async function main() {
  cleanup();

  const proc = spawn('node', [SERVER_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FACTORY_WORKSPACE: WORKSPACE,
      FACTORY_DATA_DIR: path.join(WORKSPACE, '.factory-data'),
      FACTORY_WORKTREE_ROOT: path.join(WORKSPACE, '.worktrees'),
    },
  });

  proc.stderr.on('data', (chunk) => {
    process.stderr.write('[server stderr] ' + chunk.toString());
  });

  try {
    console.log('--- Test 1: Initialize ---');
    const initResult = await sendInitialize(proc);
    if (!initResult || initResult.error) throw new Error(`Init failed: ${JSON.stringify(initResult)}`);
    console.log('✓ Server initialized');

    console.log('\n--- Test 2: List Tools ---');
    const listResult = await sendListTools(proc);
    if (!listResult || listResult.error) throw new Error(`ListTools failed: ${JSON.stringify(listResult)}`);
    const tools = listResult.result?.tools || listResult.result?.content?.[0]?.text ? JSON.parse(listResult.result.content[0].text).tools : listResult.result?.tools;
    if (!tools || !Array.isArray(tools)) throw new Error(`Unexpected list result: ${JSON.stringify(listResult)}`);
    const toolNames = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      if (!toolNames.includes(expected)) throw new Error(`Missing tool: ${expected}`);
    }
    console.log(`✓ All ${EXPECTED_TOOLS.length} tools registered: ${toolNames.join(', ')}`);

    console.log('\n--- Test 3: get_factory_status (no args) ---');
    const statusResult = await sendCallTool(proc, 'get_factory_status');
    if (!statusResult || statusResult.error) throw new Error(`get_factory_status failed: ${JSON.stringify(statusResult)}`);
    const statusText = statusResult.result?.content?.[0]?.text;
    if (!statusText) throw new Error(`No status text in response: ${JSON.stringify(statusResult)}`);
    const status = JSON.parse(statusText);
    if (typeof status.streams !== 'object') throw new Error(`Unexpected status shape: ${JSON.stringify(status)}`);
    console.log(`✓ Factory status returned: ${Object.keys(status.streams).length} stream(s)`);

    console.log('\n--- Test 4: get_pr_log (with last_n) ---');
    const logResult = await sendCallTool(proc, 'get_pr_log', { last_n: 5 });
    if (!logResult || logResult.error) throw new Error(`get_pr_log failed: ${JSON.stringify(logResult)}`);
    const logText = logResult.result?.content?.[0]?.text;
    if (!logText) throw new Error(`No log text in response: ${JSON.stringify(logResult)}`);
    console.log(`✓ get_pr_log returned: ${logText.trim().split('\n').length} line(s)`);

    console.log('\n--- Test 5: Unknown tool returns error ---');
    const unknownResult = await sendCallTool(proc, 'no_such_tool', {});
    if (!unknownResult || !unknownResult.error) throw new Error('Unknown tool should error');
    console.log(`✓ Unknown tool error: ${unknownResult.error.message}`);

    console.log('\n=== ALL MCP E2E TESTS PASSED ===');
    proc.kill();
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error('\n=== TEST FAILED ===');
    console.error(err.message);
    proc.kill();
    cleanup();
    process.exit(1);
  }
}

main();
