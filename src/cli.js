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
 *   "repos": [ { "name": "repo1", "path": "/abs/path/repo1", "branch": "main" } ]
 * }
 *
 * Tasks shape (tasks.json):
 * [
 *   { "repo": "repo1", "title": "Do X", "description": "...", "force": false },
 *   { "crossRepo": true, "title": "...", "description": "...", "dependencies": [] }
 * ]
 */

const fs = require('fs');
const path = require('path');
const RedTeamFactory = require('./redteam-factory');

function usage(exitCode = 0) {
  const msg = `RedTeam Coding Factory CLI\n\nUsage:\n  redteam-factory run --config <factory.config.json> [--tasks <tasks.json>]\n\nOptions:\n  --config   Path to factory config JSON (required)\n  --tasks    Path to tasks JSON (optional; default: none)\n  --help     Show this help\n`;
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
    else args._.push(a);
  }
  return args;
}

function readJson(p) {
  const abs = path.resolve(process.cwd(), p);
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || args._.length === 0) usage(args.help ? 0 : 1);

  const cmd = args._[0];
  if (cmd !== 'run') {
    process.stderr.write(`Unknown command: ${cmd}\n\n`);
    usage(1);
  }

  if (!args.config) {
    process.stderr.write('Missing required --config\n\n');
    usage(1);
  }

  const config = readJson(args.config);
  const factory = new RedTeamFactory(config);
  factory.initialize(config.repos || []);

  if (args.tasks) {
    const tasks = readJson(args.tasks);
    if (!Array.isArray(tasks)) throw new Error('tasks.json must be an array');

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

main().catch((err) => {
  process.stderr.write(`Error: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
