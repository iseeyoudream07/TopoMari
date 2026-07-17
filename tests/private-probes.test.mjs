import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRegistry, hashAgentToken, writeAgentConfig } from "../lib/agent-registry.mjs";
import { normalizeProbePayload, ProbeRateLimiter } from "../lib/probe-ingest.mjs";
import { computeProbeStats, ProbeStore } from "../lib/probe-store.mjs";
import { buildLiveDashboard } from "../lib/topology-service.mjs";

test("stores private probe samples in SQLite and computes loss", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-probes-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const now = Date.parse("2026-07-15T12:00:00Z");
  const store = new ProbeStore({ filePath: join(directory, "probes.db"), now: () => now });
  context.after(() => store.close());

  store.ingest("relay-agent", [
    { edgeId: "relay-to-exit", measuredAt: now - 60_000, success: true, latencyMs: 10, error: "" },
    { edgeId: "relay-to-exit", measuredAt: now - 30_000, success: false, latencyMs: null, error: "timeout" },
    { edgeId: "relay-to-exit", measuredAt: now, success: true, latencyMs: 12, error: "" },
  ]);

  const stats = store.getEdgeStats("relay-to-exit", 1);
  assert.equal(stats.latest, 12);
  assert.equal(stats.avg, 11);
  assert.equal(stats.loss, 33.3);
  assert.equal(stats.status, "degraded");
  assert.equal(stats.history[1].value, null);
});

test("applies custom health thresholds to private probes", () => {
  const rows = [
    { measured_at: Date.parse("2026-07-15T12:00:00Z"), success: 1, latency_ms: 180 },
  ];
  const stats = computeProbeStats(rows, {
    warning_latency_ms: 250,
    degraded_latency_ms: 400,
    warning_loss_percent: 2,
    degraded_loss_percent: 25,
  });
  assert.equal(stats.status, "healthy");
});

test("authenticates hashed agent tokens and enforces allowed edges", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-agents-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "agents.json");
  await writeAgentConfig(filePath, {
    version: 1,
    agents: [
      {
        id: "relay-agent",
        token_hash: hashAgentToken("secret-token"),
        allowed_edges: ["relay-to-exit"],
        enabled: true,
      },
    ],
  });
  const registry = new AgentRegistry(filePath, { reloadIntervalMs: 0 });
  assert.equal((await registry.authenticate("relay-agent", "secret-token")).id, "relay-agent");
  assert.equal(await registry.authenticate("relay-agent", "wrong-token"), null);
});

test("mirrors and restores the Agent registry without rotating tokens", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-agent-backup-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "agents.json");
  const backupPath = join(directory, "data", "agents.backup.json");
  const registry = new AgentRegistry(filePath, { backupPath, reloadIntervalMs: 0, logger: null });
  const issued = await registry.issueToken("relay-agent", ["relay-to-exit"]);

  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backup.agents[0].token_hash, hashAgentToken(issued.token));
  await rm(filePath);

  const recovered = new AgentRegistry(filePath, { backupPath, reloadIntervalMs: 0, logger: null });
  assert.equal((await recovered.authenticate("relay-agent", issued.token)).id, "relay-agent");
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).agents[0].id, "relay-agent");
  const status = await recovered.status();
  assert.equal(status.protectedByBackup, true);
  assert.equal(status.agentCount, 1);
  assert.equal(status.recoveryCount, 1);
  assert.match(status.recoveredAt, /^\d{4}-\d{2}-\d{2}T/);

  await rm(filePath);
  assert.equal((await recovered.setEnabled("relay-agent", false)).enabled, false);
  const mutatedBackup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(mutatedBackup.agents.length, 1);
  assert.equal(mutatedBackup.agents[0].token_hash, hashAgentToken(issued.token));
});

test("restores an Agent registry when its backup appears after an earlier reload", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-agent-late-backup-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "agents.json");
  const backupPath = join(directory, "data", "agents.backup.json");
  const registry = new AgentRegistry(filePath, { backupPath, reloadIntervalMs: 0, logger: null });

  assert.deepEqual(await registry.list(), []);
  await writeAgentConfig(backupPath, {
    version: 1,
    agents: [
      {
        id: "late-agent",
        token_hash: hashAgentToken("late-token"),
        allowed_edges: ["late-edge"],
        enabled: true,
      },
    ],
  });

  assert.equal((await registry.authenticate("late-agent", "late-token")).id, "late-agent");
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).agents[0].id, "late-agent");
  assert.equal((await registry.status()).recoveryCount, 1);
});

test("validates probe payloads and rate limits noisy agents", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  const samples = normalizeProbePayload(
    { edge_id: "relay-to-exit", success: true, latency_ms: 8.27, timestamp: now },
    now,
  );
  assert.deepEqual(samples[0], {
    edgeId: "relay-to-exit",
    success: true,
    latencyMs: 8.3,
    measuredAt: now,
    error: "",
  });

  const limiter = new ProbeRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.allow("relay", now), true);
  assert.equal(limiter.allow("relay", now + 1), true);
  assert.equal(limiter.allow("relay", now + 2), false);
  assert.equal(limiter.allow("relay", now + 1001), true);
});

test("builds a hybrid dashboard without requesting Komari ping tasks", async () => {
  const config = {
    title: "Hybrid",
    history_hours: 1,
    routes: [
      {
        id: "private",
        nodes: [
          { id: "source", label: "Source", type: "server" },
          { id: "target", label: "Target", type: "server" },
        ],
        edges: [
          {
            from: "source",
            to: "target",
            source_uuid: "source",
            probe_id: "source-to-target",
            health_thresholds: {
              warning_latency_ms: 250,
              degraded_latency_ms: 400,
              warning_loss_percent: 2,
              degraded_loss_percent: 25,
            },
          },
        ],
      },
    ],
  };
  const fakeClient = {
    async getNodes() {
      return [
        { uuid: "source", name: "Source", status: "online" },
        { uuid: "target", name: "Target", status: "online" },
      ];
    },
    async getPingTasks() {
      throw new Error("private-only topology should not request Komari ping tasks");
    },
  };
  const probeStore = {
    getEdgeStats(edgeId, hours, healthThresholds) {
      assert.equal(edgeId, "source-to-target");
      assert.equal(hours, 1);
      assert.equal(healthThresholds.warning_latency_ms, 250);
      return {
        latest: 15,
        avg: 14,
        min: 12,
        max: 16,
        loss: 0,
        total: 4,
        status: "healthy",
        updatedAt: "2026-07-15T12:00:00Z",
        history: [],
      };
    },
  };
  const dashboard = await buildLiveDashboard(fakeClient, config, { probeStore });
  assert.equal(dashboard.meta.mode, "hybrid");
  assert.equal(dashboard.routes[0].edges[0].task.type, "private");
  assert.equal(dashboard.routes[0].edges[0].stats.latest, 15);
});
