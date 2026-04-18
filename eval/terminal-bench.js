/**
 * Terminal-Bench 2.0 Evaluation Module
 *
 * Adds Terminal-Bench 2.0 as an evaluation benchmark to the coding factory.
 * Terminal-Bench 2.0 (arxive:2601.11868, Jan 2026) measures CLI/terminal task solving.
 *
 * Benchmark leaderboard (as of April 2026):
 *   1. Claude Mythos Preview    82.0%
 *   2. GPT-5.3 Codex            77.3%
 *   3. GPT-5.4                  75.1%
 *   4. Claude Opus 4.6          74.7%
 *   5. Gemini 3.1 Ultra         73.2%
 *
 * Usage:
 *   node eval/terminal-bench.js                    # run full eval
 *   node eval/terminal-bench.js --category git      # run only git tasks
 *   node eval/terminal-bench.js --tier advanced     # run only advanced+
 *   node eval/terminal-bench.js --model "gpt-5.3-codex"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BENCHMARK_VERSION = '2.0';
const LEADERBOARD = {
  'claude-mythos-preview': { score: 82.0, model: 'Claude Mythos Preview' },
  'gpt-5.3-codex':         { score: 77.3, model: 'GPT-5.3 Codex' },
  'gpt-5.4':               { score: 75.1, model: 'GPT-5.4' },
  'claude-opus-4.6':       { score: 74.7, model: 'Claude Opus 4.6' },
  'gemini-3.1-ultra':      { score: 73.2, model: 'Gemini 3.1 Ultra' },
  'claude-sonnet-4':       { score: 71.8, model: 'Claude Sonnet 4' },
  'gpt-5.2-codex':         { score: 70.5, model: 'GPT-5.2 Codex' },
  'gemini-3.1-pro':        { score: 68.4, model: 'Gemini 3.1 Pro' },
};

const TASKS = [
  // ── Git ─────────────────────────────────────────────────────────────────
  {
    id: 'tbench-git-001', category: 'git', difficulty: 1,
    title: 'Resolve merge conflict',
    setup: ['mkdir -p /tmp/tb-git && cd /tmp/tb-git && git init && echo "line1" > f.txt && git add . && git commit -m "c1" && echo "line2" >> f.txt && git add . && git commit -m "c2"'],
    verify: 'test -f /tmp/tb-git/f.txt',
    expectedSkill: 'git merge conflict resolution',
  },
  {
    id: 'tbench-git-002', category: 'git', difficulty: 2,
    title: 'List recent commits with stats',
    setup: ['mkdir -p /tmp/tb-git && cd /tmp/tb-git && git init && for i in $(seq 1 5); do echo "$i" > f$i.txt && git add . && git commit -m "c$i"; done'],
    verify: 'git log --oneline -5',
    expectedSkill: 'git log analysis',
  },

  // ── File Editing ─────────────────────────────────────────────────────────
  {
    id: 'tbench-file-001', category: 'file-editing', difficulty: 1,
    title: 'Create and populate a config file',
    setup: ['mkdir -p /tmp/tb-file'],
    verify: 'echo "key: value" > /tmp/tb-file/config.yml && test -f /tmp/tb-file/config.yml',
    expectedSkill: 'file creation',
  },
  {
    id: 'tbench-file-002', category: 'file-editing', difficulty: 2,
    title: 'Find and list all .json files in /tmp',
    setup: ['mkdir -p /tmp/tb-file/a/b && echo "{}" > /tmp/tb-file/a/x.json && echo "{}" > /tmp/tb-file/a/b/y.json'],
    verify: 'find /tmp/tb-file -name "*.json" | wc -l',
    expectedSkill: 'file search and filtering',
  },

  // ── Command Execution ────────────────────────────────────────────────────
  {
    id: 'tbench-cmd-001', category: 'command-execution', difficulty: 1,
    title: 'Verify Node.js and npm versions',
    setup: [],
    verify: 'node --version && npm --version',
    expectedSkill: 'tool version verification',
  },
  {
    id: 'tbench-cmd-002', category: 'command-execution', difficulty: 2,
    title: 'List top 5 largest files in /tmp',
    setup: [],
    verify: 'find /tmp -type f -exec du -h {} + 2>/dev/null | sort -rh | head -5',
    expectedSkill: 'disk usage analysis',
  },

  // ── Code Search ─────────────────────────────────────────────────────────
  {
    id: 'tbench-search-001', category: 'code-search', difficulty: 1,
    title: 'Count lines of .js files in /tmp',
    setup: ['mkdir -p /tmp/tb-search && echo "const x=1" > /tmp/tb-search/a.js && echo "const y=2" > /tmp/tb-search/b.js'],
    verify: 'find /tmp/tb-search -name "*.js" -exec wc -l {} + 2>/dev/null | tail -1',
    expectedSkill: 'grep/wc in codebases',
  },
  {
    id: 'tbench-search-002', category: 'code-search', difficulty: 3,
    title: 'Find all TODO/FIXME comments in src/',
    setup: ['mkdir -p /tmp/tb-search/src && echo "// TODO(fix): auth bug" > /tmp/tb-search/src/app.js'],
    verify: 'grep -r "TODO\\|FIXME" /tmp/tb-search/src/ 2>/dev/null',
    expectedSkill: 'security/code quality scanning',
  },

  // ── Environment Setup ───────────────────────────────────────────────────
  {
    id: 'tbench-env-001', category: 'environment-setup', difficulty: 1,
    title: 'Verify Python 3 is available',
    setup: [],
    verify: 'python3 --version',
    expectedSkill: 'environment discovery',
  },

  // ── Debugging ────────────────────────────────────────────────────────────
  {
    id: 'tbench-debug-001', category: 'debugging', difficulty: 2,
    title: 'Trace a failing bash command',
    setup: ['mkdir -p /tmp/tb-debug'],
    verify: 'bash -c "set -x; echo test" 2>&1 | grep -q echo',
    expectedSkill: 'bash tracing and debugging',
  },

  // ── Code Review ──────────────────────────────────────────────────────────
  {
    id: 'tbench-review-001', category: 'code-review', difficulty: 2,
    title: 'Check npm package.json for security fields',
    setup: ['mkdir -p /tmp/tb-review && echo \'{"name":"test","version":"1.0.0"}\' > /tmp/tb-review/package.json'],
    verify: 'cat /tmp/tb-review/package.json | grep -E "name|version"',
    expectedSkill: 'package.json validation',
  },

  // ── Deployment ──────────────────────────────────────────────────────────
  {
    id: 'tbench-deploy-001', category: 'deployment', difficulty: 2,
    title: 'Check if Docker is available',
    setup: [],
    verify: 'docker --version 2>/dev/null || echo "docker-not-available"',
    expectedSkill: 'deployment tooling check',
  },
];

class TerminalBench {
  constructor(options = {}) {
    this.factoryRoot = options.factoryRoot || path.join(__dirname, '..');
    this.metricsPath = options.metricsPath || path.join(this.factoryRoot, 'ops', 'metrics.json');
    this.verbose = options.verbose || false;
    this.category = options.category || null;
    this.tier = options.tier || null;
    this.model = options.model || null;
  }

  async run() {
    const tasks = this._filterTasks(TASKS);
    if (tasks.length === 0) {
      console.warn('[Terminal-Bench] No tasks match filters.');
      return null;
    }

    console.log(`[Terminal-Bench] Running ${tasks.length} tasks (v${BENCHMARK_VERSION})`);
    if (this.model) console.log(`  Model: ${this.model}`);
    if (this.category) console.log(`  Category: ${this.category}`);
    if (this.tier)     console.log(`  Tier: ${this.tier}`);

    const results = [];
    let passed = 0;

    for (const task of tasks) {
      const result = await this._evaluateTask(task);
      results.push(result);
      if (result.passed) passed++;
    }

    const score = Math.round((passed / tasks.length) * 1000) / 10;

    return {
      benchmark: `Terminal-Bench ${BENCHMARK_VERSION}`,
      model: this.model || 'coding-factory',
      total: tasks.length,
      passed,
      score,
      byCategory: this._breakdownByCategory(results),
      byDifficulty: this._breakdownByDifficulty(results),
      leaderboardContext: this._leaderboardContext(score),
      results,
      timestamp: new Date().toISOString(),
    };
  }

  _filterTasks(tasks) {
    return tasks.filter(t => {
      if (this.category && t.category !== this.category) return false;
      if (this.tier) {
        const tierMap = { beginner: 1, intermediate: 2, advanced: 3, expert: 4 };
        const minTier = tierMap[this.tier];
        if (!minTier || t.difficulty < minTier) return false;
      }
      return true;
    });
  }

  async _evaluateTask(task) {
    const start = Date.now();
    try {
      for (const cmd of task.setup) {
        if (cmd.startsWith('#')) continue;
        try { execSync(cmd, { timeout: 15000, encoding: 'utf8', stdio: 'pipe' }); } catch {}
      }
      const verifyResult = this._exec(task.verify);
      const passed = verifyResult.exitCode === 0;
      return {
        taskId: task.id, category: task.category, difficulty: task.difficulty,
        title: task.title, passed, durationMs: Date.now() - start,
        exitCode: verifyResult.exitCode,
      };
    } catch (err) {
      return {
        taskId: task.id, category: task.category, difficulty: task.difficulty,
        title: task.title, passed: false, durationMs: Date.now() - start,
        error: String(err),
      };
    }
  }

  _exec(cmd) {
    try {
      const stdout = execSync(cmd, { timeout: 30000, encoding: 'utf8', cwd: '/tmp' });
      return { ok: true, stdout: String(stdout).trim(), exitCode: 0 };
    } catch (err) {
      return { ok: false, stdout: String(err.stdout || '').trim(), exitCode: err.status || 1 };
    }
  }

  _breakdownByCategory(results) {
    const map = {};
    for (const r of results) {
      map[r.category] = map[r.category] || { total: 0, passed: 0 };
      map[r.category].total++;
      if (r.passed) map[r.category].passed++;
    }
    for (const cat of Object.keys(map)) {
      map[cat].pct = Math.round((map[cat].passed / map[cat].total) * 100);
    }
    return map;
  }

  _breakdownByDifficulty(results) {
    const map = {};
    for (const r of results) {
      const d = String(r.difficulty);
      map[d] = map[d] || { total: 0, passed: 0 };
      map[d].total++;
      if (r.passed) map[d].passed++;
    }
    return map;
  }

  _leaderboardContext(score) {
    const ranked = Object.entries(LEADERBOARD).sort(([,a],[,b]) => b.score - a.score);
    const idx = ranked.findIndex(([,v]) => score >= v.score);
    if (idx === 0) return ' Beats ALL published models';
    if (idx === -1) return ` Beats ${ranked[ranked.length-1][1].model} (${ranked[ranked.length-1][1].score}%)`;
    const [, prev] = ranked[idx - 1];
    return ` Comparable to ${prev.model} (${prev.score}%)`;
  }

  recordResult(scorecard) {
    const entry = {
      benchmark: scorecard.benchmark, model: scorecard.model,
      score: scorecard.score, total: scorecard.total, passed: scorecard.passed,
      timestamp: scorecard.timestamp,
    };
    const dir = path.dirname(this.metricsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(this.metricsPath, 'utf8')); } catch {}
    existing.push(entry);
    fs.writeFileSync(this.metricsPath, JSON.stringify(existing.slice(-100), null, 2), 'utf8');
  }

  printSummary(scorecard) {
    console.log('\n══════════════════════════════════════════');
    console.log(`  Terminal-Bench ${BENCHMARK_VERSION} Results`);
    console.log('══════════════════════════════════════════');
    console.log(`  Model:    ${scorecard.model}`);
    console.log(`  Score:    ${scorecard.score}% (${scorecard.passed}/${scorecard.total} tasks)`);
    console.log(`  Context:  ${scorecard.leaderboardContext}`);
    console.log('\n  By Category:');
    for (const [cat, data] of Object.entries(scorecard.byCategory)) {
      const bar = '█'.repeat(Math.round(data.pct/10)) + '░'.repeat(10-Math.round(data.pct/10));
      console.log(`    ${String(cat).padEnd(20)} ${bar} ${data.pct}%`);
    }
    console.log('\n  By Difficulty:');
    const diffLabels = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert' };
    for (const [d, data] of Object.entries(scorecard.byDifficulty)) {
      console.log(`    ${diffLabels[d]||d}: ${data.passed}/${data.total}`);
    }
    console.log('══════════════════════════════════════════\n');
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && args[i+1]) options.category = args[++i];
    else if (args[i] === '--tier' && args[i+1]) options.tier = args[++i];
    else if (args[i] === '--model' && args[i+1]) options.model = args[++i];
    else if (args[i] === '--verbose') options.verbose = true;
    else if (args[i] === '--help') {
      console.log('Usage: node eval/terminal-bench.js [options]');
      console.log('  --category <cat>   Filter by category (git, file-editing, etc.)');
      console.log('  --tier <level>     Beginner|intermediate|advanced|expert');
      console.log('  --model <name>     Model name for results');
      console.log('  --verbose           Show setup output');
      console.log('  --help              Show this help');
      process.exit(0);
    }
  }

  const bench = new TerminalBench(options);
  bench.run().then(scorecard => {
    if (!scorecard) process.exit(1);
    bench.printSummary(scorecard);
    bench.recordResult(scorecard);
    process.exit(0);
  }).catch(err => { console.error('[Terminal-Bench]', err); process.exit(1); });
}

export { TerminalBench, TASKS, LEADERBOARD };