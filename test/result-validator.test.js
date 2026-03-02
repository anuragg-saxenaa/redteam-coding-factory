#!/usr/bin/env node
const assert = require('assert');
const ResultValidator = require('../src/result-validator');

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

  assert.strictEqual(result.valid, false, 'validation should fail when lint stage is missing');
  assert.deepStrictEqual(result.errors, ['Missing validation step: lint']);

  const shortCircuit = result.artifacts.find(a => a.type === 'validation_short_circuit');
  assert(shortCircuit, 'should include short-circuit artifact for missing lint');
  assert.strictEqual(shortCircuit.step, 'lint');
  assert(shortCircuit.content.includes('test'), 'should report suppressed test step');
}

function testPassesWhenAllRequiredStagesSucceed() {
  const validator = createValidator();
  const task = { id: 'task-3' };
  const executionResult = {
    steps: [
      { name: 'lint', success: true },
      { name: 'test', success: true }
    ]
  };

  const result = validator.validate(task, executionResult, 'default');

  assert.strictEqual(result.valid, true, 'validation should pass when lint and test pass');
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(
    result.artifacts.some(a => a.type === 'validation_short_circuit'),
    false,
    'should not include short-circuit artifact on pass'
  );
}

function main() {
  testShortCircuitsAfterFailedStage();
  testShortCircuitsAfterMissingStage();
  testPassesWhenAllRequiredStagesSucceed();
  console.log('✓ result-validator tests passed');
}

main();
