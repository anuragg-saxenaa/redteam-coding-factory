/**
 * LLM-generated test governance checks.
 * Enforces three merge gates:
 *  1) Golden dataset regressions are forbidden.
 *  2) Flake rate must stay below the configured threshold.
 *  3) Coverage must not regress versus baseline.
 */

import fs from 'node:fs';

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function indexGoldenCases(report) {
  const map = new Map();
  const cases = Array.isArray(report && report.goldenCases) ? report.goldenCases : [];

  for (const entry of cases) {
    if (!entry || typeof entry.id !== 'string') continue;
    map.set(entry.id, entry.passed === true);
  }

  return map;
}

function evaluateGovernance(policy, baselineReport, candidateReport) {
  const maxFlakeRatePct = Number((policy && policy.maxFlakeRatePct) ?? 0);
  const allowCoverageDropPct = Number((policy && policy.allowCoverageDropPct) ?? 0);

  const baselineGolden = indexGoldenCases(baselineReport);
  const candidateGolden = indexGoldenCases(candidateReport);

  const goldenRegressions = [];
  for (const [caseId, baselinePassed] of baselineGolden.entries()) {
    if (!baselinePassed) continue;
    const candidatePassed = candidateGolden.get(caseId) === true;
    if (!candidatePassed) goldenRegressions.push(caseId);
  }

  const candidateFlakeRatePct = Number((candidateReport && candidateReport.flakeRatePct) ?? 0);
  const flakeGatePass = candidateFlakeRatePct <= maxFlakeRatePct;

  const baselineCoveragePct = Number((baselineReport && baselineReport.coverage && baselineReport.coverage.linePct) ?? 0);
  const candidateCoveragePct = Number((candidateReport && candidateReport.coverage && candidateReport.coverage.linePct) ?? 0);
  const minAllowedCoveragePct = baselineCoveragePct - allowCoverageDropPct;
  const coverageGatePass = candidateCoveragePct >= minAllowedCoveragePct;

  const checks = [
    {
      name: 'golden_dataset_regression',
      pass: goldenRegressions.length === 0,
      detail: goldenRegressions.length === 0
        ? 'No golden dataset regressions.'
        : `Regressed golden cases: ${goldenRegressions.join(', ')}`,
    },
    {
      name: 'flake_rate_threshold',
      pass: flakeGatePass,
      detail: `Flake rate ${candidateFlakeRatePct}% (max ${maxFlakeRatePct}%).`,
    },
    {
      name: 'coverage_non_regression',
      pass: coverageGatePass,
      detail: `Line coverage ${candidateCoveragePct}% (min ${minAllowedCoveragePct}%).`,
    },
  ];

  return {
    pass: checks.every((check) => check.pass),
    checks,
    stats: {
      goldenRegressionCount: goldenRegressions.length,
      candidateFlakeRatePct,
      maxFlakeRatePct,
      baselineCoveragePct,
      candidateCoveragePct,
      minAllowedCoveragePct,
    },
  };
}

export { readJson, evaluateGovernance };
