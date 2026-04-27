/**
 * Result Validator — Phase 4 POC
 * Validates task execution results and enqueues fix subtasks on failure
 */

class ResultValidator {
  constructor(taskManager, factory) {
    this.taskManager = taskManager;
    this.factory = factory;
    this.validationRules = {
      none: [],
      default: ['lint', 'test'],
      strict: ['lint', 'test', 'typecheck']
    };
  }

  /**
   * Validate execution result
   * @param {Object} task - task record
   * @param {Object} executionResult - result from CodeExecutor
   * @param {string} validationMode - 'default' or 'strict'
   * @returns {Object} - { valid, errors, artifacts }
   */
  validate(task, executionResult, validationMode = 'default') {
    const rules = this.validationRules[validationMode] || this.validationRules.default;
    const errors = [];
    const artifacts = [];
    const steps = Array.isArray(executionResult?.steps) ? executionResult.steps : [];
    let blockedBy = null;
    const suppressed = [];

    console.log(`[Validator] Validating task ${task.id} with mode: ${validationMode}`);

    // Validate stages in order. If a mandatory stage fails/missing, suppress downstream checks.
    for (const rule of rules) {
      if (blockedBy) {
        suppressed.push(rule);
        continue;
      }

      const step = steps.find(s => s.name === rule);

      if (!step) {
        errors.push(`Missing validation step: ${rule}`);
        blockedBy = rule;
        continue;
      }

      if (!step.success) {
        errors.push(`${rule} failed: ${step.error}`);
        artifacts.push({
          type: 'error_log',
          step: rule,
          content: step.error
        });
        blockedBy = rule;
      }
    }

    if (blockedBy && suppressed.length > 0) {
      artifacts.push({
        type: 'validation_short_circuit',
        step: blockedBy,
        content: `Skipped downstream validation checks: ${suppressed.join(', ')}`
      });
    }

    const valid = errors.length === 0;
    console.log(`[Validator] Task ${task.id} validation: ${valid ? 'PASS' : 'FAIL'}`);

    return {
      valid,
      errors,
      artifacts,
      validatedAt: new Date().toISOString()
    };
  }

  /**
   * Enqueue a fix subtask if validation fails
   * @param {Object} task - original task
   * @param {Object} validationResult - result from validate()
   * @returns {Object} - fix subtask record
   */
  enqueueFix(task, validationResult) {
    if (validationResult.valid) {
      console.log(`[Validator] Task ${task.id} passed validation, no fix needed`);
      return null;
    }

    const fixTask = {
      title: `[FIX] ${task.title}`,
      description: `Fix validation failures from task ${task.id}:\n\n${validationResult.errors.join('\n')}\n\nArtifacts:\n${JSON.stringify(validationResult.artifacts, null, 2)}`,
      repo: task.repo,
      branch: task.branch,
      parentTaskId: task.id,
      isFixTask: true
    };

    const record = this.taskManager.intake(fixTask);
    console.log(`[Validator] Enqueued fix subtask: ${record.id} for parent ${task.id}`);

    return record;
  }

  /**
   * Attach validation result to task record
   */
  attachValidationResult(taskId, validationResult) {
    const task = this.taskManager.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.validationResult = validationResult;
    this.taskManager.persistQueue();

    console.log(`[Validator] Attached validation result to task ${taskId}`);
  }
}

export default ResultValidator;
export { ResultValidator };