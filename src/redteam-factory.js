/**
 * RedTeam Coding Factory — Production Integration
 * Wraps MultiRepoOrchestrator with RedTeam-specific configuration and deployment logic
 */

const MultiRepoOrchestrator = require('./multi-repo-orchestrator');
const DashboardService = require('./dashboard/dashboard-service');
const path = require('path');
const fs = require('fs');

const CodingFactory = require('./factory');

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
    this.dashboard = null;
    
    // Initialize underlying factories for each repo
    this.factories = new Map();
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
    
    // Initialize dashboard
    this.initializeDashboard();
    
    return this.orchestrator;
  }

  /**
   * Initialize dashboard service
   */
  initializeDashboard() {
    if (this.config.enableDashboard !== false) {
      const dashboardOptions = {
        port: this.config.dashboardPort !== undefined ? this.config.dashboardPort : 3000,
        dataDir: this.config.dataDir
      };
      this.dashboard = new DashboardService(this, dashboardOptions);
      this.dashboard.start();
      console.log('[RedTeamFactory] Dashboard service started');
    }
  }

  /**
   * Stop the factory and tear down the dashboard
   */
  async stop() {
    if (this.dashboard) {
      await this.dashboard.stop();
      this.dashboard = null;
    }
  }

  /**
   * Submit a task to a specific repo
   */
  submitTask(repoName, task) {
    if (!this.orchestrator) {
      throw new Error('Factory not initialized. Call initialize() first.');
    }
    const submitted = this.orchestrator.submitTask(repoName, task);
    this.taskLog.push(submitted);
    return submitted;
  }

  /**
   * Run the factory (autonomous loop)
   */
  async run() {
    if (!this.orchestrator) {
      throw new Error('Factory not initialized. Call initialize() first.');
    }
    const results = await this.orchestrator.run();
    this.resultLog.push(results);
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
   * Save factory state to file
   */
  saveState(filePath) {
    const state = {
      config: this.config,
      repos: this.repos,
      taskLog: this.taskLog,
      resultLog: this.resultLog,
      timestamp: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  /**
   * Load factory state from file
   */
  loadState(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`State file not found: ${filePath}`);
    }
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    this.taskLog = state.taskLog || [];
    this.resultLog = state.resultLog || [];
    return state;
  }

  /**
   * Get factory status
   */
  status() {
    const tasks = this.taskLog;
    const queued = tasks.filter(t => t.status === 'queued').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;

    return {
      queued,
      inProgress,
      completed,
      failed,
      total: tasks.length,
      isRunning: this.orchestrator?.isRunning || false,
      enablePush: this.config.enablePush,
      createPR: this.config.createPR,
      enableAutoRemediation: this.config.enableAutoRemediation,
      maxRetryBudget: this.config.maxRetryBudget,
      maxRemediationAttempts: this.config.maxRemediationAttempts,
      dashboardEnabled: this.dashboard !== null
    };
  }

}


module.exports = RedTeamFactory;