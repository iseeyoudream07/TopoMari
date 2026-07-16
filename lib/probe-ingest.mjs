import { validateIdentifier } from "./agent-registry.mjs";

const MAX_SAMPLES_PER_REQUEST = 50;
const MAX_SAMPLE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export class ProbeValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProbeValidationError";
    this.status = status;
  }
}

function parseMeasuredAt(value, now) {
  if (value === undefined || value === null || value === "") return now;
  let parsed;
  if (typeof value === "number") {
    parsed = value < 100_000_000_000 ? value * 1000 : value;
  } else {
    parsed = Date.parse(String(value));
  }
  if (!Number.isFinite(parsed)) throw new ProbeValidationError("sample timestamp is invalid");
  if (parsed < now - MAX_SAMPLE_AGE_MS) throw new ProbeValidationError("sample timestamp is too old");
  if (parsed > now + MAX_FUTURE_SKEW_MS) throw new ProbeValidationError("sample timestamp is too far in the future");
  return Math.round(parsed);
}

function normalizeSample(sample, now) {
  let edgeId;
  try {
    edgeId = validateIdentifier(sample?.edge_id ?? sample?.edgeId, "edge id");
  } catch (error) {
    throw new ProbeValidationError(error.message);
  }
  if (typeof sample?.success !== "boolean") {
    throw new ProbeValidationError(`sample ${edgeId} success must be boolean`);
  }
  let latencyMs = null;
  if (sample.success) {
    latencyMs = Number(sample.latency_ms ?? sample.latencyMs);
    if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 60_000) {
      throw new ProbeValidationError(`sample ${edgeId} latency_ms must be between 0 and 60000`);
    }
    latencyMs = Math.round(latencyMs * 10) / 10;
  }
  return {
    edgeId,
    success: sample.success,
    latencyMs,
    measuredAt: parseMeasuredAt(sample.timestamp ?? sample.measured_at ?? sample.measuredAt, now),
    error: sample.success ? "" : String(sample.error || "connection failed").slice(0, 200),
  };
}

export function normalizeProbePayload(payload, now = Date.now()) {
  const candidates = Array.isArray(payload?.samples)
    ? payload.samples
    : payload && (payload.edge_id || payload.edgeId)
      ? [payload]
      : [];
  if (!candidates.length) throw new ProbeValidationError("request must contain at least one sample");
  if (candidates.length > MAX_SAMPLES_PER_REQUEST) {
    throw new ProbeValidationError(`request cannot contain more than ${MAX_SAMPLES_PER_REQUEST} samples`);
  }
  return candidates.map((sample) => normalizeSample(sample, now));
}

export class ProbeRateLimiter {
  constructor({ limit = 120, windowMs = 60_000 } = {}) {
    this.limit = Math.max(1, Number(limit) || 120);
    this.windowMs = Math.max(1000, Number(windowMs) || 60_000);
    this.requests = new Map();
  }

  allow(agentId, now = Date.now()) {
    const cutoff = now - this.windowMs;
    const recent = (this.requests.get(agentId) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.limit) {
      this.requests.set(agentId, recent);
      return false;
    }
    recent.push(now);
    this.requests.set(agentId, recent);
    return true;
  }
}
