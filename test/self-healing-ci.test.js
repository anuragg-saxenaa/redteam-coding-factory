/**
 * Self-Healing CI Tests — TICKET-2026-02-24-01
 */

const { SelfHealingCI, classifyFailure, FAILURE_CLASSES } = require('../src/self-healing-ci');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ─── Test 1: classifyFailure ────────────────────────────────────────────────
console.log('\nTest 1: failure classification');

assert(classifyFailure('ECONNREFUSED')          === 'NETWORK_ERROR',    'ECONNREFUSED → NETWORK_ERROR');
assert(classifyFailure('ETIMEDOUT')             === 'TIMEOUT',          'ETIMEDOUT → TIMEOUT');
assert(classifyFailure('lock file exists')      === 'LOCK_CONTENTION',  'lock → LOCK_CONTENTION');
assert(classifyFailure('eslint no-unused-vars') === 'LINT_ERROR',       'eslint → LINT_ERROR');
assert(classifyFailure('AssertionError: expect') === 'TEST_FAILURE',    'assertion → TEST_FAILURE');
assert(classifyFailure('SyntaxError: unexpected token') === 'BUILD_ERROR', 'SyntaxError → BUILD_ERROR');
assert(classifyFailure('completely unrelated error') === 'UNKNOWN',     'unknown → UNKNOWN');

// ─── Test 2: stage passes first attempt ─────────────────────────────────────
console.log('\nTest 2: stage passes first attempt');
(async () => {
  const healer = new SelfHealingCI({ baseDelayMs: 0 });
  const result = await healer.runStage('lint', async () => ({ success: true }));
  assert(result.success === true,  'success is true');
  assert(result.attempts === 1,    'only 1 attempt needed');

// ─── Test 3: transient failure retried, then passes ──────────────────────────
  console.log('\nTest 3: transient failure retried, then passes');
  let calls = 0;
  const healer2 = new SelfHealingCI({ baseDelayMs: 0 });
  const result2 = await healer2.runStage('fetch', async () => {
    calls++;
    if (calls < 2) return { success: false, error: 'ECONNREFUSED connect ECONNREFUSED', output: '' };
    return { success: true };
  });
  assert(result2.success === true,  'eventually succeeds');
  assert(result2.attempts === 2,    '2 attempts (1 fail + 1 pass)');

// ─── Test 4: permanent failure hits cap of 1 retry ───────────────────────────
  console.log('\nTest 4: permanent failure hits PERMANENT_MAX_RETRIES=1');
  let pcalls = 0;
  const healer3 = new SelfHealingCI({ baseDelayMs: 0 });
  const result3 = await healer3.runStage('lint', async () => {
    pcalls++;
    return { success: false, error: 'eslint no-undef error', output: '' };
  });
  assert(result3.success === false,             'stage failed');
  assert(result3.attempts === 1,                'permanent: only 1 attempt');
  assert(result3.classification === 'LINT_ERROR', 'classified as LINT_ERROR');
  assert(result3.transient === false,           'marked non-transient');

// ─── Test 5: pipeline stops on first failure ─────────────────────────────────
  console.log('\nTest 5: pipeline halts on first failure');
  const healer4 = new SelfHealingCI({ baseDelayMs: 0 });
  let stage2ran = false;
  const pipeResult = await healer4.runPipeline([
    { name: 'lint',  fn: async () => ({ success: false, error: 'eslint no-unused-vars', output: '' }) },
    { name: 'test',  fn: async () => { stage2ran = true; return { success: true }; } },
  ]);
  assert(pipeResult.passed === false,                   'pipeline failed');
  assert(pipeResult.results['lint'].success === false,  'lint stage failed');
  assert(stage2ran === false,                           'test stage never ran');

// ─── Test 6: escalation callback fires ───────────────────────────────────────
  console.log('\nTest 6: escalation callback fires');
  let escalated = false;
  const healer5 = new SelfHealingCI({
    baseDelayMs: 0,
    maxRetries: 2,
    onEscalate: () => { escalated = true; },
  });
  await healer5.runStage('test', async () => ({ success: false, error: 'ECONNREFUSED', output: '' }));
  assert(escalated === true, 'onEscalate callback was called');

// ─── Test 7: MetricsWriter records pass and fail ──────────────────────────────
  console.log('\nTest 7: MetricsWriter records entries');
  const path = require('path');
  const os   = require('os');
  const MetricsWriter = require('../src/metrics-writer');
  const tmpPath = path.join(os.tmpdir(), `metrics-test-${Date.now()}.json`);
  const mw = new MetricsWriter({ metricsPath: tmpPath });

  const dummyTask = { id: 'task-001', title: 'Test Task', repo: 'test-repo', branch: 'main' };
  const t0 = new Date(Date.now() - 1200);

  mw.record({ task: dummyTask, startTime: t0, passed: true,  attempts: 1 });
  mw.record({ task: dummyTask, startTime: t0, passed: false, attempts: 2, error: 'lint failed' });

  const stats = mw.stats();
  assert(stats.total === 2,        'two entries recorded');
  assert(stats.passed === 1,       '1 passed');
  assert(stats.failed === 1,       '1 failed');
  assert(stats.passRate === 50,    'pass rate 50%');
  assert(stats.avgAttempts === 1.5, 'avg attempts 1.5');

  const summary = mw.slackSummary(5);
  assert(summary.includes('Pass rate'), 'slack summary includes Pass rate');
  assert(summary.includes('✅'),        'slack summary has green checkmark');
  assert(summary.includes('❌'),        'slack summary has red cross');

// ─── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n=== Self-Healing CI Tests: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
})().catch(err => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
