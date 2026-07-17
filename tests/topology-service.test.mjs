import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDemoDashboard,
  buildLiveDashboard,
  combineEdgeStats,
  computeEdgeStats,
  loadTopologyConfig,
  normalizeNodeList,
  normalizePingTasks,
  resolveTask,
} from "../lib/topology-service.mjs";

const configUrl = new URL("../config/topology.example.json", import.meta.url);

test("normalizes Komari node arrays and keyed objects", () => {
  const nodes = normalizeNodeList({
    a: { uuid: "node-a", name: "Tokyo", status: "online", ip: "203.0.113.10", secret: "upstream-secret" },
    b: { uuid: "node-b", client_name: "Seattle", status: "offline" },
  });
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].name, "Tokyo");
  assert.equal(nodes[0].online, true);
  assert.equal(nodes[1].online, false);
  assert.equal(Object.hasOwn(nodes[0], "raw"), false);
  assert.equal(JSON.stringify(nodes).includes("203.0.113.10"), false);
  assert.equal(JSON.stringify(nodes).includes("upstream-secret"), false);
});

test("allows Komari node timestamps to update several minutes apart", () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const elevenMinutesAgo = new Date(Date.now() - 11 * 60_000).toISOString();
  const nodes = normalizeNodeList([
    { uuid: "recent", name: "Recent", updated_at: fiveMinutesAgo },
    { uuid: "stale", name: "Stale", updated_at: elevenMinutesAgo },
  ]);
  assert.equal(nodes[0].online, true);
  assert.equal(nodes[1].online, false);
});

test("normalizes and resolves ping tasks by id or exact name", () => {
  const tasks = normalizePingTasks([
    { id: 7, name: "jp-to-us", clients: ["jp"], type: "tcp", interval: 20, target: "198.51.100.20" },
  ]);
  assert.equal(resolveTask({ task_id: 7 }, tasks).name, "jp-to-us");
  assert.equal(resolveTask({ task_name: "jp-to-us" }, tasks).id, 7);
  assert.equal(resolveTask({ task_name: "missing" }, tasks), null);
  assert.equal(Object.hasOwn(tasks[0], "raw"), false);
  assert.equal(JSON.stringify(tasks).includes("198.51.100.20"), false);
});

test("computes latest latency and packet loss from ping records", () => {
  const result = computeEdgeStats(
    {
      records: [
        { task_id: 3, time: "2026-07-15T10:00:00Z", value: 100 },
        { task_id: 3, time: "2026-07-15T10:00:20Z", value: -1 },
        { task_id: 3, time: "2026-07-15T10:00:40Z", value: 120 },
      ],
      tasks: [{ id: 3, avg: 110, min: 100, max: 120, loss: 33.3, total: 3 }],
    },
    3,
  );
  assert.equal(result.latest, 120);
  assert.equal(result.avg, 110);
  assert.equal(result.loss, 33.3);
  assert.equal(result.status, "degraded");
  assert.equal(result.history.length, 3);
  assert.equal(result.history[1].value, null);
});

test("keeps absent Komari statistics unknown instead of coercing them to zero", () => {
  const result = computeEdgeStats({ records: [], tasks: [{ id: 5, avg: null, loss: null }] }, 5);
  assert.equal(result.latest, null);
  assert.equal(result.avg, null);
  assert.equal(result.loss, null);
  assert.equal(result.status, "unknown");
});

test("supports per-edge health threshold overrides", () => {
  const result = computeEdgeStats(
    {
      records: [{ task_id: 8, time: "2026-07-15T10:00:00Z", value: 180 }],
      tasks: [{ id: 8, avg: 180, min: 180, max: 180, loss: 0, total: 1 }],
    },
    8,
    {
      warning_latency_ms: 250,
      degraded_latency_ms: 400,
      warning_loss_percent: 2,
      degraded_loss_percent: 25,
    },
  );
  assert.equal(result.status, "healthy");
});

test("combines multiple Komari carrier tasks into one mainland estimate", () => {
  const result = combineEdgeStats([
    {
      latest: 60,
      avg: 58,
      min: 50,
      max: 70,
      loss: 0,
      total: 10,
      updatedAt: "2026-07-16T01:00:00Z",
      history: [{ time: "2026-07-16T01:00:00Z", value: 60 }],
    },
    {
      latest: 80,
      avg: 78,
      min: 70,
      max: 90,
      loss: 10,
      total: 10,
      updatedAt: "2026-07-16T01:00:00Z",
      history: [{ time: "2026-07-16T01:00:00Z", value: 80 }],
    },
  ]);
  assert.equal(result.latest, 70);
  assert.equal(result.loss, 5);
  assert.equal(result.total, 20);
  assert.equal(result.history[0].value, 70);
});

test("builds a complete demo dashboard from the shipped topology", async () => {
  const config = await loadTopologyConfig(configUrl);
  const dashboard = buildDemoDashboard(config);
  assert.equal(dashboard.meta.mode, "demo");
  assert.equal(dashboard.meta.siteName, "TopoMari");
  assert.equal(dashboard.meta.mainTitle, "TopoMari");
  assert.equal(dashboard.routes.length, 2);
  assert.equal(dashboard.summary.edges, 6);
  assert.ok(dashboard.routes.every((route) => route.edges.length === route.nodes.length - 1));
  assert.ok(dashboard.routes.flatMap((route) => route.edges).every((edge) => edge.stats.history.length > 10));
});

test("builds a live dashboard through the Komari client contract", async () => {
  const config = {
    title: "Test",
    refresh_interval_seconds: 10,
    history_hours: 1,
    routes: [
      {
        id: "one",
        name: "One",
        nodes: [
          { id: "client", label: "Client", type: "client" },
          { id: "source-uuid", label: "Source", type: "server" },
        ],
        edges: [
          { from: "client", to: "source-uuid", source_uuid: "source-uuid", task_name: "edge-task" },
        ],
      },
    ],
  };
  const fakeClient = {
    async getNodes() {
      return [{ uuid: "source-uuid", name: "Source node", status: "online", ip: "203.0.113.50" }];
    },
    async getPingTasks() {
      return [
        {
          id: 9,
          name: "edge-task",
          clients: ["source-uuid"],
          type: "tcp",
          interval: 20,
          target: "198.51.100.80",
        },
      ];
    },
    async getPingRecords() {
      return {
        records: [{ task_id: 9, time: "2026-07-15T10:00:00Z", value: 42 }],
        tasks: [{ id: 9, avg: 42, min: 42, max: 42, loss: 0, total: 1 }],
      };
    },
  };
  const dashboard = await buildLiveDashboard(fakeClient, config);
  assert.equal(dashboard.meta.mode, "live");
  assert.equal(dashboard.routes[0].edges[0].stats.latest, 42);
  assert.equal(dashboard.routes[0].nodes[1].name, "Source");
  assert.equal(dashboard.summary.onlineNodes, 1);
  assert.equal(JSON.stringify(dashboard).includes("203.0.113.50"), false);
  assert.equal(JSON.stringify(dashboard).includes("198.51.100.80"), false);
});

test("loads all Komari ping records once for a multi-carrier edge", async () => {
  let allRecordRequests = 0;
  const config = {
    title: "Carrier aggregate",
    history_hours: 1,
    routes: [
      {
        id: "mainland",
        nodes: [
          { id: "client", label: "Client network", type: "client" },
          { id: "source", label: "Source", type: "server" },
        ],
        edges: [
          {
            from: "client",
            to: "source",
            source_uuid: "source",
            task_ids: [1, 2],
            task_group_name: "Two carriers",
          },
        ],
      },
    ],
  };
  const fakeClient = {
    async getNodes() {
      return [{ uuid: "source", name: "Source", status: "online" }];
    },
    async getPingTasks() {
      return [
        { id: 1, name: "Carrier A", clients: ["source"] },
        { id: 2, name: "Carrier B", clients: ["source"] },
      ];
    },
    async getAllPingRecords() {
      allRecordRequests += 1;
      return {
        records: [
          { task_id: 1, time: "2026-07-16T01:00:00Z", value: 60 },
          { task_id: 2, time: "2026-07-16T01:00:00Z", value: 80 },
        ],
      };
    },
  };
  const dashboard = await buildLiveDashboard(fakeClient, config);
  assert.equal(allRecordRequests, 1);
  assert.equal(dashboard.routes[0].edges[0].stats.latest, 70);
});
