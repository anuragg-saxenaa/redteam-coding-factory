/**
 * Coding Factory Orchestrator — Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5
 * Coordinates task intake, worktree creation, agent execution, validation, push/PR, and autonomous loop
 */

const TaskManager = require('./task-manager');
const WorktreeManager = require('./worktree-manager');
const CodeExecutor = require('./code-executor');
const AgentIntegration = require('./agent-integration');
const ResultValidator = require('./result-validator');
const CriticGate = require('./critic-gate');
const PushPRManager = require('./push-pr-manager');
const MetricsWriter = require('./metrics-writer');
const path = require('path');

class CodingFactory {
  constructor(config = {}) {
    this.baseRepo = config.baseRepo || process.cwd();
    this.dataDir = config.dataDir || './data';
    this.worktreeRoot = config.worktreeRoot || './worktrees';
    this.validationMode = config.validationMode || 'default'; // 'default' or 'strict'
    this.enablePush = config.enablePush || false; // safety: disabled by default
    this.createPR = config.createPR || false; // safety: disabled by default

    this.taskManager = new TaskManager(path.join(this.dataDir, 'task-queue.jsonl'));
    this.worktreeManager = new WorktreeManager(this.baseRepo, this.worktreeRoot);
    this.executor = new CodeExecutor(this.worktreeManager, {
      maxRetries:  config.maxRetries  || 3,
      baseDelayMs: config.baseDelayMs || 200,
    });
    this.agentIntegration = new AgentIntegration(this);
    this.validator = new ResultValidator(this.taskManager, this);
    this.criticGate = new CriticGate(this.taskManager);
    this.pushPRManager = new PushPRManager(this.worktreeManager, this.taskManager, {
      enablePush: this.enablePush,
      gitHubCliPath: config.gitHubCliPath || 'gh'
    });
    this.metrics = new MetricsWriter({
      metricsPath: config.metricsPath || path.join(__dirname, '..', 'ops', 'metrics.json'),
    });
    
    this.isRunning = false;
  }

  /**
   * Submit a new task to the factory
   * @param {Object} task - { title, description, repo, branch?, assignee? }
   * @returns {Object} - task record
   */
  submitTask(task) {
    const record = this.taskManager.intake(task);
    console.log(`[Factory] Task intake: ${record.id} — ${task.title}`);
    return record;
  }

  /**
   * Process next task in queue
   * Phase 1: create worktree, mark as in_progress
   * Phase 2: execute code (lint, test, commit)
   * Phase 3: spawn agent for autonomous work
   * Phase 4: validate results and enqueue fixes if needed
   * Phase 5: push/PR creation with Critic gate
   */
  async processNext(useAgent = false, doPushPR = false) {
    const task = this.taskManager.next();
    if (!task) {
      console.log('[Factory] No tasks in queue');
      return null;
    }

    console.log(`[Factory] Processing task: ${task.id} — ${task.title}`);

    try {
      // Phase 1: Create isolated worktree
      const wt = this.worktreeManager.create(task.id, task.branch || 'main');
      console.log(`[Factory] Created worktree: ${wt.id} at ${wt.path}`);

      // Mark task as in_progress
      this.taskManager.start(task.id, wt.id);
      console.log(`[Factory] Task ${task.id} now in_progress`);

      let executionResult;

      // Phase 3: Spawn agent if requested
      if (useAgent) {
        console.log(`[Factory] Spawning agent for task ${task.id}...`);
        const agentSpawn = await this.agentIntegration.spawnAgent(task, wt);
        const agentResult = await this.agentIntegration.waitForAgent(agentSpawn.agentSessionKey);
        
        if (agentResult.status !== 'completed') {
          this.failTask(task.id, `Agent failed: ${agentResult.error}`);
          return {
            taskId: task.id,
            worktreeId: wt.id,
            worktreePath: wt.path,
            agentResult,
            failed: true
          };
        }
        executionResult = agentResult;
      } else {
        // Phase 2: Execute code inside worktree (fallback if no agent)
        console.log(`[Factory] Executing task ${task.id}...`);
        executionResult = await this.executor.execute(task);
      }

      // Phase 4: Validate results
      console.log(`[Factory] Validating task ${task.id}...`);
      const validationResult = this.validator.validate(task, executionResult, this.validationMode);
      this.validator.attachValidationResult(task.id, validationResult);

      if (!validationResult.valid) {
        console.log(`[Factory] Task ${task.id} validation failed, enqueueing fix subtask`);
        const fixTask = this.validator.enqueueFix(task, validationResult);
        this.failTask(task.id, `Validation failed: ${validationResult.errors.join('; ')}`);
        return {
          taskId: task.id,
          worktreeId: wt.id,
          worktreePath: wt.path,
          executionResult,
          validationResult,
          fixTaskId: fixTask ? fixTask.id : null,
          failed: true
        };
      }

      // Phase 5: Push/PR creation (if requested and validation passed)
      let pushPRResult = null;
      if (doPushPR) {
        try {
          console.log(`[Factory] Creating push/PR for task ${task.id}...`);
          pushPRResult = this.pushPRManager.createPushPR(task, {
            forceMode: false,
            createPR: this.createPR
          });
          console.log(`[Factory] Push/PR successful: ${pushPRResult.message}`);
        } catch (error) {
          console.error(`[Factory] Push/PR failed: ${error.message}`);
          this.failTask(task.id, `Push/PR failed: ${error.message}`);
          return {
            taskId: task.id,
            worktreeId: wt.id,
            worktreePath: wt.path,
            executionResult,
            validationResult,
            pushPRError: error.message,
            failed: true
          };
        }
      }

      // Validation passed, push/PR successful (if attempted)
      this.completeTask(task.id, executionResult);
      return {
        taskId: task.id,
        worktreeId: wt.id,
        worktreePath: wt.path,
        executionResult,
        validationResult,
        pushPRResult
      };
    } catch (error) {
      console.error(`[Factory] Error processing task ${task.id}:`, error.message);
      this.taskManager.fail(task.id, error.message);
      return null;
    }
  }

  /**
   * Start autonomous loop
   * Continuously processes tasks from queue
   */
  async startAutonomousLoop(useAgent = false, doPushPR = false, intervalMs = 5000) {
    if (this.isRunning) {
      console.log('[Factory] Autonomous loop already running');
      return;
    }

    this.isRunning = true;
    console.log(`[Factory] Starting autonomous loop (interval: ${intervalMs}ms, useAgent: ${useAgent}, doPushPR: ${doPushPR}, validationMode: ${this.validationMode})`);

    while (this.isRunning) {
      const result = await this.processNext(useAgent, doPushPR);
      
      if (!result) {
        console.log('[Factory] Queue empty, waiting...');
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      } else {
        console.log(`[Factory] Task ${result.taskId} processed`);
      }
    }
  }

  /**
   * Stop autonomous loop
   */
  stopAutonomousLoop() {
    this.isRunning = false;
    console.log('[Factory] Autonomous loop stopped');
  }

  /**
   * Complete a task and record metrics
   */
  completeTask(taskId, result) {
    this.taskManager.complete(taskId, result);
    const task = this.taskManager.get(taskId);
    if (task && task.worktreeId) {
      this.worktreeManager.remove(task.worktreeId);
      console.log(`[Factory] Cleaned up worktree: ${task.worktreeId}`);
    }
    // Record metrics
    try {
      this.metrics.record({
        task,
        startTime: task?.startedAt || task?.createdAt || new Date(),
        endTime:   new Date(),
        passed:    true,
        attempts:  result?.healingReport
          ? Math.max(...Object.values(result.healingReport).filter(Number.isFinite), 1)
          : 1,
        stages:    result?.steps
          ? Object.fromEntries((result.steps || []).map(s => [s.name, { success: s.success, attempts: s.attempts }]))
          : {},
      });
    } catch (e) {
      console.warn(`[Factory] Metrics record error: ${e.message}`);
    }
    console.log(`[Factory] Task ${taskId} completed`);
  }

  /**
   * Fail a task and record metrics
   */
  failTask(taskId, error) {
    this.taskManager.fail(taskId, error);
    const task = this.taskManager.get(taskId);
    if (task && task.worktreeId) {
      this.worktreeManager.remove(task.worktreeId);
      console.log(`[Factory] Cleaned up worktree: ${task.worktreeId}`);
    }
    // Record metrics
    try {
      this.metrics.record({
        task: task || { id: taskId, title: '(unknown)', repo: 'unknown', branch: 'main' },
        startTime: task?.startedAt || task?.createdAt || new Date(),
        endTime:   new Date(),
        passed:    false,
        error,
      });
    } catch (e) {
      console.warn(`[Factory] Metrics record error: ${e.message}`);
    }
    console.log(`[Factory] Task ${taskId} failed: ${error}`);
  }

  /**
   * Get factory status
   */
  status() {
    const tasks = this.taskManager.list();
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
      worktrees: this.worktreeManager.list().length,
      isRunning: this.isRunning,
      validationMode: this.validationMode,
      enablePush: this.enablePush,
      createPR: this.createPR
    };
  }
}

module.exports = CodingFactory;
