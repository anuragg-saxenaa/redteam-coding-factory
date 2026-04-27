/**
 * Pipeline Doctor — Unit Tests
 * Tests: retry logic, escalation conditions, judge parsing, confidence threshold
 */

const PipelineDoctor = require('../src/pipeline-doctor');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeDoctor(overrides = {}) {
  return new PipelineDoctor({
    judgeModel: 'mock',
    maxIterations: 3,
    confidenceThreshold: 0.3,
    judgeTimeoutMs: 5000,
    fixTimeoutMs: 10000,
    worktreeRoot: os.tmpdir(),
    ...overrides,
  });
}

function mockTask(overrides = {}) {
  return {
    id: 'task-001',
    title: 'Fix NPE in UserService',
    description: 'UserService.getUser() throws NPE when userId is null',
    worktreePath: os.tmpdir(),
    ...overrides,
  };
}

function mockValidationResult(failures = []) {
  return { valid: failures.length === 0, failures };
}

function mockExecutionResult(stdout = '', stderr = '') {
  return { stdout, stderr, exitCode: stderr ? 1 : 0 };
}

// ─── Test: Constructor sets defaults ─────────────────────────────────────────
async function testConstructorDefaults() {
  const doctor = makeDoctor();
  console.assert(doctor.config.maxIterations === 3, 'maxIterations default should be 3');
  console.assert(doctor.config.confidenceThreshold === 0.3, 'confidenceThreshold default should be 0.3');
  console.assert(doctor.config.judgeTimeoutMs === 5000, 'judgeTimeoutMs should be 5000');
  console.assert(doctor.totalActivated === 0, 'totalActivated should start at 0');
  console.log('✓ Constructor defaults');
}

// ─── Test: Judge JSON parsing ──────────────────────────────────────────────────
async function testJudgeParsing() {
  const doctor = makeDoctor();

  const valid = doctor._parseJudgeResponse(JSON.stringify({
    diagnosis: 'NullPointerException at line 42 due to unvalidated userId',
    fixInstructions: 'Add null check: if (userId == null) throw new IllegalArgumentException',
    confidence: 0.85,
    fixable: true,
    category: 'logic_error',
    estimatedComplexity: 'simple',
    riskOfRegression: 'low',
  }));
  console.assert(valid.diagnosis.includes('NullPointerException'), 'Should parse diagnosis');
  console.assert(valid.confidence === 0.85, 'Should parse confidence');
  console.assert(valid.fixable === true, 'Should parse fixable');
  console.assert(valid.category === 'logic_error', 'Should parse category');
  console.log('✓ Judge JSON parsing — valid');

  // Markdown code block
  const fromBlock = doctor._parseJudgeResponse('```json\n{"diagnosis":"test","fixInstructions":"fix","confidence":0.9,"fixable":true,"category":"other","estimatedComplexity":"trivial","riskOfRegression":"low"}\n```');
  console.assert(fromBlock.confidence === 0.9, 'Should parse from markdown block');
  console.log('✓ Judge JSON parsing — markdown code block');

  // Malformed → throws
  let threw = false;
  try {
    doctor._parseJudgeResponse('not json at all');
  } catch {
    threw = true;
  }
  console.assert(threw, 'Should throw on malformed JSON');
  console.log('✓ Judge JSON parsing — throws on malformed');
}

// ─── Test: Confidence threshold escalation ────────────────────────────────────
async function testConfidenceThresholdEscalation() {
  const doctor = makeDoctor({ maxIterations: 3, confidenceThreshold: 0.5 });

  // Mock _callJudge to return low confidence
  const originalCallJudge = doctor._callJudge.bind(doctor);
  doctor._callJudge = async () => ({
    diagnosis: 'Unknown root cause',
    fixInstructions: '',
    confidence: 0.1,
    fixable: true,
    category: 'other',
    estimatedComplexity: 'unknown',
    riskOfRegression: 'unknown',
  });

  const task = mockTask();
  const result = await doctor.heal(
    task,
    mockExecutionResult('', 'FAIL: test'),
    mockValidationResult([{ type: 'test' }]),
    task.worktreePath,
    {}
  );

  console.assert(result.healed === false, 'Should not heal with low confidence');
  console.assert(result.escalationReason === 'low_confidence_or_not_fixable', 'Should escalate for low confidence');
  console.assert(doctor.totalEscalated === 1, 'Should increment escalated count');
  console.log('✓ Confidence threshold escalation');
}

// ─── Test: Fixable=false triggers escalation ───────────────────────────────────
async function testNotFixableEscalation() {
  const doctor = makeDoctor({ maxIterations: 2, confidenceThreshold: 0.1 });

  doctor._callJudge = async () => ({
    diagnosis: 'Ambiguous requirement — human judgment needed',
    fixInstructions: '',
    confidence: 0.8,
    fixable: false,
    category: 'other',
    estimatedComplexity: 'complex',
    riskOfRegression: 'high',
  });

  const task = mockTask();
  const result = await doctor.heal(
    task,
    mockExecutionResult('', 'FAIL'),
    mockValidationResult([{ type: 'test' }]),
    task.worktreePath,
    {}
  );

  console.assert(result.healed === false, 'Should not heal when fixable=false');
  console.assert(result.escalationReason === 'low_confidence_or_not_fixable', 'Should escalate');
  console.log('✓ fixable=false triggers escalation');
}

// ─── Test: Max iterations escalation ──────────────────────────────────────────
async function testMaxIterationsEscalation() {
  const doctor = makeDoctor({ maxIterations: 2, confidenceThreshold: 0.1 });

  let attempts = 0;
  doctor._callJudge = async () => {
    attempts++;
    return {
      diagnosis: `Attempt ${attempts}: root cause identified`,
      fixInstructions: 'Apply fix',
      confidence: 0.85,
      fixable: true,
      category: 'logic_error',
      estimatedComplexity: 'simple',
      riskOfRegression: 'low',
    };
  };

  // Mock dispatch fix to simulate test still failing after fix
  doctor._dispatchFix = async () => ({ success: true });

  // Mock revalidate to always return invalid
  doctor._revalidate = async () => mockValidationResult([{ type: 'test', message: 'still failing' }]);

  const task = mockTask();
  const result = await doctor.heal(
    task,
    mockExecutionResult('', 'FAIL'),
    mockValidationResult([{ type: 'test' }]),
    task.worktreePath,
    {}
  );

  console.assert(result.healed === false, 'Should not heal after max iterations');
  console.assert(result.escalationReason === 'max_iterations_exceeded', 'Should escalate with max_iterations_exceeded');
  console.assert(attempts === 2, 'Should make exactly 2 judge calls');
  console.log('✓ Max iterations escalation');
}

// ─── Test: Successful heal on first attempt ────────────────────────────────────
async function testSuccessfulHeal() {
  const doctor = makeDoctor({ maxIterations: 3 });

  let judgeCalls = 0;
  doctor._callJudge = async () => {
    judgeCalls++;
    return {
      diagnosis: 'Missing null check on userId parameter',
      fixInstructions: 'Add: if (userId == null) throw new IllegalArgumentException("userId")',
      confidence: 0.92,
      fixable: true,
      category: 'logic_error',
      estimatedComplexity: 'simple',
      riskOfRegression: 'low',
    };
  };

  doctor._dispatchFix = async () => ({ success: true });

  // Revalidate returns valid after fix
  doctor._revalidate = async () => mockValidationResult([]);

  const task = mockTask();
  const result = await doctor.heal(
    task,
    mockExecutionResult('', 'FAIL: NullPointerException'),
    mockValidationResult([{ type: 'test', message: 'NullPointerException' }]),
    task.worktreePath,
    {}
  );

  console.assert(result.healed === true, 'Should heal successfully');
  console.assert(result.iterations.length === 1, 'Should have 1 iteration');
  console.assert(doctor.totalHealed === 1, 'Should increment healed count');
  console.assert(judgeCalls === 1, 'Should call judge once');
  console.log('✓ Successful heal on first attempt');
}

// ─── Test: Regression detection ────────────────────────────────────────────────
async function testRegressionDetection() {
  const doctor = makeDoctor({ maxIterations: 2, enableRegressionDetection: true });

  doctor._callJudge = async () => ({
    diagnosis: 'Fix the assertion',
    fixInstructions: 'change assertion',
    confidence: 0.9,
    fixable: true,
    category: 'wrong_assertion',
    estimatedComplexity: 'simple',
    riskOfRegression: 'low',
  });

  let revalidateCount = 0;
  doctor._revalidate = async () => {
    revalidateCount++;
    // First revalidate: still failing (1 failed test)
    // Second revalidate: MORE failures (2 failed tests) → regression
    if (revalidateCount === 1) {
      return mockValidationResult([{ type: 'fail' }]);
    }
    return mockValidationResult([{ type: 'fail' }, { type: 'fail' }]);
  };

  doctor._dispatchFix = async () => ({ success: true });

  const task = mockTask();
  const result = await doctor.heal(
    task,
    mockExecutionResult('', 'FAIL'),
    mockValidationResult([{ type: 'fail' }]),
    task.worktreePath,
    {}
  );

  console.assert(result.healed === false, 'Should not heal when regression detected');
  console.log('✓ Regression detection');
}

// ─── Test: Judge error → low confidence fallback ───────────────────────────────
async function testJudgeErrorHandling() {
  const doctor = makeDoctor({ maxIterations: 1 });

  doctor._callJudge = async () => {
    throw new Error('Network timeout');
  };

  const task = mockTask();
  const result = await doctor.heal(
    task,
    mockExecutionResult('', 'FAIL'),
    mockValidationResult([{ type: 'test' }]),
    task.worktreePath,
    {}
  );

  console.assert(result.healed === false, 'Should not heal on judge error');
  console.assert(result.iterations[0].category === 'judge_error', 'Should mark as judge_error');
  console.log('✓ Judge error handling');
}

// ─── Test: Metrics tracking ────────────────────────────────────────────────────
async function testMetricsTracking() {
  const doctor = makeDoctor({ maxIterations: 1 });

  // Success case
  doctor._callJudge = async () => ({
    diagnosis: 'Fix',
    fixInstructions: 'fix',
    confidence: 0.9,
    fixable: true,
    category: 'missing_import',
    estimatedComplexity: 'trivial',
    riskOfRegression: 'low',
  });
  doctor._dispatchFix = async () => ({ success: true });
  doctor._revalidate = async () => mockValidationResult([]);

  await doctor.heal(mockTask({ id: 't1' }), mockExecutionResult(), mockValidationResult([]), os.tmpdir(), {});

  // Failure case
  doctor._callJudge = async () => ({
    diagnosis: 'Fix',
    fixInstructions: 'fix',
    confidence: 0.05,
    fixable: true,
    category: 'config_error',
    estimatedComplexity: 'complex',
    riskOfRegression: 'high',
  });
  doctor._revalidate = async () => mockValidationResult([{ type: 'fail' }]);

  await doctor.heal(mockTask({ id: 't2' }), mockExecutionResult(), mockValidationResult([{ type: 'fail' }]), os.tmpdir(), {});

  const report = doctor.report();
  console.assert(report.totalActivated === 2, 'Should track 2 activations');
  console.assert(report.totalHealed === 1, 'Should track 1 heal');
  console.assert(report.totalEscalated === 1, 'Should track 1 escalation');
  console.assert(report.byCategory.missing_import === 1, 'Should track by category');
  console.assert(report.byCategory.config_error === 1, 'Should track config_error category');
  console.log('✓ Metrics tracking');
}

// ─── Test: _buildFailureContext ────────────────────────────────────────────────
async function testBuildFailureContext() {
  const doctor = makeDoctor();

  const context = doctor._buildFailureContext(
    mockTask(),
    mockExecutionResult('stdout output', 'FAIL: test error'),
    mockValidationResult([{ type: 'test', message: 'test error' }]),
    os.tmpdir(),
    1,
    []
  );

  console.assert(context.taskDescription.includes('NPE'), 'Should include task description');
  console.assert(context.failedStage === 'test', 'Should detect test stage');
  console.assert(context.testOutput.includes('FAIL'), 'Should include test output');
  console.assert(context.attemptNumber === 1, 'Should set attempt number');
  console.assert(context.previousDiagnoses === 'None', 'Should show no previous diagnoses');
  console.log('✓ _buildFailureContext');
}

// ─── Test: report() ─────────────────────────────────────────────────────────────
async function testReport() {
  const doctor = makeDoctor();
  doctor.totalActivated = 10;
  doctor.totalHealed = 7;
  doctor.totalEscalated = 3;
  doctor.iterationCount = 15;
  doctor._trackCategory('logic_error');
  doctor._trackCategory('logic_error');
  doctor._trackCategory('missing_import');
  doctor.confidenceHistory.push(0.9, 0.7, 0.5);

  const report = doctor.report();
  console.assert(report.totalActivated === 10, 'Should report totalActivated');
  console.assert(report.healRate === '0.700', 'Should calculate heal rate');
  console.assert(report.avgIterations === '1.50', 'Should calculate avg iterations');
  console.assert(report.byCategory.logic_error === 2, 'Should track logic_error count');
  console.assert(report.byCategory.missing_import === 1, 'Should track missing_import count');
  console.log('✓ report() aggregation');
}

// ─── Run all tests ──────────────────────────────────────────────────────────────
async function runAll() {
  console.log('\nPipeline Doctor Unit Tests\n' + '─'.repeat(40));
  try {
    await testConstructorDefaults();
    await testJudgeParsing();
    await testConfidenceThresholdEscalation();
    await testNotFixableEscalation();
    await testMaxIterationsEscalation();
    await testSuccessfulHeal();
    await testRegressionDetection();
    await testJudgeErrorHandling();
    await testMetricsTracking();
    await testBuildFailureContext();
    await testReport();
    console.log('\n✅ All tests passed');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

runAll();
