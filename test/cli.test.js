const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

// Smoke test: CLI help prints and exits 0.
const cli = path.join(__dirname, '..', 'src', 'cli.js');

const res = spawnSync('node', [cli, '--help'], { encoding: 'utf8' });
assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr}`);
assert.match(res.stdout, /RedTeam Coding Factory CLI/, 'help output should include title');

console.log('✓ CLI smoke test passed');
