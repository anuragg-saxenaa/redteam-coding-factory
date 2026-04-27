#!/usr/bin/env node
/**
 * RedTeam Coding Factory CLI
 *
 * Goal: a thin, dependency-free wrapper around RedTeamFactory for production-ish use.
 *
 * Usage:
 *   redteam-factory --help
 *   redteam-factory run --config ./factory.config.json [--tasks ./tasks.json]
 *
 * Config shape (factory.config.json):
 * {
 *   "dataDir": "/abs/path/.factory-data",
 *   "repos": [ { "name": "repo1", "path": "/abs/path/repo1", "branch": "main" } ],
 *   "enableDashboard": true
 * }
 *
 * Tasks shape (tasks.json):
 * [
 *   { "repo": "repo1", "title": "Do X", "description": "...", "force": false },
 *   { "crossRepo": true, "title": "...", "description": "...", "dependencies": [] }
 * ]
 */

import fs from 'node:fs';
import path from 'node:path';
import RedTeamFactory from './redteam-factory.js';
import IssueWatcher from './issue-watcher.js';

function usage(exitCode = 0) {
  const msg = [
    'RedTeam Coding Factory CLI',
    '',
    'Usage:',
    '  redteam-factory run   --config <factory.config.json> [--tasks <tasks.json>]',
    '  redteam-factory watch --config <factory.config.json>',
    '  redteam-factory tasks --config <factory.config.json> --tasks <tasks.json>',
    '',
    'Commands:',
    '  run     Run factory with explicit task list, then exit',
    '  watch   Poll GitHub for "factory-ready" issues and process them continuously',
    '  tasks   Validate and preview normalized tasks JSON, then exit',
    '',
    'Options:',
    '  --config     Path to factory config JSON (required)',
    '  --tasks      Path to tasks JSON (run mode only; optional)',
    '  --once       In watch mode: poll once and exit instead of running as daemon',
    '  --interval   Poll interval in seconds (watch mode; default: 60)',
    '  --agent      Coding agent preset: codex|claude (watch mode; default: codex)',
    '  --push       Enable git push (watch mode; default: false)',
    '  --pr         Enable PR creation (watch mode; default: false)',
    '  --auto-close Auto-close issues on success (watch mode; default: false)',
    '  --remediate  Enable guarded auto-remediation (watch mode; default: false)',
    '  --retry-budget Max retry budget across stages (watch mode; default: 6)',
    '  --max-tasks   Stop daemon after N processed issues (watch mode)',
    '  --max-polls   Stop daemon after N poll cycles (watch mode)',
    '  --dashboard   Enable dashboard (default: true)',
    '  --help       Show this help',
    '',
  ].join('\n');
  process.stdout.write(msg);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--tasks') args.tasks = argv[++i];
    else if (a === '--once') args.once = true;
    else if (a === '--interval') args.interval = parseInt(argv[++i], 10);
    else if (a === '--agent') args.agent = argv[++i];
    else if (a === '--push') args.push = true;
    else if (a === '--pr') args.pr = true;
    else if (a === '--auto-close') args.autoClose = true;
    else if (a === '--remediate') args.remediate = true;
    else if (a === '--retry-budget') args.retryBudget = parseInt(argv[++i], 10);
    else if (a === '--max-tasks') args.maxTasks = parseInt(argv[++i], 10);
    else if (a === '--max-polls') args.maxPolls = parseInt(argv[++i], 10);
    else if (a === '--dashboard') args.dashboard = argv[++i] === 'true';
    else args._.push(a);
  }
  return args;
}


function readJson(p) {
  const abs = path.resolve(process.cwd(), p);
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

function normalizeTasks(tasksDoc, config) {
  if (Array.isArray(tasksDoc)) return tasksDoc;

  // Backward compatibility: legacy tasks.json keyed by stage name.
  if (tasksDoc && typeof tasksDoc === 'object') {
    const defaultRepo = config.repos && config.repos[0];
    if (!defaultRepo || !defaultRepo.name) {
      throw new Error('legacy tasks.json requires config.repos[0].name to infer target repo');
    }

    return Object.entries(tasksDoc).map(([name, spec]) => {
      const description = spec && typeof spec.description === 'string'
        ? spec.description
        : `Run ${name} stage`;
      const commands = Array.isArray(spec && spec.commands) ? spec.commands : [];
      const commandLines = commands.length > 0
        ? `\n\nCommands:\n${commands.map((c) => `- ${c}`).join('\n')}`
        : '';

      return {
        repo: defaultRepo.name,
        title: `Run ${name}`,
        description: `${description}${commandLines}`,
      };
    });
  }

  throw new Error('tasks.json must be either an array of tasks or a legacy object keyed by stage name');
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || args._.length === 0) usage(args.help ? 0 : 1);

  const cmd = args._[0];
  if (cmd !== 'run' && cmd !== 'watch' && cmd !== 'tasks') {
    process.stderr.write(`Unknown command: ${cmd}\n\n`);
    usage(1);
  }

  if (!args.config) {
    process.stderr.write('Missing required --config\n\n');
    usage(1);
  }

  const config = readJson(args.config);
  
  // Add dashboard config if not specified
  if (typeof config.enableDashboard === 'undefined') {
    config.enableDashboard = true;
  }

  if (cmd === 'tasks') {
    if (!args.tasks) {
      process.stderr.write('Missing required --tasks for tasks command\n\n');
      usage(1);
    }

    const tasks = normalizeTasks(readJson(args.tasks), config);
    process.stdout.write(`\nNormalized ${tasks.length} task(s):\n${JSON.stringify(tasks, null, 2)}\n`);
    return;
  }

  if (cmd === 'watch') {
    // Watch mode: poll GitHub issues and run through factory
    if (!config.github || !config.github.repo) {
      process.stderr.write('Watch mode requires config.github.repo (e.g. "owner/repo")\n');
      process.exit(1);
    }

    // Determine repoPath — first repo in config or explicit github.repoPath
    const repoPath = config.github.repoPath
      || (config.repos && config.repos[0] && config.repos[0].path)
      || process.cwd();

    const watcher = new IssueWatcher({
      repo: config.github.repo,
      repoPath,
      branch: config.github.branch || 'main',
      label: config.github.label || 'factory-ready',
      pollIntervalMs: (args.interval || config.github.pollIntervalSec || 60) * 1000,
      maxConcurrent: config.github.maxConcurrent || 1,
      agent: args.agent || config.github.agent || 'codex',
      agentTimeoutMs: (config.github.agentTimeoutSec || 300) * 1000,
      enablePush: args.push || config.enablePush || false,
      createPR: args.pr || config.createPR || false,
      autoClose: args.autoClose || config.github.autoClose || false,
      dataDir: config.dataDir,
      maxRetries: config.maxRetries || 3,
      enableAutoRemediation: args.remediate || config.enableAutoRemediation || false,
      maxRetryBudget: args.retryBudget || config.maxRetryBudget || 6,
      maxTasksPerRun: args.maxTasks || config.github.maxTasksPerRun,
      maxPolls: args.maxPolls || config.github.maxPolls,
      onPoll: (count) => {
        if (count > 0) console.log(`[CLI] Found ${count} issues`);
      },
      onTaskComplete: (issueNumber, result) => {
        console.log(`[CLI] ✓ Issue #${issueNumber} completed`);
      },
      onTaskFail: (issueNumber, error) => {
        console.error(`[CLI] ✗ Issue #${issueNumber} failed: ${error}`);
      },
    });

    if (args.once) {
      // One-shot mode: poll once and exit
      console.log('[CLI] Watch mode (one-shot)...');
      const results = await watcher.pollOnce();
      const stats = watcher.stats();
      console.log(`\nPoll complete. ${stats.completed} completed, ${stats.failed} failed.`);
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    } else {
      // Daemon mode: poll continuously
      console.log('[CLI] Watch mode (daemon)...');
      console.log('[CLI] Press Ctrl+C to stop');

      // Graceful shutdown
      const shutdown = () => {
        console.log('\n[CLI] Shutting down...');
        watcher.stop();
        const stats = watcher.stats();
        console.log(`Final stats: ${JSON.stringify(stats)}`);
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      watcher.start();
    }
    return;
  }

  // --- run command ---
  // Merge CLI flags into config so RedTeamFactory/MultiRepoOrchestrator see them
  if (args.push) config.enablePush = true;
  if (args.pr) config.createPR = true;
  if (args.agent) config.agent = args.agent;
  if (args.remediate) config.enableAutoRemediation = true;
  if (args.retryBudget) config.maxRetryBudget = args.retryBudget;

  const factory = new RedTeamFactory(config);
  factory.initialize(config.repos || []);

  if (args.tasks) {
    const tasks = normalizeTasks(readJson(args.tasks), config);

    for (const t of tasks) {
      if (t.crossRepo) {
        factory.submitCrossRepoTask(t);
      } else {
        if (!t.repo) throw new Error('task missing required field: repo');
        factory.submitTask(t.repo, t);
      }
    }
  }

  const results = await factory.run();
  process.stdout.write(`\nRun complete. Results:\n${JSON.stringify(results, null, 2)}\n`);
}

import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err) => {
    process.stderr.write(`Error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}

export { parseArgs, readJson, normalizeTasks, main };