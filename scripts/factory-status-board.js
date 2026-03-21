#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    worktreeBase: null,
    metricsPath: null,
    limit: 10,
    format: 'markdown',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--repo') args.repo = argv[++i];
    else if (token === '--worktree-base') args.worktreeBase = argv[++i];
    else if (token === '--metrics') args.metricsPath = argv[++i];
    else if (token === '--limit') args.limit = Number(argv[++i]);
    else if (token === '--format') args.format = argv[++i];
    else if (token === '-h' || token === '--help') {
      process.stdout.write([
        'Usage: node scripts/factory-status-board.js [options]',
        '',
        'Options:',
        '  --repo <path>            Base repo path (default: cwd)',
        '  --worktree-base <path>   Status file root (default: <repo>/.worktrees)',
        '  --metrics <path>         Metrics file path (default: <repo>/ops/metrics.json)',
        '  --limit <n>              Number of recent runs to show (default: 10)',
        '  --format <mode>          markdown|json (default: markdown)',
        '  -h, --help               Show help',
        '',
      ].join('\n'));
      process.exit(0);
    }
  }

  if (!args.worktreeBase) args.worktreeBase = path.join(args.repo, '.worktrees');
  if (!args.metricsPath) args.metricsPath = path.join(args.repo, 'ops', 'metrics.json');

  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    throw new Error('Invalid --limit value (must be a positive integer)');
  }

  if (!['markdown', 'json'].includes(args.format)) {
    throw new Error('Invalid --format value (expected markdown|json)');
  }

  return args;
}

function parseStatusFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = {};

  raw.split('\n').forEach((line) => {
    if (!line.includes('=')) return;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) data[key] = value;
  });

  return data;
}

function loadStatuses(worktreeBase) {
  if (!fs.existsSync(worktreeBase)) return [];

  const files = fs.readdirSync(worktreeBase)
    .filter((name) => name.endsWith('.status'))
    .map((name) => path.join(worktreeBase, name));

  return files
    .map((filePath) => {
      const status = parseStatusFile(filePath);
      status.__file = filePath;
      return status;
    })
    .sort((a, b) => {
      const ta = Date.parse(a.created_at || '') || 0;
      const tb = Date.parse(b.created_at || '') || 0;
      return tb - ta;
    });
}

function loadMetrics(metricsPath) {
  if (!fs.existsSync(metricsPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summarize(statuses, metrics, limit) {
  const totals = {
    runs: statuses.length,
    success: statuses.filter((s) => s.result === 'success').length,
    failed: statuses.filter((s) => s.result === 'failed').length,
    escalated: statuses.filter((s) => s.escalation_required === 'true').length,
  };

  const recent = statuses.slice(0, limit).map((s) => ({
    runId: s.run_id || '',
    createdAt: s.created_at || '',
    task: s.task || '',
    result: s.result || 'unknown',
    attempts: Number(s.attempts || '0'),
    escalationRequired: s.escalation_required === 'true',
    escalationReason: s.escalation_reason || '',
    prStatus: s.pr_status || '',
    prUrl: s.pr_url || '',
    slackPostStatus: s.slack_post_status || '',
  }));

  const metricsSummary = {
    records: metrics.length,
    success: metrics.filter((m) => m.result === 'success').length,
    failed: metrics.filter((m) => m.result === 'failed').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    totals,
    metrics: metricsSummary,
    recent,
  };
}

function toMarkdown(summary) {
  const lines = [];
  lines.push(`# Factory Status Board (${summary.generatedAt})`);
  lines.push('');
  lines.push(`- Runs tracked: ${summary.totals.runs}`);
  lines.push(`- Success: ${summary.totals.success}`);
  lines.push(`- Failed: ${summary.totals.failed}`);
  lines.push(`- Escalated: ${summary.totals.escalated}`);
  lines.push(`- Metrics records: ${summary.metrics.records}`);
  lines.push('');

  if (summary.recent.length === 0) {
    lines.push('_No recent run statuses found._');
    return lines.join('\n');
  }

  lines.push('## Recent Runs');
  summary.recent.forEach((run) => {
    lines.push(`- ${run.createdAt || '<unknown time>'} | ${run.result.toUpperCase()} | ${run.runId || '<no-run-id>'}`);
    lines.push(`  - Task: ${run.task || '<none>'}`);
    lines.push(`  - Attempts: ${run.attempts}`);
    lines.push(`  - Escalation: ${run.escalationRequired ? run.escalationReason || 'true' : 'none'}`);
    lines.push(`  - PR: ${run.prStatus || 'n/a'}${run.prUrl ? ` (${run.prUrl})` : ''}`);
    lines.push(`  - Slack: ${run.slackPostStatus || 'n/a'}`);
  });

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const statuses = loadStatuses(args.worktreeBase);
  const metrics = loadMetrics(args.metricsPath);
  const summary = summarize(statuses, metrics, args.limit);

  if (args.format === 'json') {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${toMarkdown(summary)}\n`);
}

if (require.main === module) {
  main();
}
