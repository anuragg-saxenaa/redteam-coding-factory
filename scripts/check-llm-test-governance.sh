#!/usr/bin/env bash
set -euo pipefail

POLICY_PATH="ops/llm-governance/policy.json"
BASELINE_PATH="ops/llm-governance/baseline-report.json"
CANDIDATE_PATH="ops/llm-governance/candidate-report.json"

node scripts/verify-llm-test-governance.js \
  --policy "$POLICY_PATH" \
  --baseline "$BASELINE_PATH" \
  --candidate "$CANDIDATE_PATH"
