/**
 * Best-of-N benchmark evaluation for SWE-bench-style task runs.
 *
 * Deterministic candidate selection order:
 *  1) solved=true
 *  2) ciPass=true
 *  3) patchScore desc
 *  4) testsPassed desc
 *  5) runtimeSec asc
 *  6) attempt asc
 *  7) candidateId asc
 */

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAttempt(raw = {}, index = 0) {
  return {
    taskId: raw.taskId || raw.task || 'unknown-task',
    attempt: toNumber(raw.attempt, index + 1),
    candidateId: String(raw.candidateId || raw.id || `candidate-${index + 1}`),
    solved: raw.solved === true,
    ciPass: raw.ciPass === true,
    patchScore: toNumber(raw.patchScore, 0),
    testsPassed: toNumber(raw.testsPassed, 0),
    runtimeSec: toNumber(raw.runtimeSec, Number.POSITIVE_INFINITY),
    error: raw.error || null,
  };
}

function candidateComparator(a, b) {
  if (a.solved !== b.solved) return a.solved ? -1 : 1;
  if (a.ciPass !== b.ciPass) return a.ciPass ? -1 : 1;
  if (a.patchScore !== b.patchScore) return b.patchScore - a.patchScore;
  if (a.testsPassed !== b.testsPassed) return b.testsPassed - a.testsPassed;
  if (a.runtimeSec !== b.runtimeSec) return a.runtimeSec - b.runtimeSec;
  if (a.attempt !== b.attempt) return a.attempt - b.attempt;
  return a.candidateId.localeCompare(b.candidateId);
}

function selectBestCandidate(attempts = []) {
  const normalized = attempts.map((a, idx) => normalizeAttempt(a, idx));
  if (normalized.length === 0) return null;
  const sorted = normalized.slice().sort(candidateComparator);
  return sorted[0];
}

function summarizeSelection(selectedByTask) {
  const attempted = selectedByTask.length;
  const solved = selectedByTask.filter((x) => x && x.solved).length;
  const ciPass = selectedByTask.filter((x) => x && x.ciPass).length;

  const attemptsUsed = selectedByTask
    .filter(Boolean)
    .map((x) => x.attempt);
  const avgAttempt = attemptsUsed.length
    ? +(attemptsUsed.reduce((sum, v) => sum + v, 0) / attemptsUsed.length).toFixed(2)
    : 0;

  return {
    attempted,
    solved,
    unsolved: attempted - solved,
    ciPass,
    solveRate: attempted > 0 ? +((solved / attempted) * 100).toFixed(2) : 0,
    avgSelectedAttempt: avgAttempt,
  };
}

function evaluateBestOfN({ tasks = [], n = 1 }) {
  const width = Math.max(1, toNumber(n, 1));

  const singleSelections = [];
  const bestOfNSelections = [];

  for (const task of tasks) {
    const taskId = task.taskId || task.id || 'unknown-task';
    const attempts = Array.isArray(task.attempts) ? task.attempts : [];
    const normalized = attempts.map((a, idx) => normalizeAttempt({ ...a, taskId }, idx));

    const firstAttempt = normalized
      .filter((a) => a.attempt === 1)
      .sort(candidateComparator)[0] || normalized.sort((a, b) => a.attempt - b.attempt)[0] || null;

    const bounded = normalized
      .slice()
      .sort((a, b) => a.attempt - b.attempt)
      .filter((a) => a.attempt <= width);

    const selected = selectBestCandidate(bounded);

    singleSelections.push(firstAttempt ? { taskId, ...firstAttempt } : { taskId, missing: true });
    bestOfNSelections.push(selected ? { taskId, ...selected } : { taskId, missing: true });
  }

  const baseline = summarizeSelection(singleSelections.filter((x) => !x.missing));
  const bestOfN = summarizeSelection(bestOfNSelections.filter((x) => !x.missing));

  const delta = {
    solveRatePoints: +(bestOfN.solveRate - baseline.solveRate).toFixed(2),
    solvedCount: bestOfN.solved - baseline.solved,
    ciPassCount: bestOfN.ciPass - baseline.ciPass,
    avgSelectedAttemptDelta: +(bestOfN.avgSelectedAttempt - baseline.avgSelectedAttempt).toFixed(2),
  };

  return {
    mode: `best-of-${width}`,
    n: width,
    baseline,
    bestOfN,
    delta,
    selections: {
      baseline: singleSelections,
      bestOfN: bestOfNSelections,
    },
  };
}

module.exports = {
  normalizeAttempt,
  candidateComparator,
  selectBestCandidate,
  evaluateBestOfN,
};
