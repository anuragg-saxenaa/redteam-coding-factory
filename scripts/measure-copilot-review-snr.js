#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { evaluateCopilotReviewMetrics } = require('../src/copilot-review-metrics');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--policy') args.policy = argv[++i];
    else if (token === '--events') args.events = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
  }
  return args;
}

function usage(exitCode = 0) {
  const msg = [
    'Usage: node scripts/measure-copilot-review-snr.js --policy <policy.json> --events <events.json>',
    '',
    'Computes Copilot review signal-to-noise and rollout gates for TICKET-2026-02-28-03.',
  ].join('\n');
  process.stdout.write(`${msg}\n`);
  process.exit(exitCode);
}

function readJson(filePath) {
  const absPath = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);
  if (!args.policy || !args.events) usage(1);

  const policy = readJson(args.policy);
  const events = readJson(args.events);

  const result = evaluateCopilotReviewMetrics(events, policy);

  process.stdout.write('Copilot review signal-to-noise results:\n');
  for (const check of result.checks) {
    const mark = check.pass ? 'PASS' : 'FAIL';
    process.stdout.write(`- [${mark}] ${check.name}: ${check.detail}\n`);
  }

  process.stdout.write(`Overall: ${result.pass ? 'PASS' : 'FAIL'}\n`);
  process.stdout.write(`Stats: ${JSON.stringify(result.stats)}\n`);

  if (!result.pass) process.exit(1);
}

main();
