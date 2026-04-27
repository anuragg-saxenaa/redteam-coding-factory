/**
 * Self-Healing CI — TICKET-2026-02-24-01 + TICKET-2026-02-25-02
 *
 * Implements:
 *  - Stage-level retries with exponential back-off
 *  - Failure classification (transient vs permanent)
 *  - Guarded auto-remediation with scoped fix plans
 *  - Capped retry budget and explicit human escalation payloads
 */

const FAILURE_CLASSES = {
  // Transient — safe to retry automatically
  NETWORK_ERROR:    { transient: true,  hint: 'Check network connectivity / registry availability' },
  FLAKY_TEST:       { transient: true,  hint: 'Re-run the test suite; consider adding retry decorators' },
  LOCK_CONTENTION:  { transient: true,  hint: 'Another process holds a lock; wait and retry' },
  TIMEOUT:          { transient: true,  hint: 'Stage timed out; retry with extended timeout' },

  // Permanent — requires code change, escalate after a bounded fix cycle
  LINT_ERROR:       { transient: false, hint: 'Fix lint violations before re-running' },
  TYPE_ERROR:       { transient: false, hint: 'Fix type errors; check type annotations' },
  TEST_FAILURE:     { transient: false, hint: 'Fix failing assertions; check business logic' },
  BUILD_ERROR:      { transient: false, hint: 'Fix compilation errors; check syntax and imports' },
  DEPENDENCY_ERROR: { transient: false, hint: 'Install missing dependencies or fix version conflicts' },

  // Unknown — retry once, then escalate
  UNKNOWN:          { transient: true,  hint: 'Unknown failure; retry once then escalate' },
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_RETRY_BUDGET = 6;
const DEFAULT_MAX_REMEDIATION_ATTEMPTS = 1;
const TRANSIENT_MAX_RETRIES = 3;
const PERMANENT_MAX_RETRIES = 1;

/**
 * Classify a stage failure from its error message / output.
 * Returns one of the FAILURE_CLASSES keys.
 */
function classifyFailure(error = '', output = '') {
  const combined = `${error} ${output}`.toLowerCase();

  if (/econnrefused|network|fetch failed|dns/.test(combined))    return 'NETWORK_ERROR';
  if (/lock|eacces|permission denied/.test(combined))            return 'LOCK_CONTENTION';
  if (/timed? ?out|etimedout/.test(combined))                    return 'TIMEOUT';
  if (/flaky|intermittent|retry/.test(combined))                 return 'FLAKY_TEST';
  if (/eslint|lint error|no-unused|no-undef|missing script[:\s\"']*lint/.test(combined)) return 'LINT_ERROR';
  if (/typeerror|ts\(|type error|type mismatch/.test(combined))  return 'TYPE_ERROR';
  if (/syntaxerror|unexpected token|cannot find module/.test(combined)) return 'BUILD_ERROR';
  if (/cannot resolve|missing peer|not found: \w+@/.test(combined))    return 'DEPENDENCY_ERROR';
  if (/\bassert\b|\.to\.equal|\.toequal|test failed|assertion/.test(combined)) return 'TEST_FAILURE';

  return 'UNKNOWN';
}

function defaultRemediationScope(classification) {
  switch (classification) {
    case 'LINT_ERROR':
      return { type: 'lint-only', files: ['**/*.{js,ts,tsx,jsx}'], risk: 'low' };
    case 'TYPE_ERROR':
      return { type: 'type-system', files: ['**/*.{ts,tsx,d.ts}'], risk: 'medium' };
    case 'TEST_FAILURE':
      return { type: 'test-targeted', files: ['test/**/*', 'src/**/*'], risk: 'medium' };
    case 'BUILD_ERROR':
      return { type: 'build-targeted', files: ['src/**/*', 'package.json'], risk: 'medium' };
    case 'DEPENDENCY_ERROR':
      return { type: 'dependency', files: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'], risk: 'medium' };
    default:
      return { type: 'minimal', files: [], risk: 'high' };
  }
}

/**
 * SelfHealingCI
 *
 * Wraps an async stage function and retries it according to the
 * failure class, with a global retry budget and optional remediation hook.
 */
class SelfHealingCI {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetryBudget = options.maxRetryBudget ?? DEFAULT_MAX_RETRY_BUDGET;
    this.maxRemediationAttempts = options.maxRemediationAttempts ?? DEFAULT_MAX_REMEDIATION_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8000;
    this.onRetry = options.onRetry || null;
    this.onEscalate = options.onEscalate || null;

    this.enableAutoRemediation = options.enableAutoRemediation ?? false;
    this.remediationGenerator = options.remediationGenerator || null;
    this.remediationExecutor = options.remediationExecutor || null;
    this.onRemediation = options.onRemediation || null;

    this._attempts = {}; // stageName -> attempt count
    this._retryBudgetUsed = 0;
    this._remediationHistory = [];
    this._escalations = [];
  }

  _canSpendBudget() {
    return this._retryBudgetUsed < this.maxRetryBudget;
  }

  _spendBudget() {
    this._retryBudgetUsed++;
  }

  _shouldAttemptRemediation(classification, attempt, remediationAttempts) {
    if (!this.enableAutoRemediation) return false;
    if (!this.remediationGenerator || !this.remediationExecutor) return false;
    if (remediationAttempts >= this.maxRemediationAttempts) return false;
    if (classification === 'UNKNOWN' && attempt > 1) return false;
    return ['LINT_ERROR', 'TYPE_ERROR', 'TEST_FAILURE', 'BUILD_ERROR', 'DEPENDENCY_ERROR', 'UNKNOWN'].includes(classification);
  }

  _buildRemediationPlan(stageName, classification, result, attempt) {
    const basePlan = {
      stageName,
      classification,
      scope: defaultRemediationScope(classification),
      hint: FAILURE_CLASSES[classification]?.hint || FAILURE_CLASSES.UNKNOWN.hint,
      attempt,
      error: result?.error || '',
      output: result?.output || '',
      createdAt: new Date().toISOString(),
    };

    const customPlan = this.remediationGenerator(stageName, classification, result, attempt, {
      budget: { used: this._retryBudgetUsed, max: this.maxRetryBudget },
      scope: basePlan.scope,
      hint: basePlan.hint,
    }) || {};

    return {
      ...basePlan,
      ...customPlan,
      scope: customPlan.scope || basePlan.scope,
    };
  }

  _recordEscalation(escalation) {
    this._escalations.push(escalation);
    if (this.onEscalate) {
      try {
        this.onEscalate(escalation.stageName, escalation);
      } catch (_) {
        // ignore callback failures
      }
    }
  }

  async runStage(stageName, stageFn) {
    this._attempts[stageName] = 0;
    let remediationAttempts = 0;
    let lastClassification = 'UNKNOWN';
    let lastResult = { success: false, error: 'no execution', output: '' };
    const history = [];

    while (true) {
      if (!this._canSpendBudget()) {
        const budgetEscalation = {
          success: false,
          stageName,
          reason: 'retry_budget_exhausted',
          attempts: this._attempts[stageName],
          classification: lastClassification,
          hint: FAILURE_CLASSES[lastClassification]?.hint || FAILURE_CLASSES.UNKNOWN.hint,
          transient: FAILURE_CLASSES[lastClassification]?.transient ?? true,
          lastError: lastResult?.error || 'unknown',
          history,
          budget: { used: this._retryBudgetUsed, max: this.maxRetryBudget },
          needsHuman: true,
        };
        this._recordEscalation(budgetEscalation);
        return budgetEscalation;
      }

      this._attempts[stageName]++;
      this._spendBudget();
      const attempt = this._attempts[stageName];

      let result;
      try {
        result = await stageFn();
      } catch (err) {
        result = { success: false, error: err.message, output: '' };
      }

      const passed = result && result.success === true;
      lastResult = result;

      history.push({
        type: 'stage',
        attempt,
        success: passed,
        error: result?.error || null,
        output: result?.output || null,
        ts: new Date().toISOString(),
      });

      if (passed) {
        return {
          success: true,
          attempts: attempt,
          history,
          budget: { used: this._retryBudgetUsed, max: this.maxRetryBudget },
          remediationAttempts,
        };
      }

      const classification = classifyFailure(result?.error || '', result?.output || '');
      lastClassification = classification;
      const meta = FAILURE_CLASSES[classification];
      const maxForClass = meta.transient ? TRANSIENT_MAX_RETRIES : PERMANENT_MAX_RETRIES;
      const effectiveRetries = Math.min(this.maxRetries, maxForClass);

      if (this.onRetry) {
        try {
          this.onRetry(attempt, classification, meta.hint, stageName);
        } catch (_) {
          // ignore callback failures
        }
      }

      let remediationApplied = false;
      if (this._shouldAttemptRemediation(classification, attempt, remediationAttempts)) {
        const plan = this._buildRemediationPlan(stageName, classification, result, attempt);
        remediationAttempts++;

        let remediationResult;
        try {
          remediationResult = await this.remediationExecutor(plan);
        } catch (err) {
          remediationResult = { success: false, error: err.message, output: '' };
        }

        const remediationEvent = {
          stageName,
          attempt,
          remediationAttempt: remediationAttempts,
          classification,
          scope: plan.scope,
          commands: plan.commands || [],
          success: remediationResult?.success === true,
          error: remediationResult?.error || null,
          output: remediationResult?.output || null,
          ts: new Date().toISOString(),
        };

        remediationApplied = remediationEvent.success;
        this._remediationHistory.push(remediationEvent);
        history.push({ type: 'remediation', ...remediationEvent });

        if (this.onRemediation) {
          try {
            this.onRemediation(plan, remediationResult, stageName);
          } catch (_) {
            // ignore callback failures
          }
        }
      }

      // If a remediation step applied cleanly, allow one immediate verification run.
      if (remediationApplied) {
        continue;
      }

      if (attempt >= effectiveRetries) {
        const finalEscalation = {
          success: false,
          stageName,
          reason: 'stage_retries_exhausted',
          attempts: attempt,
          classification,
          hint: meta.hint,
          transient: meta.transient,
          lastError: result?.error || 'unknown',
          history,
          budget: { used: this._retryBudgetUsed, max: this.maxRetryBudget },
          remediationAttempts,
          needsHuman: true,
        };
        this._recordEscalation(finalEscalation);
        return finalEscalation;
      }

      const delay = Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), this.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  async runPipeline(stages) {
    const results = {};
    let allPassed = true;

    for (const { name, fn } of stages) {
      const result = await this.runStage(name, fn);
      results[name] = result;

      if (!result.success) {
        allPassed = false;
        break;
      }
    }

    return { passed: allPassed, results };
  }

  reset() {
    this._attempts = {};
    this._retryBudgetUsed = 0;
    this._remediationHistory = [];
    this._escalations = [];
  }

  summary() {
    return { ...this._attempts };
  }

  report() {
    return {
      attempts: { ...this._attempts },
      budget: { used: this._retryBudgetUsed, max: this.maxRetryBudget },
      remediations: [...this._remediationHistory],
      escalations: [...this._escalations],
    };
  }
}

export { SelfHealingCI, classifyFailure, FAILURE_CLASSES };
export default { SelfHealingCI, classifyFailure, FAILURE_CLASSES };