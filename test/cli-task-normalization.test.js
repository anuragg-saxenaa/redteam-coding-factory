import assert from 'assert';
import { normalizeTasks, parseArgs } from '../src/cli.js';

const config = {
  repos: [
    { name: 'repo-a', path: '.', branch: 'main' }
  ]
};

// Array input should pass through unchanged.
const arrayTasks = [
  { repo: 'repo-a', title: 'task1', description: 'desc1' }
];
assert.deepStrictEqual(normalizeTasks(arrayTasks, config), arrayTasks);

// Legacy object input should become repo-scoped task array.
const legacyTasks = {
  build: {
    description: 'Build the project',
    commands: ['npm ci', 'npm run build']
  },
  test: {
    commands: ['npm test']
  }
};

const normalized = normalizeTasks(legacyTasks, config);
assert.strictEqual(normalized.length, 2);
assert.strictEqual(normalized[0].repo, 'repo-a');
assert.strictEqual(normalized[0].title, 'Run build');
assert.match(normalized[0].description, /Build the project/);
assert.match(normalized[0].description, /npm run build/);
assert.strictEqual(normalized[1].title, 'Run test');
assert.match(normalized[1].description, /Run test stage/);

// Missing repo context should raise actionable error.
assert.throws(
  () => normalizeTasks({ build: {} }, { repos: [] }),
  /legacy tasks\.json requires config\.repos\[0\]\.name/
);

const watchArgs = parseArgs([
  'watch',
  '--config', 'factory.config.json',
  '--max-tasks', '7',
  '--max-polls', '9'
]);
assert.strictEqual(watchArgs.maxTasks, 7);
assert.strictEqual(watchArgs.maxPolls, 9);

console.log('✓ CLI task normalization test passed');
