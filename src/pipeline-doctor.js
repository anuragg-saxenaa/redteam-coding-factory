/**
 * Pipeline Doctor — Self-Healing Layer for Coding Factory
 *
 * When validation fails, Pipeline Doctor:
 * 1. Diagnoses the failure using an LLM judge
 * 2. Generates targeted fix instructions
 * 3. Dispatches the fix back to the coding agent
 * 4. Re-validates
 * 5. Escalates only after N failed attempts with a rich diagnostic payload
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

class PipelineDoctor {
  constructor(config = {}) {
    this.config = {
      judgeModel: config.judgeModel || '9router/cc/claude-sonnet-4-6',
      maxIterations: config.maxIterations ?? 3,
      confidenceThreshold: config.confidenceThreshold ?? 0.3,
      judgeTimeoutMs: config.judgeTimeoutMs ?? 60000,
      fixTimeoutMs: config.fixTimeoutMs ?? 180000,
      maxDiffSize: config.maxDiffSize ?? 16384,
      maxTestOutputSize: config.maxTestOutputSize ?? 8192,
      maxFileContentSize: config.maxFileContentSize ?? 4096,
      maxFilesToInclude: config.maxFilesToInclude ?? 5,
      enableRegressionDetection: config.enableRegressionDetection ?? true,
      judgePromptPath: config.judgePromptPath || path.join(__dirname, '../prompts/pipeline-doctor-judge.md'),
      worktreeRoot: config.worktreeRoot || './worktrees',
      ...config,
    };

    // Metrics
    this.totalActivated = 0;
    this.totalHealed = 0;
    this.totalEscalated = 0;
    this.iterationCount = 0;
    this.byCategory = {};
    this.confidenceHistory = [];
  }

  /**
   * Main entry point — attempt to heal a failed task
   * @param {Object} task - Original task record
   * @param {Object} executionResult - Result from code executor (stdout, stderr, exit code)
   * @param {Object} validationResult - Result from ResultValidator { valid, failures }
   * @param {string} worktreePath - Path to the worktree
   * @param {Object} options - { agentRunner?, validationCommand? }
   * @returns {Object} - { healed, finalResult, iterations, escalationReason, totalCost }
   */
  async heal(task, executionResult, validationResult, worktreePath, options = {}) {
    this.totalActivated++;
    const iterations = [];
    let currentTask = task;
    let currentExecResult = executionResult;
    let currentValidation = validationResult;
    let attempt = 0;

    while (attempt < this.config.maxIterations) {
      attempt++;
      this.iterationCount++;

      // Step 1: Build failure context
      const failureContext = this._buildFailureContext(
        currentTask,
        currentExecResult,
        currentValidation,
        worktreePath,
        attempt,
        iterations
      );

      // Step 2: LLM Judge diagnoses
      const verdict = await this._callJudge(failureContext);

      // Step 3: Decision gate
      if (verdict.confidence < this.config.confidenceThreshold || !verdict.fixable) {
        return this._escalate(task.id, iterations, 'low_confidence_or_not_fixable', {
          diagnosis: verdict.diagnosis,
          confidence: verdict.confidence,
          fixable: verdict.fixable,
          worktreePath,
        });
      }

      // Step 4: Record iteration
      const testResultBefore = this._extractTestResults(currentValidation);
      iterations.push({
        attempt,
        diagnosis: verdict.diagnosis,
        fixInstructions: verdict.fixInstructions,
        confidence: verdict.confidence,
        category: verdict.category,
        estimatedComplexity: verdict.estimatedComplexity,
        riskOfRegression: verdict.riskOfRegression,
        testResultBefore,
        testResultAfter: null,
        improved: null,
      });

      // Step 5: Dispatch fix to coding agent
      const fixResult = await this._dispatchFix(
        currentTask,
        verdict,
        worktreePath,
        options.agentRunner,
        attempt,
        options.validationCommand
      );

      if (fixResult.error) {
        // Agent failed to apply fix — record and continue or escalate
        if (attempt >= this.config.maxIterations) {
          return this._escalate(task.id, iterations, 'fix_agent_error', { worktreePath, error: fixResult.error });
        }
        continue;
      }

      // Step 6: Re-validate
      const revalidationResult = await this._revalidate(worktreePath, options.validationCommand);
      currentValidation = revalidationResult;

      const testResultAfter = this._extractTestResults(revalidationResult);
      const improved = this._detectRegression(testResultBefore, testResultAfter);

      // Update last iteration record
      iterations[iterations.length - 1].testResultAfter = testResultAfter;
      iterations[iterations.length - 1].improved = improved;

      // Track metrics
      this._trackCategory(verdict.category);
      this.confidenceHistory.push(verdict.confidence);

      // Step 7: Decision gate after revalidation
      if (revalidationResult.valid) {
        this.totalHealed++;
        return {
          healed: true,
          finalResult: currentExecResult,
          finalValidation: revalidationResult,
          iterations,
          totalCost: this._estimateCost(iterations),
        };
      }

      // Tests still failing — check for regression
      if (this.config.enableRegressionDetection && improved === false) {
        // Revert bad fix
        await this._revertLastFix(worktreePath);
        if (attempt >= this.config.maxIterations) {
          return this._escalate(task.id, iterations, 'regression_detected', { worktreePath });
        }
      }

      if (attempt >= this.config.maxIterations) {
        return this._escalate(task.id, iterations, 'max_iterations_exceeded', { worktreePath });
      }
    }

    return this._escalate(task.id, iterations, 'max_iterations_exceeded', { worktreePath });
  }

  /**
   * Build the failure context for the LLM judge
   */
  _buildFailureContext(task, executionResult, validationResult, worktreePath, attempt, previousIterations) {
    const failedStage = this._detectFailedStage(validationResult);
    const testOutput = this._truncate(
      (executionResult.stdout || '') + '\n' + (executionResult.stderr || ''),
      this.config.maxTestOutputSize
    );

    const gitDiff = this._getGitDiff(worktreePath, previousIterations.length > 0 ? previousIterations.length : 0);
    const errorMessages = this._extractErrorMessages(testOutput);
    const changedFiles = this._getChangedFiles(worktreePath);
    const fileContents = this._getFileContents(worktreePath, changedFiles);

    const previousDiagnoses = previousIterations.map(i =>
      `Attempt ${i.attempt}: ${i.diagnosis} (confidence: ${i.confidence}, improved: ${i.improved})`
    ).join('\n');

    return {
      taskDescription: `${task.title}\n\n${task.description || ''}`,
      failedStage,
      classification: validationResult.failures?.[0]?.type || 'VALIDATION_FAILURE',
      testOutput,
      gitDiff: this._truncate(gitDiff, this.config.maxDiffSize),
      errorMessages,
      changedFiles,
      fileContents,
      attemptNumber: attempt,
      previousDiagnoses: previousDiagnoses || 'None',
      worktreePath,
    };
  }

  /**
   * Call the LLM judge to diagnose the failure
   */
  async _callJudge(context) {
    const promptTemplate = this._loadJudgePrompt();
    const prompt = this._renderPrompt(promptTemplate, context);

    try {
      const response = await this._callLLM(prompt, {
        model: this.config.judgeModel,
        maxTokens: 800,
        temperature: 0.2,
        timeoutMs: this.config.judgeTimeoutMs,
      });

      return this._parseJudgeResponse(response);
    } catch (error) {
      // Judge failure → treat as very low confidence
      return {
        diagnosis: `Judge call failed: ${error.message}`,
        fixInstructions: '',
        confidence: 0.0,
        fixable: false,
        category: 'judge_error',
        estimatedComplexity: 'unknown',
        riskOfRegression: 'unknown',
      };
    }
  }

  /**
   * Load judge prompt template from file
   */
  _loadJudgePrompt() {
    try {
      return fs.readFileSync(this.config.judgePromptPath, 'utf8');
    } catch {
      // Fallback inline prompt
      return fs.readFileSync(path.join(__dirname, '../prompts/pipeline-doctor-judge.md'), 'utf8');
    }
  }

  /**
   * Render prompt with context values
   */
  _renderPrompt(template, context) {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Call LLM via 9router
   */
  async _callLLM(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: options.model || this.config.judgeModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.maxTokens || 500,
        temperature: options.temperature ?? 0.2,
      });

      const timeout = setTimeout(() => reject(new Error('LLM call timed out')), options.timeoutMs || 60000);

      // Try 9router first, fall back to direct OpenAI-compatible endpoint
      const tryCall = (url) => {
        try {
          const output = execSync(
            `curl -sf -X POST "${url}/v1/chat/completions" ` +
            `-H "Content-Type: application/json" ` +
            `-H "Authorization: Bearer ${process.env.OPENAI_API_KEY || 'dummy'}" ` +
            `-d '${body.replace(/'/g, "'\"'\"'")}' ` +
            `--max-time ${Math.floor((options.timeoutMs || 60000) / 1000)}`,
            { encoding: 'utf8', timeout: options.timeoutMs || 60000 }
          );
          const parsed = JSON.parse(output);
          clearTimeout(timeout);
          resolve(parsed.choices?.[0]?.message?.content || '');
        } catch (e) {
          // fall through to next option or reject
          if (url === this._getJudgeEndpoint()) {
            tryCall('http://localhost:20128/v1');
          } else {
            clearTimeout(timeout);
            reject(e);
          }
        }
      };

      tryCall(this._getJudgeEndpoint());
    });
  }

  _getJudgeEndpoint() {
    return process.env.PIPELINE_DOCTOR_JUDGE_URL || 'http://localhost:20128/v1';
  }

  /**
   * Parse JSON from judge response — handles markdown code blocks
   */
  _parseJudgeResponse(response) {
    // Extract JSON from markdown code block if present
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/) ||
                      response.match(/^\s*\{[\s\S]+?\}/);

    if (!jsonMatch) {
      throw new Error(`Judge did not return valid JSON: ${response.slice(0, 200)}`);
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr.trim());

    // Validate required fields
    return {
      diagnosis: parsed.diagnosis || '',
      fixInstructions: parsed.fixInstructions || '',
      confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0)),
      fixable: parsed.fixable !== false,
      category: parsed.category || 'other',
      estimatedComplexity: parsed.estimatedComplexity || 'unknown',
      riskOfRegression: parsed.riskOfRegression || 'unknown',
    };
  }

  /**
   * Dispatch fix to coding agent in the same worktree
   */
  async _dispatchFix(task, verdict, worktreePath, agentRunner, attempt, validationCommand) {
    const fixPrompt = this._buildFixPrompt(task, verdict, worktreePath, attempt, validationCommand);

    if (agentRunner) {
      // Use provided agent runner
      try {
        const result = await agentRunner.run(fixPrompt, {
          worktreePath,
          timeoutMs: this.config.fixTimeoutMs,
        });
        return { success: true, result };
      } catch (error) {
        return { error: error.message };
      }
    }

    // Fallback: direct git commit message approach (no agent)
    // Returns success but no actual fix applied — agent must handle it
    return { success: false, error: 'No agentRunner provided — Pipeline Doctor cannot apply fixes without a coding agent' };
  }

  /**
   * Build the fix prompt sent to the coding agent
   */
  _buildFixPrompt(task, verdict, attempt, validationCommand) {
    const failingCmd = validationCommand || this._detectFailingCommand(task);
    return `Pipeline Doctor diagnosed a test failure in your previous changes. Apply the fix below.

## Diagnosis
${verdict.diagnosis}

## Fix Instructions
${verdict.fixInstructions}

## Constraints
- Work in the SAME worktree: ${task.worktreePath || 'current directory'}
- Only modify files related to the fix — do not refactor unrelated code.
${failingCmd ? `- Run the failing test after your fix to verify: ${failingCmd}` : ''}
- Commit with message: "fix: ${verdict.diagnosis.slice(0, 60)} (pipeline-doctor attempt ${attempt})"
`;
  }

  /**
   * Re-run validation on the worktree
   */
  async _revalidate(worktreePath, validationCommand) {
    if (!validationCommand) {
      return { valid: false, error: 'No validation command provided' };
    }

    try {
      const output = execSync(validationCommand, {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { valid: true, output };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
      };
    }
  }

  /**
   * Revert the last fix commit
   */
  async _revertLastFix(worktreePath) {
    try {
      execSync('git reset --hard HEAD~1', { cwd: worktreePath });
    } catch (error) {
      // Nothing to revert or already at base
    }
  }

  /**
   * Extract test results from validation result
   */
  _extractTestResults(validationResult) {
    if (validationResult.valid) {
      return { passed: -1, failed: 0 }; // -1 indicates all passed
    }
    const failures = validationResult.failures || [];
    return {
      passed: failures.filter(f => f.type === 'pass').length,
      failed: failures.filter(f => f.type === 'fail').length,
    };
  }

  /**
   * Detect if results got worse
   */
  _detectRegression(before, after) {
    if (before.passed === -1 && after.failed === 0) return null; // was passing, still passing
    if (after.failed > before.failed) return false; // got worse
    if (after.failed < before.failed) return true; // improved
    return null;
  }

  /**
   * Escalate — produce rich payload for human review
   */
  _escalate(taskId, iterations, reason, extra = {}) {
    this.totalEscalated++;
    return {
      healed: false,
      escalationReason: reason,
      iterations,
      finalDiagnosis: iterations.length > 0 ? iterations[iterations.length - 1].diagnosis : 'No diagnosis available',
      suggestedHumanAction: iterations.length > 0
        ? `Review task ${taskId}. Last diagnosis: ${iterations[iterations.length - 1].diagnosis}`
        : `Task ${taskId} requires human review. Pipeline Doctor could not diagnose the issue.`,
      worktreePath: extra.worktreePath || null,
      gitDiff: extra.worktreePath ? this._getGitDiff(extra.worktreePath, iterations.length) : null,
      totalCost: this._estimateCost(iterations),
      error: extra.error || null,
    };
  }

  /**
   * Get git diff for the worktree
   */
  _getGitDiff(worktreePath, sinceAttempt = 0) {
    try {
      const range = sinceAttempt > 0 ? `HEAD~${sinceAttempt}..HEAD` : 'HEAD~1..HEAD';
      return execSync(`git diff ${range}`, { cwd: worktreePath, encoding: 'utf8', timeout: 10000 }) || '';
    } catch {
      try {
        return execSync('git diff HEAD', { cwd: worktreePath, encoding: 'utf8', timeout: 10000 }) || '';
      } catch {
        return '';
      }
    }
  }

  /**
   * Get list of changed files in worktree
   */
  _getChangedFiles(worktreePath) {
    try {
      const output = execSync('git diff --name-only HEAD', { cwd: worktreePath, encoding: 'utf8', timeout: 10000 });
      return output.trim().split('\n').filter(Boolean).slice(0, this.config.maxFilesToInclude);
    } catch {
      return [];
    }
  }

  /**
   * Read contents of changed files
   */
  _getFileContents(worktreePath, changedFiles) {
    const contents = {};
    for (const file of changedFiles.slice(0, this.config.maxFilesToInclude)) {
      try {
        const fullPath = path.join(worktreePath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size < 512 * 1024) { // skip files >512KB
          const content = fs.readFileSync(fullPath, 'utf8');
          contents[file] = this._truncate(content, this.config.maxFileContentSize);
        }
      } catch {
        // skip unreadable files
      }
    }
    return contents;
  }

  /**
   * Detect which validation stage failed
   */
  _detectFailedStage(validationResult) {
    if (!validationResult.failures || validationResult.failures.length === 0) {
      return validationResult.stage || 'unknown';
    }
    const types = validationResult.failures.map(f => f.type);
    if (types.includes('test')) return 'test';
    if (types.includes('lint')) return 'lint';
    if (types.includes('typecheck')) return 'typecheck';
    return validationResult.failures[0].type || 'validation';
  }

  /**
   * Extract error messages from test output
   */
  _extractErrorMessages(testOutput) {
    const lines = testOutput.split('\n');
    const errors = [];
    let inError = false;
    let errorBlock = [];

    for (const line of lines) {
      if (/^(FAIL|ERROR|AssertionError|TypeError|ReferenceError|✗|failed)/i.test(line)) {
        inError = true;
        errorBlock = [line];
      } else if (inError) {
        if (/^\s*$/.test(line) && errorBlock.length > 3) {
          errors.push(errorBlock.join('\n').slice(0, 500));
          inError = false;
        } else if (errorBlock.length < 10) {
          errorBlock.push(line);
        }
      }
    }

    return errors.slice(0, 10);
  }

  /**
   * Detect failing command from task
   */
  _detectFailingCommand(task) {
    if (task.validationCommand) return task.validationCommand;
    return null;
  }

  /**
   * Truncate string to max length
   */
  _truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    return str.slice(0, maxLen) + `\n... [truncated ${str.length - maxLen} chars]`;
  }

  /**
   * Track category for metrics
   */
  _trackCategory(category) {
    this.byCategory[category] = (this.byCategory[category] || 0) + 1;
  }

  /**
   * Rough cost estimation
   */
  _estimateCost(iterations) {
    const judgeTokens = iterations.length * 4000;
    const agentTokens = iterations.length * 15000;
    return {
      judgeTokens,
      agentTokens,
      estimatedUsd: ((judgeTokens * 0.000003) + (agentTokens * 0.000015)).toFixed(4),
    };
  }

  /**
   * Record an escalation for metrics
   */
  recordEscalation(taskId, doctorResult) {
    // Called by factory after escalation — extend metrics here if needed
  }

  /**
   * Report aggregate metrics
   */
  report() {
    return {
      totalActivated: this.totalActivated,
      totalHealed: this.totalHealed,
      totalEscalated: this.totalEscalated,
      healRate: this.totalActivated > 0 ? (this.totalHealed / this.totalActivated).toFixed(3) : 0,
      avgIterations: this.totalActivated > 0 ? (this.iterationCount / this.totalActivated).toFixed(2) : 0,
      byCategory: this.byCategory,
      confidenceHistory: this.confidenceHistory.slice(-20),
    };
  }
}

module.exports = PipelineDoctor;
