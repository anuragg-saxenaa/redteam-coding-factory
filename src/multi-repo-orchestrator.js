/**
 * Multi-Repo Orchestrator — Phase 6
 * Manages multiple CodingFactory instances across different repositories
 * Coordinates task distribution, cross-repo dependencies, and result aggregation
 */

const CodingFactory = require('./factory');
const path = require('path');
const fs = require('fs');

class MultiRepoOrchestrator {
  constructor(config = {}) {
    this.repos = config.repos || []; // Array of { name, path, branch? }
    this.factories = new Map(); // name → CodingFactory instance
    this.globalTaskQueue = []; // Cross-repo tasks
    this.dependencyGraph = new Map(); // taskId → [dependentTaskIds]
    this.results = new Map(); // taskId → result
    this.dataDir = config.dataDir || './data';
    this.maxRetries = config.maxRetries ?? 3;
    this.maxRetryBudget = config.maxRetryBudget ?? 6;
    this.enableAutoRemediation = config.enableAutoRemediation ?? false;
    this.maxRemediationAttempts = config.maxRemediationAttempts ?? 1;
    this.baseDelayMs = config.baseDelayMs ?? 200;
    this.maxDelayMs = config.maxDelayMs ?? 4000;
    this.enablePush = config.enablePush ?? false;
    this.createPR = config.createPR ?? false;
    this.useAgent = !!(config.agent);
    this.agent = config.agent || null;
    this.validationMode = config.validationMode || 'default';
    this.isRunning = false;
    this.repoBranches = new Map();

    this._initializeFactories();
  }

  /**
   * Initialize a CodingFactory for each repo
   */
  _initializeFactories() {
    for (const repo of this.repos) {
      const factoryConfig = {
        baseRepo: repo.path,
        dataDir: path.join(this.dataDir, repo.name),
        worktreeRoot: path.join(this.dataDir, repo.name, 'worktrees'),
        validationMode: this.validationMode,
        enablePush: this.enablePush,
        createPR: this.createPR,
        agent: this.agent,
        maxRetries: this.maxRetries,
        maxRetryBudget: this.maxRetryBudget,
        enableAutoRemediation: this.enableAutoRemediation,
        maxRemediationAttempts: this.maxRemediationAttempts,
        baseDelayMs: this.baseDelayMs,
        maxDelayMs: this.maxDelayMs,
      };
      const factory = new CodingFactory(factoryConfig);
      this.factories.set(repo.name, factory);
      this.repoBranches.set(repo.name, repo.branch || 'main');
      console.log(`[MultiRepoOrchestrator] Initialized factory for repo: ${repo.name}`);
    }
  }

  /**
   * Register a repo (add to orchestrator)
   */
  registerRepo(name, repoPath, branch = 'main') {
    if (this.factories.has(name)) {
      throw new Error(`Repo ${name} already registered`);
    }
    this.repos.push({ name, path: repoPath, branch });
    const factoryConfig = {
      baseRepo: repoPath,
      dataDir: path.join(this.dataDir, name),
      worktreeRoot: path.join(this.dataDir, name, 'worktrees'),
      maxRetries: this.maxRetries,
      maxRetryBudget: this.maxRetryBudget,
      enableAutoRemediation: this.enableAutoRemediation,
      maxRemediationAttempts: this.maxRemediationAttempts,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
    };
    const factory = new CodingFactory(factoryConfig);
    this.factories.set(name, factory);
    this.repoBranches.set(name, branch || 'main');
    console.log(`[MultiRepoOrchestrator] Registered repo: ${name}`);
  }

  /**
   * Submit a task to a specific repo
   */
  submitTask(repoName, task) {
    const factory = this.factories.get(repoName);
    if (!factory) throw new Error(`Repo ${repoName} not found`);
    const record = factory.submitTask(task);
    this.globalTaskQueue.push({ repoName, taskId: record.id, task: record });
    return record;
  }

  /**
   * Submit a cross-repo task with dependencies
   * @param {Object} task - { title, description, repos: [{ name, changes }], dependencies: [taskIds] }
   */
  submitCrossRepoTask(task) {
    const taskId = `cross-repo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const record = {
      id: taskId,
      title: task.title,
      description: task.description,
      repos: task.repos,
      dependencies: task.dependencies || [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.globalTaskQueue.push({ taskId, task: record, isCrossRepo: true });

    // Register dependencies
    for (const depId of record.dependencies) {
      if (!this.dependencyGraph.has(depId)) {
        this.dependencyGraph.set(depId, []);
      }
      this.dependencyGraph.get(depId).push(taskId);
    }

    console.log(`[MultiRepoOrchestrator] Cross-repo task submitted: ${taskId}`);
    return record;
  }

  /**
   * Process next task in global queue
   * Respects dependencies: only process if all dependencies are resolved
   */
  async processNext() {
    if (this.globalTaskQueue.length === 0) {
      console.log('[MultiRepoOrchestrator] No tasks in queue');
      return null;
    }

    // Find first task with no unresolved dependencies
    let taskEntry = null;
    for (const entry of this.globalTaskQueue) {
      const task = entry.task;
      const canProcess = !task.dependencies || task.dependencies.every(depId => {
        const depResult = this.results.get(depId);
        return depResult && depResult.status === 'completed';
      });

      if (canProcess) {
        taskEntry = entry;
        break;
      }
    }

    if (!taskEntry) {
      console.log('[MultiRepoOrchestrator] All remaining tasks have unresolved dependencies');
      return null;
    }

    // Remove from queue
    this.globalTaskQueue = this.globalTaskQueue.filter(e => e !== taskEntry);

    if (taskEntry.isCrossRepo) {
      return await this._processCrossRepoTask(taskEntry.task);
    } else {
      return await this._processRepoTask(taskEntry.repoName, taskEntry.taskId);
    }
  }

  /**
   * Process a single-repo task
   */
  async _processRepoTask(repoName, taskId) {
    const factory = this.factories.get(repoName);
    if (!factory) throw new Error(`Repo ${repoName} not found`);

    console.log(`[MultiRepoOrchestrator] Processing task ${taskId} in repo ${repoName}`);
    try {
      const result = await factory.processNext(this.useAgent, this.enablePush && this.createPR);
      const normalized = result || {
        taskId,
        status: 'failed',
        failed: true,
        error: 'processNext returned no result',
      };

      const status = normalized.status || (normalized.failed ? 'failed' : 'completed');
      this.results.set(taskId, { ...normalized, status, repoName });

      if (status === 'completed') {
        console.log(`[MultiRepoOrchestrator] Task ${taskId} completed in ${repoName}`);
      } else {
        console.log(`[MultiRepoOrchestrator] Task ${taskId} failed in ${repoName}`);
      }

      return normalized;
    } catch (error) {
      const failedResult = {
        taskId,
        status: 'failed',
        failed: true,
        error: error.message,
        repoName,
      };
      this.results.set(taskId, failedResult);
      console.error(`[MultiRepoOrchestrator] Task ${taskId} errored in ${repoName}: ${error.message}`);
      return failedResult;
    }
  }

  /**
   * Process a cross-repo task
   * Coordinates changes across multiple repos
   */
  async _processCrossRepoTask(task) {
    console.log(`[MultiRepoOrchestrator] Processing cross-repo task: ${task.id}`);

    const results = {};
    for (const repoSpec of task.repos) {
      const factory = this.factories.get(repoSpec.name);
      if (!factory) {
        console.error(`[MultiRepoOrchestrator] Repo ${repoSpec.name} not found`);
        results[repoSpec.name] = { status: 'failed', error: 'Repo not found' };
        continue;
      }

      // Submit task to this repo
      const repoTask = {
        title: task.title,
        description: `${task.description}\n\nChanges for ${repoSpec.name}: ${JSON.stringify(repoSpec.changes)}`,
        repo: factory.baseRepo,
        branch: this.repoBranches.get(repoSpec.name) || 'main',
      };

      const record = factory.submitTask(repoTask);
      const result = await factory.processNext(this.useAgent, this.enablePush && this.createPR);
      results[repoSpec.name] = result || { status: 'pending' };
    }

    const crossRepoResult = {
      taskId: task.id,
      status: Object.values(results).every(r => r.status === 'completed') ? 'completed' : 'partial',
      results,
      completedAt: new Date().toISOString(),
    };

    this.results.set(task.id, crossRepoResult);
    console.log(`[MultiRepoOrchestrator] Cross-repo task ${task.id} completed`);
    return crossRepoResult;
  }

  /**
   * Start autonomous loop: process all tasks until queue is empty
   */
  async startAutonomousLoop() {
    this.isRunning = true;
    console.log('[MultiRepoOrchestrator] Starting autonomous loop');

    while (this.isRunning && this.globalTaskQueue.length > 0) {
      const result = await this.processNext();
      if (!result) {
        // All remaining tasks have unresolved dependencies or queue is empty
        break;
      }
    }

    console.log('[MultiRepoOrchestrator] Autonomous loop completed');
    this.isRunning = false;
    return this.getResults();
  }

  /**
   * Get aggregated results
   */
  getResults() {
    const summary = {
      totalTasks: this.results.size,
      completed: Array.from(this.results.values()).filter(r => r.status === 'completed').length,
      failed: Array.from(this.results.values()).filter(r => r.status === 'failed' || r.status === 'partial').length,
      results: Array.from(this.results.entries()).map(([id, result]) => ({ id, ...result })),
    };
    return summary;
  }

  /**
   * Get status of a specific task
   */
  getTaskStatus(taskId) {
    return this.results.get(taskId) || { status: 'pending' };
  }

  /**
   * List all registered repos
   */
  listRepos() {
    return Array.from(this.factories.keys());
  }

  /**
   * Get factory for a repo
   */
  getFactory(repoName) {
    return this.factories.get(repoName);
  }

  /**
   * Run - alias for startAutonomousLoop() for RedTeamFactory compatibility
   */
  async run() {
    return this.startAutonomousLoop();
  }
}

module.exports = MultiRepoOrchestrator;
