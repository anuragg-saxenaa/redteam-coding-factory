/**
 * RedTeam Coding Factory — Production Integration
 * Wraps MultiRepoOrchestrator with RedTeam-specific configuration and deployment logic
 */

const MultiRepoOrchestrator = require('./multi-repo-orchestrator');
const path = require('path');
const fs = require('fs');

class RedTeamFactory {
  constructor(config = {}) {
    this.config = {
      workspaceRoot: config.workspaceRoot || '/Users/redinside/Development/Codebase/projects/RedTeam/github',
      dataDir: config.dataDir || '/Users/redinside/Development/Codebase/projects/RedTeam/.factory-data',
      enablePush: config.enablePush || false,
      createPR: config.createPR || false,
      enableAutoRemediation: config.enableAutoRemediation ?? false,
      maxRetryBudget: config.maxRetryBudget ?? 6,
      maxRemediationAttempts: config.maxRemediationAttempts ?? 1,
      maxRetries: config.maxRetries ?? 3,
      ...config
    };

    this.repos = config.repos || [];
    this.orchestrator = null;
    this.taskLog = [];
    this.resultLog = [];
  }

  /**
   * Initialize the factory with a list of repos
   */
  initialize(repos) {
    this.repos = repos;
    const orchestratorConfig = {
      repos: repos.map(r => ({
        name: r.name,
        path: r.path,
        branch: r.branch || 'main'
      })),
      dataDir: this.config.dataDir,
      maxRetries: this.config.maxRetries,
      maxRetryBudget: this.config.maxRetryBudget,
      enableAutoRemediation: this.config.enableAutoRemediation,
      maxRemediationAttempts: this.config.maxRemediationAttempts,
      baseDelayMs: this.config.baseDelayMs,
      maxDelayMs: this.config.maxDelayMs,
    };

    this.orchestrator = new MultiRepoOrchestrator(orchestratorConfig);
    console.log(`[RedTeamFactory] Initialized with ${repos.length} repos`);
    return this.orchestrator;
  }

  /**
   * Submit a task to a specific repo
   */
  submitTask(repoName, task) {
    if (!this.orchestrator) throw new Error('Factory not initialized');
    const record = this.orchestrator.submitTask(repoName, task);
    this.taskLog.push({
      taskId: record.id,
      repoName,
      title: task.title,
      submittedAt: new Date().toISOString()
    });
    return record;
  }

  /**
   * Submit a cross-repo task
   */
  submitCrossRepoTask(task) {
    if (!this.orchestrator) throw new Error('Factory not initialized');
    const record = this.orchestrator.submitCrossRepoTask(task);
    this.taskLog.push({
      taskId: record.id,
      title: task.title,
      isCrossRepo: true,
      submittedAt: new Date().toISOString()
    });
    return record;
  }

  /**
   * Run the factory autonomously
   */
  async run() {
    if (!this.orchestrator) throw new Error('Factory not initialized');
    console.log('[RedTeamFactory] Starting autonomous run');
    const results = await this.orchestrator.startAutonomousLoop();
    this.resultLog.push({
      runId: `run-${Date.now()}`,
      results,
      completedAt: new Date().toISOString()
    });
    return results;
  }

  /**
   * Get task history
   */
  getTaskHistory() {
    return this.taskLog;
  }

  /**
   * Get result history
   */
  getResultHistory() {
    return this.resultLog;
  }

  /**
   * Export factory state to JSON
   */
  exportState() {
    return {
      config: this.config,
      repos: this.repos,
      taskLog: this.taskLog,
      resultLog: this.resultLog,
      orchestratorState: this.orchestrator ? {
        totalRepos: this.orchestrator.listRepos().length,
        queueSize: this.orchestrator.globalTaskQueue.length,
        resultsCount: this.orchestrator.results.size
      } : null
    };
  }

  /**
   * Save factory state to disk
   */
  saveState(filePath) {
    const state = this.exportState();
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    console.log(`[RedTeamFactory] State saved to ${filePath}`);
  }
}

module.exports = RedTeamFactory;
