#!/usr/bin/env node
import assert from 'assert';
import { ResultValidator } from '../src/result-validator.js';

function createValidator() {
  const noopTaskManager = {
    intake: () => ({ id: 'fix-task-id' }),
    get: () => null,
    persistQueue: () => {}
  };
  return new ResultValidator(noopTaskManager, null);
}

function testShortCircuitsAfterFailedStage() {
  const validator = createValidator();
  const task = { id: 'task-1' };
  const executionResult = {
    steps: [
      { name: 'lint', success: false, error: 'lint exploded' },
      { name: 'test', success: true }
    ]
  };

  const result = validator.validate(task, executionResult, 'default');

  assert.strictEqual(result.valid, false, 'validation should fail when lint fails');
  assert.deepStrictEqual(result.errors, ['lint failed: lint exploded']);

  const shortCircuit = result.artifacts.find(a => a.type === 'validation_short_circuit');
  assert(shortCircuit, 'should include short-circuit artifact');
  assert.strictEqual(shortCircuit.step, 'lint');
  assert(shortCircuit.content.includes('test'), 'should report suppressed downstream step');
}

function testShortCircuitsAfterMissingStage() {
  const validator = createValidator();
  const task = { id: 'task-2' };
  const executionResult = {
    steps: []
  };

  const result = validator.validate(task, executionResult, 'default');

  assert.strictEqual(result.valid, false, 'should fail on missing stage');
  const shortCircuit = result.artifacts.find(a => a.type === 'validation_short_circuit');
  assert(shortCircuit, 'should include short-circuit for missing stage');
}

function testValidResultPasses() {
  const validator = createValidator();
  const task = { id: 'task-3' };
  const executionResult = {
    steps: [
      { name: 'lint', success: true },
      { name: 'test', success: true }
    ]
  };

  const result = validator.validate(task, executionResult, 'default');

  assert.strictEqual(result.valid, true, 'all stages pass → valid');
  assert.deepStrictEqual(result.errors, []);
}

function testArtifactCollection() {
  const validator = createValidator();
  const task = { id: 'task-4' };
  const executionResult = {
    steps: [
      { name: 'lint', success: false, error: 'eslint no-unused-vars', output: '' },
    ]
  };

  const result = validator.validate(task, executionResult, 'default');

  assert(result.artifacts.length > 0, 'should produce at least one artifact');
  const lintFail = result.artifacts.find(a => a.type === 'error_log');
  assert(lintFail, 'should have lint failure artifact');
  assert.strictEqual(lintFail.step, 'lint');
}

// Run tests
testShortCircuitsAfterFailedStage();
testShortCircuitsAfterMissingStage();
testValidResultPasses();
testArtifactCollection();

console.log('✓ result-validator tests passed');
