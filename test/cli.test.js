import assert from 'assert';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const cli = path.join(__dirname, '..', 'src', 'cli.js');
assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr}`);
assert.match(res.stdout, /RedTeam Coding Factory CLI/, 'help output should include title');
assert.match(res.stdout, /redteam-factory tasks/, 'help output should include tasks command');

// Tasks command should normalize legacy tasks and print preview.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-factory-cli-'));
const configPath = path.join(tmpDir, 'factory.config.json');
const tasksPath = path.join(tmpDir, 'tasks.json');

fs.writeFileSync(configPath, JSON.stringify({ repos: [{ name: 'repo-a', path: '.', branch: 'main' }] }));
fs.writeFileSync(tasksPath, JSON.stringify({ test: { commands: ['npm test'] } }));

const tasksRes = spawnSync('node', [cli, 'tasks', '--config', configPath, '--tasks', tasksPath], { encoding: 'utf8' });
assert.strictEqual(tasksRes.status, 0, `expected exit 0, got ${tasksRes.status}\n${tasksRes.stderr}`);
assert.match(tasksRes.stdout, /Normalized 1 task\(s\)/);
assert.match(tasksRes.stdout, /"title": "Run test"/);

console.log('✓ CLI smoke test passed');
