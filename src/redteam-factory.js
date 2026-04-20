/**
 * RedTeam Coding Factory — Production Wrapper
 *
 * Production-hardened:
 *   #5  SIGTERM / SIGINT graceful shutdown: marks in-progress tasks as failed,
 *       stops the autonomous loop, tears down the dashboard cleanly.
 *       Process exits with code 0 so supervisors (PM2 / systemd) know it was
 *       intentional and can restart on schedule rather than immediately.
 */

import path from 'node:path';
import fs from 'node:fs';
import MultiRepoOrchestrator from './multi-repo-orchestrator.js';
import DashboardService from './dashboard/dashboard-service.js';
import CodingFactory from './factory.js';

class RedTeamFactory {
  constructor(config = {}) {
    this.config = {
      workspaceRoot          : config.workspaceRoot           || process.env.FACTORY_WORKSPACE_ROOT || process.cwd(),
      dataDir                : config.dataDir                 || process.env.FACTORY_DATA_DIR       || './.factory-data',
      enablePush             : config.enablePush              ?? (process.env.FACTORY_ENABLE_PUSH === 'true'),
      createPR               : config.createPR               ?? false,
      enableAutoRemediation  : config.enableAutoRemediation   ?? false,
      maxRetryBudget         : config.maxRetryBudget          ?? 6,
      maxRemediationAttempts : config.maxRemediationAttempts  ?? 1,
      maxRetries             : config.maxRetries              ?? 3,
      ...config,
    };

    this.repos       = config.repos || [];
    this.orchestrator= null;
    this.taskLog     = [];
    this.resultLog   = [];
    this.dashboard   = null;
    this.factories   = new Map();
    this._shuttingDown = false;

    // ── FIX #5: register graceful shutdown handlers ─────────────────
    this._registerShutdownHandlers();
  }

  // ── FIX #5: graceful shutdown ─────────────────────────────────────
  _registerShutdownHandlers() {
    const shutdown = async (signal) => {
      if (this._shuttingDown) return; // prevent double-execution
      this._shuttingDown = true;
      console.log(`\n[RedTeamFactory] ${signal} received — graceful shutdown started`);

      try {
        // 1. Stop the autonomous loop so no new tasks are dequeued
        if (this.orchestrator) {
          for (const factory of this.orchestrator.factories?.values?.() || []) {
            if (typeof factory.stopAutonomousLoop === 'function') factory.stopAutonomousLoop();
          }
        }

        // 2. Fail any tasks currently in_progress so queue is not stuck on restart
        for (const factory of this.orchestrator?.factories?.values?.() || []) {
          if (!factory.taskManager) continue;
          const inProgress = factory.taskManager.list().filter(t => t.status === 'in_progress');
          for (const t of inProgress) {
            try {
              factory.failTask(t.id, `Process shutdown (${signal})`);
              console.log(`[RedTeamFactory] Marked task ${t.id} as failed (shutdown)`);
            } catch (_) {}
          }
        }

        // 3. Stop the dashboard
        await this.stop();

        console.log('[RedTeamFactory] Graceful shutdown complete — exiting');
      } catch (e) {
        console.error(`[RedTeamFactory] Error during shutdown: ${e.message}`);
      }

      process.exit(0);
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT',  () => shutdown('SIGINT'));

    // Catch unhandled rejections so they don't silently kill the process
    process.on('unhandledRejection', (reason) => {
      console.error('[RedTeamFactory] Unhandled rejection (non-fatal):', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[RedTeamFactory] Uncaught exception (non-fatal):', err.message);
    });
  }

  initialize(repos) {
    this.repos = repos;
    const orchestratorConfig = {
      repos: repos.map(r => ({ name: r.name, path: r.path, branch: r.branch || 'main' })),
      dataDir                : this.config.dataDir,
      maxRetries             : this.config.maxRetries,
      maxRetryBudget         : this.config.maxRetryBudget,
      enableAutoRemediation  : this.config.enableAutoRemediation,
      maxRemediationAttempts : this.config.maxRemediationAttempts,
      baseDelayMs            : this.config.baseDelayMs,
      maxDelayMs             : this.config.maxDelayMs,
      enablePush             : this.config.enablePush,
      createPR               : this.config.createPR,
      agent                  : this.config.agent,
      validationMode         : this.config.validationMode,
    };

    this.orchestrator = new MultiRepoOrchestrator(orchestratorConfig);
    console.log(`[RedTeamFactory] Initialized with ${repos.length} repos`);

    this._initializeDashboard();
    return this.orchestrator;
  }

  _initializeDashboard() {
    if (this.config.enableDashboard === false) return;
    try {
      const dashboardOptions = {
        port   : this.config.dashboardPort !== undefined ? this.config.dashboardPort : 3000,
        dataDir: this.config.dataDir,
      };
      this.dashboard = new DashboardService(this, dashboardOptions);
      this.dashboard.start();
      console.log('[RedTeamFactory] Dashboard started');
    } catch (e) {
      console.warn(`[RedTeamFactory] Dashboard failed to start (non-fatal): ${e.message}`);
    }
  }

  async stop() {
    if (this.dashboard) {
      try { await this.dashboard.stop(); } catch (_) {}
      this.dashboard = null;
    }
    // Also close health servers on any underlying factories
    if (this.orchestrator) {
      for (const factory of this.orchestrator.factories?.values?.() || []) {
        if (typeof factory.stopHealthServer === 'function') {
          try { factory.stopHealthServer(); } catch (_) {}
        }
      }
    }
  }

  submitTask(repoName, task) {
    if (!this.orchestrator) throw new Error('Factory not initialized. Call initialize() first.');
    const submitted = this.orchestrator.submitTask(repoName, task);
    this.taskLog.push(submitted);
    return submitted;
  }

  async run() {
    if (!this.orchestrator) throw new Error('Factory not initialized. Call initialize() first.');
    const results = await this.orchestrator.run();
    this.resultLog.push(results);
    return results;
  }

  getTaskHistory()   { return this.taskLog; }
  getResultHistory() { return this.resultLog; }

  saveState(filePath) {
    const state = {
      config   : this.config,
      repos    : this.repos,
      taskLog  : this.taskLog,
      resultLog: this.resultLog,
      timestamp: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  loadState(filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`State file not found: ${filePath}`);
    const state    = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    this.taskLog   = state.taskLog   || [];
    this.resultLog = state.resultLog || [];
    return state;
  }

  status() {
    const tasks      = this.taskLog;
    const byStatus   = s => tasks.filter(t => t.status === s).length;
    return {
      queued      : byStatus('queued'),
      inProgress  : byStatus('in_progress'),
      completed   : byStatus('completed'),
      failed      : byStatus('failed'),
      total       : tasks.length,
      isRunning   : this.orchestrator?.isRunning || false,
      enablePush  : this.config.enablePush,
      createPR    : this.config.createPR,
      enableAutoRemediation  : this.config.enableAutoRemediation,
      maxRetryBudget         : this.config.maxRetryBudget,
      maxRemediationAttempts : this.config.maxRemediationAttempts,
      dashboardEnabled       : this.dashboard !== null,
    };
  }
}

export default RedTeamFactory;
export { RedTeamFactory };