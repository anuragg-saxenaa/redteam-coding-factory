#!/usr/bin/env node

const path = require('path');
const WorktreeManager = require('../src/worktree-manager');

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    worktreeRoot: null,
    pruneOlderHours: 168,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--repo') args.repo = argv[++i];
    else if (token === '--worktree-root') args.worktreeRoot = argv[++i];
    else if (token === '--prune-older-hours') args.pruneOlderHours = Number(argv[++i]);
    else if (token === '-h' || token === '--help') {
      process.stdout.write(
        [
          'Usage: node scripts/worktree-maintenance.js [options]',
          '',
          'Options:',
          '  --repo <path>               Base repo path (default: cwd)',
          '  --worktree-root <path>      Worktree root (default: <repo>/.worktrees)',
          '  --prune-older-hours <num>   Prune removed/stale metadata older than hours (default: 168)',
          '  -h, --help                  Show help',
          '',
        ].join('\n')
      );
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.pruneOlderHours) || args.pruneOlderHours < 0) {
    throw new Error('Invalid --prune-older-hours value');
  }

  if (!args.worktreeRoot) {
    args.worktreeRoot = path.join(args.repo, '.worktrees');
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const manager = new WorktreeManager(args.repo, args.worktreeRoot);

  const stale = manager.cleanupStale();
  const prune = manager.pruneManaged({ olderThanMs: args.pruneOlderHours * 60 * 60 * 1000 });

  process.stdout.write(
    JSON.stringify(
      {
        repo: args.repo,
        worktreeRoot: args.worktreeRoot,
        staleMarked: stale.staleMarked,
        dirsPruned: stale.dirsPruned,
        prunedRecords: prune.prunedRecords,
      },
      null,
      2
    ) + '\n'
  );
}

if (require.main === module) {
  main();
}
