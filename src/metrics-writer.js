/**
 * MetricsWriter — Phase 1 Step 5
 *
 * Writes ops/metrics.json after each factory run.
 * Records: task id, title, repo, duration, pass/fail, attempts, timestamp.
 * Appends to an array (last 500 entries kept; older entries rotated out).
 *
 * Also posts a summary line to Slack #redos-eng when SLACK_WEBHOOK_URL
 * or the OpenClaw message plugin is available.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_METRICS_PATH = path.join(__dirname, '..', 'ops', 'metrics.json');
const MAX_ENTRIES = 500;

class MetricsWriter {
  constructor(options = {}) {
    this.metricsPath = options.metricsPath || DEFAULT_METRICS_PATH;
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.metricsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.metricsPath)) {
      fs.writeFileSync(this.metricsPath, JSON.stringify([], null, 2), 'utf8');
    }
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.metricsPath, 'utf8'));
    } catch {
      return [];
    }
  }

  _save(entries) {
    // Keep only the last MAX_ENTRIES
    const trimmed = entries.slice(-MAX_ENTRIES);
    fs.writeFileSync(this.metricsPath, JSON.stringify(trimmed, null, 2), 'utf8');
  }

  /**
   * Record a completed factory run.
   *
   * @param {Object} params
   *   task        — task record (id, title, repo, branch)
   *   startTime   — Date or ISO string when task started
   *   endTime     — Date or ISO string when task ended (default: now)
   *   passed      — boolean
   *   attempts    — number of execution attempts (default: 1)
   *   stages      — optional { [stageName]: { success, attempts } }
   *   error       — optional error message on failure
   *   prUrl       — optional PR URL if created
   */
  record({ task, startTime, endTime, passed, attempts = 1, stages = {}, error = null, prUrl = null }) {
    const start = startTime ? new Date(startTime) : new Date();
    const end   = endTime   ? new Date(endTime)   : new Date();
    const durationMs = end - start;

    const entry = {
      id:         task.id,
      title:      task.title || '(untitled)',
      repo:       task.repo  || 'unknown',
      branch:     task.branch || 'main',
      passed,
      attempts,
      durationMs,
      durationSec: +(durationMs / 1000).toFixed(2),
      stages,
      error,
      prUrl,
      timestamp: end.toISOString(),
    };

    const all = this._load();
    all.push(entry);
    this._save(all);

    console.log(
      `[MetricsWriter] Recorded — task: ${entry.id} | ${passed ? '✓ PASS' : '✗ FAIL'} | ${entry.durationSec}s | attempts: ${attempts}`
    );

    return entry;
  }

  /**
   * Return a summary of recent runs.
   * @param {number} n — number of most-recent entries (default: 20)
   */
  recent(n = 20) {
    const all = this._load();
    return all.slice(-n);
  }

  /**
   * Aggregate stats across all recorded runs.
   */
  stats() {
    const all = this._load();
    if (all.length === 0) return { total: 0 };

    const passed   = all.filter(e => e.passed).length;
    const failed   = all.length - passed;
    const avgMs    = all.reduce((s, e) => s + (e.durationMs || 0), 0) / all.length;
    const avgAttempts = all.reduce((s, e) => s + (e.attempts || 1), 0) / all.length;

    return {
      total:       all.length,
      passed,
      failed,
      passRate:    +((passed / all.length) * 100).toFixed(1),
      avgDurationSec: +(avgMs / 1000).toFixed(2),
      avgAttempts: +avgAttempts.toFixed(2),
      since:       all[0]?.timestamp || null,
      latest:      all[all.length - 1]?.timestamp || null,
    };
  }

  /**
   * Format a Slack-ready summary string for the last N runs.
   */
  slackSummary(n = 5) {
    const entries = this.recent(n);
    if (entries.length === 0) return '_(no metrics recorded yet)_';

    const stats = this.stats();
    const lines = entries.map(e => {
      const icon   = e.passed ? '✅' : '❌';
      const dur    = `${e.durationSec}s`;
      const att    = e.attempts > 1 ? ` (${e.attempts} attempts)` : '';
      const pr     = e.prUrl ? ` → <${e.prUrl}|PR>` : '';
      return `${icon} \`${e.id.slice(0, 8)}\` *${e.title}* — ${dur}${att}${pr}`;
    });

    return [
      `*Factory Metrics* (last ${entries.length} runs) | Pass rate: ${stats.passRate}% | Avg: ${stats.avgDurationSec}s`,
      ...lines,
    ].join('\n');
  }
}

export default MetricsWriter;
export { MetricsWriter };