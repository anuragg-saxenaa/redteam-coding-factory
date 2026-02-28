# Benchmark Policy (Phase 1 POC)

## Purpose
Use a single, stable benchmark policy so factory changes are evaluated consistently over time.

## Canonical Metric
- **Primary metric**: `SWE-bench Verified solve rate`.
- **Definition**: percentage of SWE-bench Verified tasks fully resolved by the factory within policy limits.
- **Formula**: `solve_rate = solved / attempted * 100`.

## Required Report Fields
Each benchmark run must include:
- Run metadata: date, commit SHA, runtime, model(s), temperature/config profile.
- Dataset metadata: SWE-bench Verified split/version and total attempted tasks.
- Outcomes: solved, unsolved, error, timeout counts.
- Primary metric: solve rate (%).
- Secondary metrics: median time-to-fix, average attempts per task, CI pass rate after generated patch.
- Failure taxonomy: environment/setup, test-flake, retrieval/context miss, patch-regression, policy-blocked.
- Cost envelope: total token and runtime cost (if available).

Use `ops/templates/swe-bench-verified-report.md` as the standard report format.

## Run Cadence
- Run on every significant factory behavior change (planner, executor, critic, remediation loop).
- Run at least weekly while Phase 1 is active.
- Tag runs with semantic IDs (`YYYY-MM-DD.<short-sha>.<profile>`).

## Acceptance Gates (Phase 1)
- Do not claim performance improvements without a SWE-bench Verified report.
- Any merge request that changes autonomous behavior must include:
  1. the latest report,
  2. baseline comparison,
  3. explicit regression callouts.

## Baseline and Regression Rules
- Maintain a rolling baseline from the last approved run on `main`.
- Flag regressions when solve rate drops by **>= 2.0 points** or median time-to-fix worsens by **>= 15%**.
- Regression exceptions require documented rationale and owner approval.

## Ownership
- **Owner**: ENG
- **Reviewers**: RED (delivery impact), INFOSEC (policy/security-sensitive changes)

## Notes
Operational metrics from `dataDir/metrics.json` are useful for runtime health, but they are **not** the canonical agent capability metric.
