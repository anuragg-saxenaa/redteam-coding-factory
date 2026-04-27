/**
 * Agent Spawner — Thin wrapper that calls OpenClaw sessions_spawn via child_process.
 * 
 * This script bridges the Node.js factory module to the OpenClaw tool layer.
 * Factory calls:  node agent-spawner.js spawn <taskId> <worktreePath> <prompt>
 * Factory polls:   node agent-spawner.js poll <taskId> <resultFile>
 *
 * The actual sessions_spawn call is made by forking a minimal node subprocess
 * that uses OpenClaw's internal IPC socket to invoke the tool.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SOCKET_PATH = process.env.OPENCLAW_SOCKET || path.join(process.env.HOME || '/Users/redinside', '.openclaw', 'socket');
const SESSION_LABEL_PREFIX = 'factory-task-';

/**
 * Spawn a real sub-agent via OpenClaw sessions_spawn.
 * Returns the sessionKey string.
 */
function spawnAgent(taskId, worktreePath, prompt, options = {}) {
  const label = `${SESSION_LABEL_PREFIX}${taskId}`;
  const resultFile = options.resultFile || `/tmp/factory-results/${taskId}.json`;

  // Build the spawn command that invokes sessions_spawn via openclaw CLI or IPC
  // Using openclaw exec to invoke sessions_spawn tool indirectly
  const scriptPath = path.join(__dirname, 'agent-spawner-impl.js');

  return new Promise((resolve, reject) => {
    const child = spawn('node', [
      scriptPath,
      'spawn',
      '--task-id', taskId,
      '--worktree-path', worktreePath,
      '--prompt', prompt,
      '--result-file', resultFile,
      '--label', label,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OPENCLAW_AGENT_SPAWN: '1' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const out = JSON.parse(stdout.trim());
          resolve(out.sessionKey);
        } catch (e) {
          // Fall back to raw stdout if not JSON
          resolve(stdout.trim());
        }
      } else {
        reject(new Error(`Spawn failed (code ${code}): ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Wait for an agent result by polling the result file.
 */
async function waitForResult(taskId, resultFile, timeoutMs = 15 * 60 * 1000, pollMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (fs.existsSync(resultFile)) {
      try {
        return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      } catch (e) {
        // File being written; wait
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return {
    taskId,
    status: 'timeout',
    error: `Timeout after ${timeoutMs}ms waiting for result file ${resultFile}`,
    timedOutAt: new Date().toISOString(),
  };
}

// CLI entry point
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'spawn') {
    const { taskId, worktreePath, prompt, resultFile, label } = parseArgs(args);
    spawnAgent(taskId, worktreePath, prompt, { resultFile, label })
      .then((sessionKey) => {
        console.log(JSON.stringify({ ok: true, sessionKey, taskId }));
        process.exit(0);
      })
      .catch((err) => {
        console.error(JSON.stringify({ ok: false, error: err.message }));
        process.exit(1);
      });
  } else if (cmd === 'poll') {
    const { taskId, resultFile, timeoutMs, pollMs } = parseArgs(args);
    waitForResult(taskId, resultFile, Number(timeoutMs) || 15 * 60 * 1000, Number(pollMs) || 10000)
      .then((result) => {
        console.log(JSON.stringify(result));
        process.exit(0);
      })
      .catch((err) => {
        console.error(JSON.stringify({ ok: false, error: err.message }));
        process.exit(1);
      });
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task-id') out.taskId = args[++i];
    else if (args[i] === '--worktree-path') out.worktreePath = args[++i];
    else if (args[i] === '--prompt') out.prompt = args[++i];
    else if (args[i] === '--result-file') out.resultFile = args[++i];
    else if (args[i] === '--label') out.label = args[++i];
    else if (args[i] === '--timeout-ms') out.timeoutMs = args[++i];
    else if (args[i] === '--poll-ms') out.pollMs = args[++i];
  }
  return out;
}

module.exports = { spawnAgent, waitForResult };
