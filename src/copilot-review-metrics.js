/**
 * Copilot review signal-to-noise metrics.
 *
 * Input schema (JSON array):
 * [
 *   {
 *     "prNumber": 123,
 *     "submittedAt": "2026-02-28T12:00:00Z",
 *     "isDraft": false,
 *     "onNewPush": true,
 *     "outcome": "accepted" | "partially_accepted" | "rejected" | "ignored"
 *   }
 * ]
 */

const VALID_OUTCOMES = new Set([
  'accepted',
  'partially_accepted',
  'rejected',
  'ignored',
]);

function parseIsoDate(value) {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return ts;
}

function validateEvent(event, index) {
  if (!event || typeof event !== 'object') {
    throw new Error(`Event at index ${index} must be an object`);
  }

  if (!VALID_OUTCOMES.has(event.outcome)) {
    throw new Error(`Event at index ${index} has invalid outcome: ${event.outcome}`);
  }

  if (typeof event.isDraft !== 'boolean') {
    throw new Error(`Event at index ${index} is missing boolean isDraft`);
  }

  if (typeof event.onNewPush !== 'boolean') {
    throw new Error(`Event at index ${index} is missing boolean onNewPush`);
  }

  parseIsoDate(event.submittedAt);
}

function roundPct(value) {
  return Math.round(value * 100) / 100;
}

function evaluateCopilotReviewMetrics(events, policy = {}) {
  if (!Array.isArray(events)) {
    throw new Error('events must be an array');
  }

  for (let i = 0; i < events.length; i++) {
    validateEvent(events[i], i);
  }

  const includeDraftReviews = policy.includeDraftReviews === true;
  const requireOnNewPush = policy.requireOnNewPush !== false;

  const inScope = events.filter((event) => {
    if (!includeDraftReviews && event.isDraft) return false;
    if (requireOnNewPush && !event.onNewPush) return false;
    return true;
  });

  const counts = {
    accepted: 0,
    partiallyAccepted: 0,
    rejected: 0,
    ignored: 0,
  };

  for (const event of inScope) {
    if (event.outcome === 'accepted') counts.accepted++;
    if (event.outcome === 'partially_accepted') counts.partiallyAccepted++;
    if (event.outcome === 'rejected') counts.rejected++;
    if (event.outcome === 'ignored') counts.ignored++;
  }

  const signalCount = counts.accepted + counts.partiallyAccepted;
  const noiseCount = counts.rejected + counts.ignored;
  const total = inScope.length;

  const adoptionRatePct = total > 0 ? (signalCount / total) * 100 : 0;
  const ignoredRatePct = total > 0 ? (counts.ignored / total) * 100 : 0;
  const signalToNoiseRatio = noiseCount > 0 ? signalCount / noiseCount : signalCount;

  const thresholds = {
    minSnr: Number(policy.minSnr ?? 1.0),
    minAdoptionRatePct: Number(policy.minAdoptionRatePct ?? 40),
    maxIgnoredRatePct: Number(policy.maxIgnoredRatePct ?? 35),
    minSampleSize: Number(policy.minSampleSize ?? 20),
  };

  const checks = [
    {
      name: 'sample_size',
      pass: total >= thresholds.minSampleSize,
      detail: `Sample size ${total} (min ${thresholds.minSampleSize})`,
    },
    {
      name: 'signal_to_noise',
      pass: signalToNoiseRatio >= thresholds.minSnr,
      detail: `SNR ${roundPct(signalToNoiseRatio)} (min ${thresholds.minSnr})`,
    },
    {
      name: 'adoption_rate',
      pass: adoptionRatePct >= thresholds.minAdoptionRatePct,
      detail: `Adoption ${roundPct(adoptionRatePct)}% (min ${thresholds.minAdoptionRatePct}%)`,
    },
    {
      name: 'ignored_rate',
      pass: ignoredRatePct <= thresholds.maxIgnoredRatePct,
      detail: `Ignored ${roundPct(ignoredRatePct)}% (max ${thresholds.maxIgnoredRatePct}%)`,
    },
  ];

  return {
    pass: checks.every((check) => check.pass),
    checks,
    stats: {
      totalEvents: events.length,
      inScopeEvents: total,
      signalCount,
      noiseCount,
      signalToNoiseRatio: roundPct(signalToNoiseRatio),
      adoptionRatePct: roundPct(adoptionRatePct),
      ignoredRatePct: roundPct(ignoredRatePct),
      counts,
    },
  };
}

export { evaluateCopilotReviewMetrics };
