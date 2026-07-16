export const DEFAULT_HEALTH_THRESHOLDS = Object.freeze({
  warning_latency_ms: 150,
  degraded_latency_ms: 250,
  warning_loss_percent: 0,
  degraded_loss_percent: 20,
});

const THRESHOLD_KEYS = new Set(Object.keys(DEFAULT_HEALTH_THRESHOLDS));

export function resolveHealthThresholds(overrides = {}) {
  if (overrides === null || overrides === undefined) overrides = {};
  if (typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error("health_thresholds must be an object");
  }

  for (const key of Object.keys(overrides)) {
    if (!THRESHOLD_KEYS.has(key)) {
      throw new Error(`health_thresholds contains an unknown key: ${key}`);
    }
  }

  const thresholds = {};
  for (const [key, fallback] of Object.entries(DEFAULT_HEALTH_THRESHOLDS)) {
    const value = overrides[key] ?? fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`health_thresholds.${key} must be a non-negative number`);
    }
    thresholds[key] = parsed;
  }

  if (thresholds.warning_latency_ms >= thresholds.degraded_latency_ms) {
    throw new Error("health_thresholds.warning_latency_ms must be lower than degraded_latency_ms");
  }
  if (thresholds.warning_loss_percent >= thresholds.degraded_loss_percent) {
    throw new Error("health_thresholds.warning_loss_percent must be lower than degraded_loss_percent");
  }
  if (thresholds.degraded_loss_percent > 100) {
    throw new Error("health_thresholds.degraded_loss_percent must not exceed 100");
  }
  return thresholds;
}

export function classifyHealth(
  { hasData = true, latestFailed = false, loss = null, avg = null } = {},
  overrides = {},
) {
  if (!hasData) return "unknown";
  if (latestFailed) return "failed";

  const thresholds = resolveHealthThresholds(overrides);
  const lossValue = loss === null || loss === undefined ? null : Number(loss);
  const averageValue = avg === null || avg === undefined ? null : Number(avg);

  if (
    (Number.isFinite(lossValue) && lossValue >= thresholds.degraded_loss_percent) ||
    (Number.isFinite(averageValue) && averageValue >= thresholds.degraded_latency_ms)
  ) {
    return "degraded";
  }
  if (
    (Number.isFinite(lossValue) && lossValue > thresholds.warning_loss_percent) ||
    (Number.isFinite(averageValue) && averageValue >= thresholds.warning_latency_ms)
  ) {
    return "warning";
  }
  return "healthy";
}
