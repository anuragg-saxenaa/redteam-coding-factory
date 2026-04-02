/**
 * Coding Factory Orchestrator — Phase 1-5
 * Production-hardened: error boundary, graceful shutdown, startup cleanup,
 * health endpoint, adaptive backoff, agent lifecycle management.
 *
 * Fixes applied:
 *   #1  Error boundary wraps every autonomous loop iteration
 *   #6  cleanupStale() called on startup to recover from crashes
 *   #8  clearAgent() called after every waitForAgent
 *   #12 /health HTTP endpoint on HEALTH_PORT (default 9001)
 *   #15 Adaptive backoff when queue is empty (up to 60 s)
 */

'use strict';

const http       = require('http');
const path       = require('path');
const TaskManager        = require('./task-manager');
const WorktreeManager    = require('./worktree-manager');
const CodeExecutor       = require('./code-executor');
const AgentIntegration   = require('./agent-integration');
const ResultValidator    = require('./result-validator');
const CriticGate         = require('./critic-gate');
const PushPRManager      = require('./push-pr-manager');
const MetricsWriter      = require('./metrics-writer');

class CodingFactory {
  constructor(config = {}) {
    this.baseRepo    = config.baseRepo    || process.cwd();
    this.dataDir     = config.dataDir     || './data';
    this.worktreeRoot= config.worktreeRoot|| './worktrees';
    this.validationMode       = config.validationMode        || 'default';
    this.enablePush           = config.enablePush            || false;
    this.createPR             = config.createPR              || false;
    this.enableAutoRemediation= config.enableAutoRemediation ?? false;
    this.maxRetryBudget       = config.maxRetryBudget        ?? 6;
    this.maxRemediationAttempts= config.maxRemediationAttempts ?? 1;

    this.taskManager     = new TaskManager(path.join(this.dataDir, 'task-queue.jsonl'));
    this.worktreeManager = new WorktreeManager(this.baseRepo, this.worktreeRoot);

    // ── FIX #6: clean up any worktrees orphaned by a previous crash ──────
    try {
      const cleaned = this.worktreeManager.cleanupStale();
      if (cleaned.staleMarked > 0) {
        console.warn(`[Factory] Startup: removed ${cleaned.staleMarked} stale worktrees (${cleaned.dirsPruned} dirs pruned)`);
      }
    } catch (e) {
      console.warn(`[Factory] Startup cleanup error (non-fatal): ${e.message}`);
    }

    this.executor = new CodeExecutor(this.worktreeManager, {
      maxRetries             : config.maxRetries              ?? 3,
      maxRetryBudget         : config.maxRetryBudget          ?? 6,
      maxRemediationAttempts : config.maxRemediationAttempts  ?? 1,
      enableAutoRemediation  : config.enableAutoRemediation   ?? false,
      remediationGenerator   : config.remediationGenerator    || null,
      remediationExecutor    : config.remediationExecutor     || null,
      baseDelayMs            : config.baseDelayMs             ?? 200,
    });

    this.agentIntegration = new AgentIntegration(this);
    if (config.agent) this.agentIntegration.setAgent(config.agent);

    this.validator    = new ResultValidator(this.taskManager, this);
    this.criticGate   = new CriticGate(this.taskManager);
    this.pushPRManager= new PushPRManager(this.worktreeManager, this.taskManager, {
      enablePush           : this.enablePush,
      gitHubCliPath        : config.gitHubCliPath        || 'gh',
      onSecurityEscalation : config.onSecurityEscalation || null,
    });

    this.metrics = new MetricsWriter({
      metricsPath: config.metricsPath || path.join(this.dataDir, 'metrics.json'),
    });

    this.isRunning        = false;
    this._healthServer    = null;
    this._lastProcessedAt = Date.now();

    // ── FIX #12: lightweight /health endpoint ────────────────────────────
    this._startHealthServer(config.healthPort || parseInt(process.env.HEALTH_PORT, 10) || 9001);
  }

  // ── FIX #12: health server ─────────────────────────────────────────────
  _startHealthServer(port) {
    if (port === 0) return; // disabled
    try {
      this._healthServer = http.createServer((req, res) => {
        if (req.url !== '/health' && req.url !== '/') {
          res.writeHead(404); res.end('Not found'); return;
        }
        const s        = this.status();
        const staleSec = (Date.now() - this._lastProcessedAt) / 1000;
        // Unhealthy if running but last activity > 5 min
        const healthy  = !this.isRunning || staleSec < 300;
        const body     = JSON.stringify({ healthy, staleSec: Math.round(staleSec), ...s });
        res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(body);
      });
      this._healthServer.listen(port, '0.0.0.0', () => {
        console.log(`[Factory] Health endpoint: http://0.0.0.0:${port}/health`);
      });
      this._healthServer.on('error', (e) => {
        console.warn(`[Factory] Health server error (non-fatal): ${e.message}`);
      });
    } catch (e) {
      console.warn(`[Factory] Could not start health server: ${e.message}`);
    }
  }

  stopHealthServer() {
    if (this._healthServer) {
      this._healthServer.close();
      this._healthServer = null;
    }
  }

  submitTask(task) {
    const record = this.taskManager.intake(task);
    console.log(`[Factory] Task intake: ${record.id} — ${task.title}`);
    return record;
  }

  async processNext(useAgent = false, doPushPR = false) {
    const task = this.taskManager.next();
    if (!task) { console.log('[Factory] No tasks in queue'); return null; }

    console.log(`[Factory] Processing task: ${task.id} — ${task.title}`);
    this._lastProcessedAt = Date.now();

    try {
      const wt = this.worktreeManager.create(task.id, task.branch || 'main', {
        owner   : task.assignee || task.owner || 'eng',
        ticketId: task.ticketId || task.id,
        labels  : task.labels   || [],
      });
      console.log(`[Factory] Created worktree: ${wt.id} at ${wt.path}`);
      this.taskManager.start(task.id, wt.id);

      let executionResult;

      if (useAgent) {
        const agentSpawn = await this.agentIntegration.spawnAgent(task, wt);
        const agentResult= await this.agentIntegration.waitForAgent(agentSpawn.agentSessionKey);

        // ── FIX #8: always clear the agent tracking entry ────────────────
        this.agentIntegration.clearAgent(task.id);

        if (agentResult.status === 'skipped' || agentResult.status === 'error') {
          this.failTask(task.id, `Agent unavailable or errored: ${agentResult.output || agentResult.error}`);
          return { taskId: task.id, worktreeId: wt.id, worktreePath: wt.path, agentResult, failed: true };
        }
        if (agentResult.status !== 'completed') {
          this.failTask(task.id, `Agent failed: ${agentResult.error}`);
          return { taskId: task.id, worktreeId: wt.id, worktreePath: wt.path, agentResult, failed: true };
        }
        executionResult = agentResult;
      } else {
        executionResult = await this.executor.execute(task);
      }

      const validationResult = this.validator.validate(task, executionResult, this.validationMode);
      this.validator.attachValidationResult(task.id, validationResult);

      if (!validationResult.valid) {
        const fixTask = this.validator.enqueueFix(task, validationResult);
        this.failTask(task.id, `Validation failed: ${validationResult.errors.join('; ')}`);
        return {
          taskId: task.id, worktreeId: wt.id, worktreePath: wt.path,
          executionResult, validationResult, fixTaskId: fixTask?.id ?? null, failed: true,
        };
      }

      let pushPRResult = null;
      if (doPushPR) {
        try {
          pushPRResult = await this.pushPRManager.createPushPR(task, {
            forceMode: false, createPR: this.createPR,
          });
          console.log(`[Factory] Push/PR: ${pushPRResult.message}`);
        } catch (err) {
          console.error(`[Factory] Push/PR failed: ${err.message}`);
          this.failTask(task.id, `Push/PR failed: ${err.message}`);
          return {
            taskId: task.id, worktreeId: wt.id, worktreePath: wt.path,
            executionResult, validationResult, pushPRError: err.message, failed: true,
          };
        }
      }

      this.completeTask(task.id, executionResult);
      return { taskId: task.id, worktreeId: wt.id, worktreePath: wt.path, executionResult, validationResult, pushPRResult };

    } catch (err) {
      console.error(`[Factory] Error processing task ${task.id}: ${err.message}`);
      this.taskManager.fail(task.id, err.message);
      return { taskId: task.id, status: 'failed', failed: true, error: err.message };
    }
  }

  async startAutonomousLoop(useAgent = false, doPushPR = false, intervalMs = 5000) {
    if (this.isRunning) { console.log('[Factory] Loop already running'); return; }

    this.isRunning = true;
    let idleMs     = intervalMs;
    const maxIdleMs= 60_000;

    console.log(`[Factory] Autonomous loop started (agent=${useAgent} push=${doPushPR} baseInterval=${intervalMs}ms)`);

    while (this.isRunning) {
      try {
        const result = await this.processNext(useAgent, doPushPR);

        if (!result) {
          console.log(`[Factory] Queue empty, waiting ${idleMs}ms…`);
          await new Promise(r => setTimeout(r, idleMs));
          idleMs = Math.min(idleMs * 2, maxIdleMs);
        } else {
          idleMs = intervalMs;
          console.log(`[Factory] Task ${result.taskId} → ${result.failed ? 'FAILED' : 'OK'}`);
        }
      } catch (loopErr) {
        console.error(`[Factory] LOOP_ERROR (continuing): ${loopErr.message}`);
        try {
          this.metrics.record({ task: null, startTime: new Date(), endTime: new Date(), passed: false, error: `loop_error: ${loopErr.message}` });
        } catch (_) {}
        await new Promise(r => setTimeout(r, intervalMs));
      }
    }

    console.log('[Factory] Autonomous loop stopped');
  }

  stopAutonomousLoop() {
    this.isRunning = false;
    console.log('[Factory] Autonomous loop stop requested');
  }

  completeTask(taskId, result) {
    this.taskManager.complete(taskId, result);
    const task = this.taskManager.get(taskId);
    if (task?.worktreeId) {
      try { this.worktreeManager.remove(task.worktreeId); } catch (_) {}
    }
    try {
      this.metrics.record({
        task, startTime: task?.startedAt || task?.createdAt || new Date(),
        endTime: new Date(), passed: true, attempts: 1, stages: {},
      });
    } catch (e) { console.warn(`[Factory] Metrics error: ${e.message}`); }
    console.log(`[Factory] Task ${taskId} completed`);
  }

  failTask(taskId, error) {
    this.taskManager.fail(taskId, error);
    const task = this.taskManager.get(taskId);
    if (task?.worktreeId) {
      try { this.worktreeManager.remove(task.worktreeId); } catch (_) {}
    }
    try {
      this.metrics.record({
        task: task || { id: taskId, title: '(unknown)', repo: 'unknown', branch: 'main' },
        startTime: task?.startedAt || task?.createdAt || new Date(),
        endTime: new Date(), passed: false, error,
      });
    } catch (e) { console.warn(`[Factory] Metrics error: ${e.message}`); }
    console.log(`[Factory] Task ${taskId} failed: ${error}`);
  }

  status() {
    const tasks      = this.taskManager.list();
    const byStatus   = s => tasks.filter(t => t.status === s).length;
    return {
      queued      : byStatus('queued'),
      inProgress  : byStatus('in_progress'),
      completed   : byStatus('completed'),
      failed      : byStatus('failed'),
      total       : tasks.length,
      worktrees   : this.worktreeManager.list().length,
      isRunning   : this.isRunning,
      validationMode        : this.validationMode,
      enablePush            : this.enablePush,
      createPR              : this.createPR,
      enableAutoRemediation : this.enableAutoRemediation,
      maxRetryBudget        : this.maxRetryBudget,
      maxRemediationAttempts: this.maxRemediationAttempts,
    };
  }
}

module.exports = CodingFactory;
