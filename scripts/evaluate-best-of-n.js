#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { evaluateBestOfN } = require('../src/best-of-n-benchmark');

function usage(exitCode = 0) {
  const msg = [
    'Usage: node scripts/evaluate-best-of-n.js --input <attempts.json> [--n <int>] [--output <report.json>]',
    '',
    'Input JSON shape:',
    '{',
    '  "tasks": [',
    '    {',
    '      "taskId": "task-1",',
    '      "attempts": [',
    '        { "attempt": 1, "candidateId": "a", "solved": false, "ciPass": false, "patchScore": 0.3, "testsPassed": 22, "runtimeSec": 120 },',
    '        { "attempt": 2, "candidateId": "b", "solved": true,  "ciPass": true,  "patchScore": 0.9, "testsPassed": 30, "runtimeSec": 150 }',
    '      ]',
    '    }',
    '  ]',
    '}',
  ].join('\n');
  process.stdout.write(`${msg}\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') args.help = true;
    else if (token === '--input') args.input = argv[++i];
    else if (token === '--n') args.n = parseInt(argv[++i], 10);
    else if (token === '--output') args.output = argv[++i];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function resolveFromCwd(p) {
  return path.resolve(process.cwd(), p);
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);
  if (!args.input) usage(1);

  const inputPath = resolveFromCwd(args.input);
  const input = readJson(inputPath);
  const report = evaluateBestOfN({ tasks: input.tasks || [], n: args.n || 3 });

  const output = JSON.stringify(report, null, 2);
  if (args.output) {
    const outPath = resolveFromCwd(args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    process.stdout.write(`Wrote report: ${outPath}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`Error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  main,
};
