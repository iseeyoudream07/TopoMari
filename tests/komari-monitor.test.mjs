import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDemoKomariOverview,
  buildKomariOverview,
  normalizeKomariMonitorNodes,
  normalizeKomariRecentReport,
} from "../lib/komari-monitor.mjs";

test("normalizes a safe Komari monitor inventory and excludes hidden nodes", () => {
  const nodes = normalizeKomariMonitorNodes([
    {
      uuid: "public-node",
      name: "Tokyo",
      region: "Tokyo",
      os: "Linux",
      arch: "amd64",
      online: true,
      cpu_cores: 4,
      mem_total: 2_147_483_648,
      disk_total: 42_949_672_960,
      traffic_limit: 1_099_511_627_776,
      ipv4: "sentinel-ip",
      token: "sentinel-token",
      remark: "sentinel-remark",
      raw: { secret: "sentinel-secret" },
    },
    { uuid: "hidden-node", name: "Hidden", hidden: true, token: "hidden-token" },
  ], new Map([["public-node", { countryCode: "JP", countryName: "Japan", ip: "sentinel-location-ip" }]]));

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "public-node");
  assert.equal(nodes[0].status, "online");
  assert.equal(nodes[0].countryCode, "JP");
  const serialized = JSON.stringify(nodes);
  for (const secret of ["sentinel-ip", "sentinel-token", "sentinel-remark", "sentinel-secret", "hidden-token", "sentinel-location-ip"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("normalizes the latest nested Komari v1 report while preserving zero values", () => {
  const report = normalizeKomariRecentReport([
    { updated_at: "2026-07-23T01:00:00Z", cpu: { usage: 90 } },
    {
      updated_at: "2026-07-23T02:00:00Z",
      uptime: 86_400,
      cpu: { usage: 0 },
      ram: { used: 0, total: 1024 },
      disk: { used: 512, total: 2048 },
      network: { up: 0, down: 2048, totalUp: 100, totalDown: 300 },
      load: { load1: 0, load5: 0.2, load15: 0.3 },
      ipv4: "sentinel-report-ip",
      token: "sentinel-report-token",
    },
  ], { cpuCores: 2, trafficLimit: 1_000 });

  assert.equal(report.cpu.usagePercent, 0);
  assert.equal(report.memory.usagePercent, 0);
  assert.equal(report.disk.usagePercent, 25);
  assert.equal(report.network.uploadBytesPerSecond, 0);
  assert.equal(report.traffic.usedBytes, 400);
  assert.equal(report.traffic.usagePercent, 40);
  assert.equal(report.load.one, 0);
  assert.equal(JSON.stringify(report).includes("sentinel-report"), false);
});

test("builds a partial overview when one node report is unavailable", async () => {
  const requested = [];
  const overview = await buildKomariOverview({
    nodePayload: [
      { uuid: "node-a", name: "A", status: "online", mem_total: 100, disk_total: 200 },
      { uuid: "node-b", name: "B", status: "offline", mem_total: 100, disk_total: 200 },
    ],
    client: {
      async getRecentNodeReports(id) {
        requested.push(id);
        if (id === "node-b") throw new Error("sentinel-upstream-error");
        return [{
          updated_at: "2026-07-23T02:00:00Z",
          cpu: { usage: 12.5 },
          ram: { used: 25, total: 100 },
          disk: { used: 50, total: 200 },
          network: { up: 1, down: 2, totalUp: 3, totalDown: 4 },
          load: { load1: 0.1, load5: 0.2, load15: 0.3 },
        }];
      },
    },
    concurrency: 2,
  });

  assert.deepEqual(requested.sort(), ["node-a", "node-b"]);
  assert.equal(overview.state, "partial");
  assert.deepEqual(overview.summary, { total: 2, online: 1, offline: 1, unknown: 0 });
  assert.equal(overview.nodes[0].telemetryAvailable, true);
  assert.equal(overview.nodes[1].telemetryAvailable, false);
  assert.equal(JSON.stringify(overview).includes("sentinel-upstream-error"), false);
});

test("infers online state from recent reports instead of assuming public nodes are online", async () => {
  const now = Date.parse("2026-07-23T02:05:00Z");
  const overview = await buildKomariOverview({
    nodePayload: [
      { uuid: "recent", name: "Recent" },
      { uuid: "stale", name: "Stale" },
      { uuid: "missing", name: "Missing" },
    ],
    client: {
      async getRecentNodeReports(id) {
        if (id === "missing") return [];
        return [{
          updated_at: id === "recent" ? "2026-07-23T02:00:00Z" : "2026-07-23T01:00:00Z",
          cpu: { usage: 1 },
        }];
      },
    },
    now,
  });
  assert.deepEqual(overview.nodes.map((node) => node.status), ["online", "offline", "unknown"]);
  assert.deepEqual(overview.summary, { total: 3, online: 1, offline: 1, unknown: 1 });
});

test("builds deterministic, populated demo monitor cards", () => {
  const overview = buildDemoKomariOverview([
    { id: "one", name: "One", region: "Tokyo", online: true },
    { id: "one", name: "Duplicate", online: true },
  ], Date.parse("2026-07-23T02:00:00Z"));
  assert.equal(overview.state, "ready");
  assert.equal(overview.nodes.length, 1);
  assert.equal(overview.nodes[0].telemetryAvailable, true);
  assert.ok(overview.nodes[0].memory.usagePercent > 0);
});
