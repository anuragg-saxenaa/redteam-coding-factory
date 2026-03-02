#!/usr/bin/env node

const path = require('path');
const { readJson, evaluateGovernance } = require('../src/llm-test-governance');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--policy') args.policy = argv[++i];
    else if (token === '--baseline') args.baseline = argv[++i];
    else if (token === '--candidate') args.candidate = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
  }
  return args;
}

function usage(exitCode = 0) {
  const msg = [
    'Usage: node scripts/verify-llm-test-governance.js --policy <policy.json> --baseline <baseline-report.json> --candidate <candidate-report.json>',
    '',
    'Checks:',
    '  - golden dataset regression gate',
    '  - flake rate threshold gate',
    '  - coverage non-regression gate',
  ].join('\n');

  process.stdout.write(`${msg}\n`);
  process.exit(exitCode);
}

function resolveFromCwd(filePath) {
  return path.resolve(process.cwd(), filePath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);

  if (!args.policy || !args.baseline || !args.candidate) {
    usage(1);
  }

  const policy = readJson(resolveFromCwd(args.policy));
  const baseline = readJson(resolveFromCwd(args.baseline));
  const candidate = readJson(resolveFromCwd(args.candidate));

  const result = evaluateGovernance(policy, baseline, candidate);

  process.stdout.write('LLM test governance results:\n');
  for (const check of result.checks) {
    const icon = check.pass ? 'PASS' : 'FAIL';
    process.stdout.write(`- [${icon}] ${check.name}: ${check.detail}\n`);
  }

  process.stdout.write(`Overall: ${result.pass ? 'PASS' : 'FAIL'}\n`);

  if (!result.pass) {
    process.exit(1);
  }
}

main();
