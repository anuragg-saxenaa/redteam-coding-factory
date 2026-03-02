# Copilot Review Rollout (TICKET-2026-02-28-03)

## Objective
Roll out organization-level Copilot code review ruleset for coding-factory repositories with measurable signal quality and explicit security gates.

## Scope
- Auto-request Copilot review on PR open.
- Re-review on new pushes.
- Optional draft review (disabled by default).
- 14-day measurement window for signal-to-noise.

## Preconditions
- INFOSEC sign-off for production enablement.
- Repositories in scope are identified and tracked.
- Branch protection requires at least one human review before merge.
- CI governance jobs (workflow governance + LLM test governance) are green.

## Rollout Plan
1. Create org-level ruleset with Copilot review enabled for target repositories.
2. Configure review behavior:
   - On PR open: enabled
   - On new push: enabled
   - On draft PR: disabled (pilot phase)
3. Run pilot on low-risk repositories for 14 days.
4. Record Copilot review events in `ops/copilot-review/events-YYYY-WW.json`.
5. Evaluate quality with:
   - `node scripts/measure-copilot-review-snr.js --policy ops/copilot-review/measurement-policy.json --events <events.json>`
6. Expand rollout only if measurement gates pass.

## Measurement Gates
Policy source: `ops/copilot-review/measurement-policy.json`

- Minimum sample size: 20 in-scope events
- Minimum signal-to-noise ratio: 1.0
- Minimum adoption rate: 40%
- Maximum ignored rate: 35%

Definitions:
- Signal: `accepted` + `partially_accepted`
- Noise: `rejected` + `ignored`
- In-scope: excludes draft reviews unless explicitly enabled; requires event tied to a new push by default.

## Event Schema
```json
[
  {
    "prNumber": 123,
    "submittedAt": "2026-02-28T12:00:00Z",
    "isDraft": false,
    "onNewPush": true,
    "outcome": "accepted"
  }
]
```

## Security and Governance Notes
- Copilot review comments are advisory; merges still require human approval.
- No direct write/merge permissions are granted via this rollout.
- Keep audit evidence: ruleset config snapshots + measurement outputs in repo history.

## Exit Criteria
- INFOSEC approves controls.
- Two-week measurement result is PASS.
- No material CI or review-process regressions during pilot.
