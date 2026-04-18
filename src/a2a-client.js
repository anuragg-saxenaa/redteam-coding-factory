/**
 * A2A Client
 * Adds timeout-aware retry with fallback dispatch for sessions_send calls.
 */

function wait(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class A2AClient {
  constructor(options = {}) {
    this.transport = options.transport || null;
    this.defaultTimeoutSeconds = options.defaultTimeoutSeconds || 45;
    this.maxAttempts = options.maxAttempts || 3;
    this.baseBackoffMs = options.baseBackoffMs || 200;
    this.maxBackoffMs = options.maxBackoffMs || 2000;
    this.jitterMs = options.jitterMs || 25;
    this.enableFallback = options.enableFallback ?? true;
    this.fallbackMethod = options.fallbackMethod || 'sessions_spawn';

    this.stats = {
      requests: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      retries: 0,
      fallbackUsed: 0,
    };
  }

  async send({ sessionKey, agentId, message, timeoutSeconds } = {}) {
    if (!message || typeof message !== 'string') {
      throw new Error('A2AClient.send requires a non-empty message');
    }
    if (!sessionKey && !agentId) {
      throw new Error('A2AClient.send requires either sessionKey or agentId');
    }
    if (!this.transport || typeof this.transport !== 'function') {
      throw new Error('A2A transport is not configured');
    }

    this.stats.requests += 1;

    const timeout = timeoutSeconds || this.defaultTimeoutSeconds;
    const payload = { sessionKey, agentId, message, timeoutSeconds: timeout };
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.transport({
          method: 'sessions_send',
          payload,
          timeoutSeconds: timeout,
        });

        this.stats.successes += 1;
        return {
          ok: true,
          method: 'sessions_send',
          attempts: attempt,
          usedFallback: false,
          response,
        };
      } catch (error) {
        lastError = error;
        const timedOut = this._isTimeoutError(error);

        if (timedOut) {
          this.stats.timeouts += 1;
        }

        const canRetry = timedOut && attempt < this.maxAttempts;
        if (!canRetry) {
          break;
        }

        this.stats.retries += 1;
        const delayMs = this._computeBackoffDelay(attempt);
        await wait(delayMs);
      }
    }

    if (this.enableFallback) {
      try {
        const fallbackResponse = await this.transport({
          method: this.fallbackMethod,
          payload,
          timeoutSeconds: timeout,
        });

        this.stats.successes += 1;
        this.stats.fallbackUsed += 1;
        return {
          ok: true,
          method: this.fallbackMethod,
          attempts: this.maxAttempts,
          usedFallback: true,
          response: fallbackResponse,
          primaryError: this._toErrorSummary(lastError),
        };
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }

    this.stats.failures += 1;

    const error = new Error(
      `A2A dispatch failed after ${this.maxAttempts} attempt(s)`
    );
    error.code = 'A2A_SEND_FAILED';
    error.details = {
      timeoutSeconds: timeout,
      sessionKey: sessionKey || null,
      agentId: agentId || null,
      fallbackMethod: this.enableFallback ? this.fallbackMethod : null,
      lastError: this._toErrorSummary(lastError),
    };

    throw error;
  }

  _isTimeoutError(error) {
    const message = `${error?.message || ''}`.toLowerCase();
    const code = `${error?.code || ''}`.toUpperCase();
    return (
      code === 'ETIMEDOUT' ||
      code === 'TIMEOUT' ||
      message.includes('timed out') ||
      message.includes('timeout')
    );
  }

  _computeBackoffDelay(attempt) {
    const expDelay = this.baseBackoffMs * Math.pow(2, Math.max(0, attempt - 1));
    const capped = Math.min(expDelay, this.maxBackoffMs);
    if (!this.jitterMs) return capped;
    const jitter = Math.floor(Math.random() * (this.jitterMs + 1));
    return capped + jitter;
  }

  _toErrorSummary(error) {
    if (!error) return null;
    return {
      message: error.message || String(error),
      code: error.code || null,
    };
  }

  getStats() {
    return { ...this.stats };
  }
}

// ESM default export — enables: import Factory from './a2a-client.js'
export default A2AClient;
export { A2AClient };