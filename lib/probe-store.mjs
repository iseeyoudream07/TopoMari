import { mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classifyHealth } from "./health-status.mjs";
import { validateIdentifier } from "./agent-registry.mjs";

const MAX_QUERY_ROWS = 50_000;

function round(value) {
  return Math.round(value * 10) / 10;
}

function unknownStats() {
  return {
    latest: null,
    avg: null,
    min: null,
    max: null,
    loss: null,
    total: 0,
    status: "unknown",
    updatedAt: null,
    history: [],
  };
}

function hashEnrollmentCode(code) {
  return createHash("sha256").update(String(code || ""), "utf8").digest("hex");
}

function downsample(rows, limit = 60) {
  if (rows.length <= limit) return rows;
  const sampled = [];
  const step = (rows.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    sampled.push(rows[Math.round(index * step)]);
  }
  return sampled;
}

export function computeProbeStats(rows, healthThresholds = {}) {
  if (!rows.length) return unknownStats();

  const ordered = [...rows].sort((left, right) => Number(left.measured_at) - Number(right.measured_at));
  const successes = ordered.filter((row) => Number(row.success) === 1 && Number.isFinite(Number(row.latency_ms)));
  const values = successes.map((row) => Number(row.latency_ms));
  const failures = ordered.length - successes.length;
  const latestRow = ordered.at(-1);
  const latest = Number(latestRow.success) === 1 && Number.isFinite(Number(latestRow.latency_ms))
    ? Number(latestRow.latency_ms)
    : null;
  const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const loss = round((failures / ordered.length) * 100);

  const status = classifyHealth(
    {
      hasData: true,
      latestFailed: Number(latestRow.success) !== 1,
      loss,
      avg,
    },
    healthThresholds,
  );

  return {
    latest: latest === null ? null : round(latest),
    avg: avg === null ? null : round(avg),
    min: min === null ? null : round(min),
    max: max === null ? null : round(max),
    loss,
    total: ordered.length,
    status,
    updatedAt: new Date(Number(latestRow.measured_at)).toISOString(),
    history: downsample(ordered).map((row) => ({
      time: new Date(Number(row.measured_at)).toISOString(),
      value: Number(row.success) === 1 && Number.isFinite(Number(row.latency_ms))
        ? round(Number(row.latency_ms))
        : null,
    })),
  };
}

export class ProbeStore {
  constructor({ filePath, retentionDays = 7, now = () => Date.now() } = {}) {
    if (!filePath) throw new Error("ProbeStore filePath is required");
    this.filePath = resolve(filePath);
    this.retentionDays = Math.max(1, Number(retentionDays) || 7);
    this.now = now;
    this.lastCleanupAt = 0;

    mkdirSync(dirname(this.filePath), { recursive: true });
    this.database = new DatabaseSync(this.filePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS probe_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        edge_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        measured_at INTEGER NOT NULL,
        latency_ms REAL,
        success INTEGER NOT NULL CHECK (success IN (0, 1)),
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_probe_samples_edge_time
        ON probe_samples(edge_id, measured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_probe_samples_agent_time
        ON probe_samples(agent_id, measured_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_probe_samples_unique
        ON probe_samples(agent_id, edge_id, measured_at);
      CREATE TABLE IF NOT EXISTS agent_enrollments (
        code_hash TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        rotate_existing INTEGER NOT NULL DEFAULT 0 CHECK (rotate_existing IN (0, 1)),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_agent_enrollments_agent
        ON agent_enrollments(agent_id, created_at DESC);
    `);

    this.insertStatement = this.database.prepare(`
      INSERT OR IGNORE INTO probe_samples(edge_id, agent_id, measured_at, latency_ms, success, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.edgeRowsStatement = this.database.prepare(`
      SELECT measured_at, latency_ms, success, error
      FROM probe_samples
      WHERE edge_id = ? AND measured_at >= ?
      ORDER BY measured_at DESC
      LIMIT ?
    `);
    this.cleanupStatement = this.database.prepare("DELETE FROM probe_samples WHERE measured_at < ?");
    this.overviewStatement = this.database.prepare(`
      SELECT edge_id, COUNT(*) AS total, MAX(measured_at) AS last_seen
      FROM probe_samples
      GROUP BY edge_id
      ORDER BY edge_id
    `);
    this.invalidateEnrollmentsStatement = this.database.prepare(`
      UPDATE agent_enrollments SET used_at = ? WHERE agent_id = ? AND used_at IS NULL
    `);
    this.insertEnrollmentStatement = this.database.prepare(`
      INSERT INTO agent_enrollments(code_hash, agent_id, edge_id, rotate_existing, created_at, expires_at, used_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    this.findEnrollmentStatement = this.database.prepare(`
      SELECT code_hash, agent_id, edge_id, rotate_existing, expires_at
      FROM agent_enrollments
      WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?
    `);
    this.consumeEnrollmentStatement = this.database.prepare(`
      UPDATE agent_enrollments SET used_at = ? WHERE code_hash = ? AND used_at IS NULL
    `);
    this.cleanupEnrollmentsStatement = this.database.prepare(`
      DELETE FROM agent_enrollments WHERE expires_at < ?
    `);
  }

  ingest(agentId, samples) {
    if (!samples.length) return 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      let accepted = 0;
      for (const sample of samples) {
        const result = this.insertStatement.run(
          sample.edgeId,
          agentId,
          sample.measuredAt,
          sample.success ? sample.latencyMs : null,
          sample.success ? 1 : 0,
          sample.error || null,
        );
        accepted += Number(result.changes || 0);
      }
      this.database.exec("COMMIT");
      this.cleanupIfNeeded();
      return accepted;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getEdgeStats(edgeId, hours = 1, healthThresholds = {}) {
    const boundedHours = Math.min(168, Math.max(1, Number(hours) || 1));
    const since = this.now() - boundedHours * 60 * 60 * 1000;
    const rows = this.edgeRowsStatement.all(String(edgeId), since, MAX_QUERY_ROWS).reverse();
    return computeProbeStats(rows, healthThresholds);
  }

  getOverview() {
    return this.overviewStatement.all().map((row) => ({
      edgeId: String(row.edge_id),
      total: Number(row.total),
      lastSeen: row.last_seen ? new Date(Number(row.last_seen)).toISOString() : null,
    }));
  }

  createEnrollment(agentId, edgeId, { ttlMs = 15 * 60_000, rotateExisting = false } = {}) {
    const normalizedAgentId = validateIdentifier(agentId, "agent id");
    const normalizedEdgeId = validateIdentifier(edgeId, "edge id");
    const now = this.now();
    const expiresAt = now + Math.min(60 * 60_000, Math.max(60_000, Number(ttlMs) || 15 * 60_000));
    const code = randomBytes(32).toString("base64url");
    const hash = hashEnrollmentCode(code);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.invalidateEnrollmentsStatement.run(now, normalizedAgentId);
      this.insertEnrollmentStatement.run(
        hash,
        normalizedAgentId,
        normalizedEdgeId,
        rotateExisting ? 1 : 0,
        now,
        expiresAt,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { code, agentId: normalizedAgentId, edgeId: normalizedEdgeId, expiresAt };
  }

  consumeEnrollment(code) {
    const hash = hashEnrollmentCode(code);
    const now = this.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const enrollment = this.findEnrollmentStatement.get(hash, now);
      if (!enrollment) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const result = this.consumeEnrollmentStatement.run(now, hash);
      if (Number(result.changes || 0) !== 1) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.exec("COMMIT");
      return {
        agentId: String(enrollment.agent_id),
        edgeId: String(enrollment.edge_id),
        rotateExisting: Number(enrollment.rotate_existing) === 1,
        expiresAt: Number(enrollment.expires_at),
      };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  cleanupIfNeeded() {
    const now = this.now();
    if (now - this.lastCleanupAt < 6 * 60 * 60 * 1000) return;
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    this.cleanupStatement.run(cutoff);
    this.cleanupEnrollmentsStatement.run(now - 24 * 60 * 60 * 1000);
    this.lastCleanupAt = now;
  }

  close() {
    this.database.close();
  }
}
