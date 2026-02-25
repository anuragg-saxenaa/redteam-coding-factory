/**
 * Self-Healing CI — TICKET-2026-02-24-01
 *
 * Implements:
 *  - Stage-level retries with exponential back-off
 *  - Failure classification (transient vs permanent)
 *  - Capped retry loop (max 3 attempts per stage)
 *  - Structured remediation hints per failure class
 *
 * Designed to wrap CodeExecutor stages so the factory can
 * self-heal before escalating to a human reviewer.
 */

const FAILURE_CLASSES = {
  // Transient — safe to retry automatically
  NETWORK_ERROR:    { transient: true,  hint: 'Check network connectivity / registry availability' },
  FLAKY_TEST:       { transient: true,  hint: 'Re-run the test suite; consider adding retry decorators' },
  LOCK_CONTENTION:  { transient: true,  hint: 'Another process holds a lock; wait and retry' },
  TIMEOUT:          { transient: true,  hint: 'Stage timed out; retry with extended timeout' },

  // Permanent — requires code change, escalate after 1 attempt
  LINT_ERROR:       { transient: false, hint: 'Fix lint violations before re-running' },
  TYPE_ERROR:       { transient: false, hint: 'Fix type errors; check type annotations' },
  TEST_FAILURE:     { transient: false, hint: 'Fix failing assertions; check business logic' },
  BUILD_ERROR:      { transient: false, hint: 'Fix compilation errors; check syntax and imports' },
  DEPENDENCY_ERROR: { transient: false, hint: 'Install missing dependencies or fix version conflicts' },

  // Unknown — retry once, then escalate
  UNKNOWN:          { transient: true,  hint: 'Unknown failure; retry once then escalate' },
};

const DEFAULT_MAX_RETRIES = 3;
const TRANSIENT_MAX_RETRIES = 3;
const PERMANENT_MAX_RETRIES = 1; // attempt once more after a code-fix cycle

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
  if (/eslint|lint error|no-unused|no-undef/.test(combined))     return 'LINT_ERROR';
  if (/typeerror|ts\(|type error|type mismatch/.test(combined))  return 'TYPE_ERROR';
  if (/syntaxerror|unexpected token|cannot find module/.test(combined)) return 'BUILD_ERROR';
  if (/cannot resolve|missing peer|not found: \w+@/.test(combined))    return 'DEPENDENCY_ERROR';
  if (/\bassert\b|\.to\.equal|\.toequal|test failed|assertion/.test(combined)) return 'TEST_FAILURE';

  return 'UNKNOWN';
}

/**
 * SelfHealingCI
 *
 * Wraps an async stage function and retries it according to the
 * failure class, up to maxRetries.  Returns a structured result
 * so the caller can log, escalate, or apply a code fix.
 */
class SelfHealingCI {
  constructor(options = {}) {
    this.maxRetries       = options.maxRetries       ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs      = options.baseDelayMs      ?? 500;   // initial back-off
    this.maxDelayMs       = options.maxDelayMs       ?? 8000;  // ceiling
    this.onRetry          = options.onRetry          || null;  // (attempt, classification, hint) => void
    this.onEscalate       = options.onEscalate       || null;  // (stageName, finalResult) => void
    this._attempts        = {};                                // stageName → attempt count
  }

  /**
   * Run a stage with self-healing retries.
   *
   * @param {string}   stageName  - human label (e.g. 'lint', 'test')
   * @param {Function} stageFn    - async () => { success, error?, output? }
   * @returns {Object}            - { success, attempts, classification, hint, history }
   */
  async runStage(stageName, stageFn) {
    this._attempts[stageName] = 0;
    const history = [];

    while (true) {
      this._attempts[stageName]++;
      const attempt = this._attempts[stageName];

      let result;
      try {
        result = await stageFn();
      } catch (err) {
        result = { success: false, error: err.message, output: '' };
      }

      const passed = result && result.success === true;

      history.push({
        attempt,
        success: passed,
        error:   result?.error  || null,
        output:  result?.output || null,
        ts:      new Date().toISOString(),
      });

      if (passed) {
        console.log(`[SelfHealingCI] ✓ Stage "${stageName}" passed on attempt ${attempt}`);
        return { success: true, attempts: attempt, history };
      }

      // Classify the failure
      const classification = classifyFailure(result?.error || '', result?.output || '');
      const meta = FAILURE_CLASSES[classification];
      const maxForClass = meta.transient ? TRANSIENT_MAX_RETRIES : PERMANENT_MAX_RETRIES;
      const effective   = Math.min(this.maxRetries, maxForClass);

      console.log(`[SelfHealingCI] ✗ Stage "${stageName}" attempt ${attempt}/${effective} — class: ${classification} — ${meta.hint}`);

      if (this.onRetry) {
        try { this.onRetry(attempt, classification, meta.hint, stageName); } catch (_) {}
      }

      if (attempt >= effective) {
        console.log(`[SelfHealingCI] ⚠ Stage "${stageName}" exhausted retries — escalating`);
        const finalResult = {
          success:        false,
          attempts:       attempt,
          classification,
          hint:           meta.hint,
          transient:      meta.transient,
          lastError:      result?.error || 'unknown',
          history,
        };

        if (this.onEscalate) {
          try { this.onEscalate(stageName, finalResult); } catch (_) {}
        }

        return finalResult;
      }

      // Exponential back-off before retry
      const delay = Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), this.maxDelayMs);
      console.log(`[SelfHealingCI] ↻ Retrying "${stageName}" in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  /**
   * Run multiple stages in sequence.
   * Stops on first unrecoverable failure.
   *
   * @param {Array} stages - [{ name, fn }]
   * @returns {Object} - { passed, failed, results }
   */
  async runPipeline(stages) {
    const results = {};
    let allPassed = true;

    for (const { name, fn } of stages) {
      const result = await this.runStage(name, fn);
      results[name] = result;

      if (!result.success) {
        allPassed = false;
        console.log(`[SelfHealingCI] Pipeline halted after "${name}" failure`);
        break;
      }
    }

    return { passed: allPassed, results };
  }

  /**
   * Reset attempt counters (use between independent task runs)
   */
  reset() {
    this._attempts = {};
  }

  /**
   * Return a summary of all stage attempts
   */
  summary() {
    return { ...this._attempts };
  }
}

module.exports = { SelfHealingCI, classifyFailure, FAILURE_CLASSES };
