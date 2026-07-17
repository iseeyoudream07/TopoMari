import { classifyHealth, resolveHealthThresholds } from "./health-status.mjs";
import { TopologyConfigStore } from "./topology-config-store.mjs";

const VIRTUAL_NODE_IDS = new Set(["client", "internet"]);
const NODE_ONLINE_THRESHOLD_MS =
  Math.max(60, Number(process.env.NODE_ONLINE_THRESHOLD_SECONDS || 600)) * 1000;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function firstValue(object, keys, fallback = "") {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  return fallback;
}

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;
}

function inferOnline(raw) {
  const explicit = firstValue(raw, ["online", "is_online", "connected"]);
  if (typeof explicit === "boolean") return explicit;
  if (typeof explicit === "number") return explicit > 0;
  const status = String(firstValue(raw, ["status", "state"], "")).toLowerCase();
  if (["online", "up", "connected", "active"].includes(status)) return true;
  if (["offline", "down", "disconnected", "inactive"].includes(status)) return false;

  const lastSeen = parseTimestamp(firstValue(raw, ["updated_at", "last_report", "last_seen", "last_online"]));
  if (lastSeen) return Date.now() - lastSeen < NODE_ONLINE_THRESHOLD_MS;
  return true;
}

export function normalizeNodeList(payload) {
  const candidates = payload?.nodes ?? payload?.clients ?? payload;
  return asArray(candidates)
    .map((raw) => {
      const id = String(firstValue(raw, ["uuid", "UUID", "id", "client_id", "node_id"], ""));
      if (!id) return null;
      const name = String(
        firstValue(raw, ["name", "client_name", "custom_name", "display_name", "remark"], id.slice(0, 8)),
      );
      return {
        id,
        name,
        region: String(firstValue(raw, ["region", "location", "country", "group"], "")),
        os: String(firstValue(raw, ["os", "system", "platform"], "")),
        online: inferOnline(raw),
      };
    })
    .filter(Boolean);
}

export function normalizePingTasks(payload) {
  const candidates = payload?.tasks ?? payload;
  return asArray(candidates)
    .map((task) => ({
      id: Number(task.id ?? task.task_id),
      name: String(task.name ?? ""),
      clients: asArray(task.clients).map(String),
      type: String(task.type ?? ""),
      interval: Number(task.interval ?? 0),
    }))
    .filter((task) => Number.isFinite(task.id));
}

export function resolveTask(edge, tasks) {
  if (edge.task_id !== undefined && edge.task_id !== null && edge.task_id !== "") {
    const id = Number(edge.task_id);
    return tasks.find((task) => task.id === id) ?? { id, name: `Task ${id}`, clients: [] };
  }
  if (edge.task_name) {
    return tasks.find((task) => task.name === edge.task_name) ?? null;
  }
  return null;
}

function recordTime(record) {
  return parseTimestamp(record?.time ?? record?.timestamp ?? record?.created_at) ?? 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeEdgeStats(payload, taskId = null, healthThresholds = {}) {
  const records = asArray(payload?.records)
    .map((record) => ({
      time: recordTime(record),
      value: numberOrNull(record?.value),
      taskId: Number(record?.task_id ?? taskId),
    }))
    .filter((record) => record.time > 0 && (taskId === null || record.taskId === Number(taskId)))
    .sort((a, b) => a.time - b.time);

  const summaries = asArray(payload?.tasks);
  const summary =
    summaries.find((item) => Number(item?.id ?? item?.task_id) === Number(taskId)) ?? summaries[0] ?? {};

  const valid = records.filter((record) => record.value !== null && record.value >= 0);
  const failures = records.filter((record) => record.value !== null && record.value < 0).length;
  const latestRecord = records.at(-1) ?? null;
  const latest = latestRecord?.value !== null && latestRecord?.value >= 0 ? latestRecord.value : null;
  const values = valid.map((record) => record.value);

  const avg = numberOrNull(summary.avg) ?? (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const min = numberOrNull(summary.min) ?? (values.length ? Math.min(...values) : null);
  const max = numberOrNull(summary.max) ?? (values.length ? Math.max(...values) : null);
  const loss =
    numberOrNull(summary.loss) ?? (records.length ? Math.round((failures / records.length) * 1000) / 10 : null);

  const status = classifyHealth(
    {
      hasData: records.length > 0,
      latestFailed: latestRecord?.value !== null && latestRecord?.value < 0,
      loss,
      avg,
    },
    healthThresholds,
  );

  return {
    latest: latest === null ? null : Math.round(latest * 10) / 10,
    avg: avg === null ? null : Math.round(avg * 10) / 10,
    min: min === null ? null : Math.round(min * 10) / 10,
    max: max === null ? null : Math.round(max * 10) / 10,
    loss: loss === null ? null : Math.round(loss * 10) / 10,
    total: Number(summary.total ?? records.length),
    status,
    updatedAt: latestRecord?.time ? new Date(latestRecord.time).toISOString() : null,
    history: records.slice(-60).map((record) => ({
      time: new Date(record.time).toISOString(),
      value: record.value !== null && record.value >= 0 ? record.value : null,
    })),
  };
}

export function combineEdgeStats(items, healthThresholds = {}) {
  const stats = items.filter(Boolean);
  const total = stats.reduce((sum, item) => sum + Number(item.total || 0), 0);
  if (!total) {
    return { latest: null, avg: null, min: null, max: null, loss: null, total: 0, status: "unknown", updatedAt: null, history: [] };
  }

  const latestValues = stats.map((item) => item.latest).filter((value) => value !== null && Number.isFinite(Number(value))).map(Number);
  const successfulWeights = stats.map((item) => {
    const itemTotal = Number(item.total || 0);
    const itemLoss = Number(item.loss || 0);
    return Math.max(0, itemTotal * (1 - itemLoss / 100));
  });
  const weightedAverageTotal = stats.reduce((sum, item, index) => {
    return item.avg === null ? sum : sum + Number(item.avg) * successfulWeights[index];
  }, 0);
  const successfulTotal = successfulWeights.reduce((sum, value) => sum + value, 0);
  const loss = stats.reduce((sum, item) => sum + Number(item.loss || 0) * Number(item.total || 0), 0) / total;
  const minimums = stats.map((item) => item.min).filter((value) => value !== null).map(Number);
  const maximums = stats.map((item) => item.max).filter((value) => value !== null).map(Number);
  const updatedTimes = stats.map((item) => Date.parse(item.updatedAt || "")).filter(Number.isFinite);

  const buckets = new Map();
  for (const item of stats) {
    for (const point of item.history || []) {
      const timestamp = Date.parse(point.time || "");
      if (!Number.isFinite(timestamp)) continue;
      const bucket = Math.floor(timestamp / 60_000) * 60_000;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      if (point.value !== null && Number.isFinite(Number(point.value))) buckets.get(bucket).push(Number(point.value));
    }
  }
  const history = [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(-60)
    .map(([timestamp, values]) => ({
      time: new Date(timestamp).toISOString(),
      value: values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null,
    }));

  const latest = latestValues.length ? latestValues.reduce((sum, value) => sum + value, 0) / latestValues.length : null;
  const avg = successfulTotal ? weightedAverageTotal / successfulTotal : null;
  const status = classifyHealth(
    { hasData: total > 0, latestFailed: !latestValues.length, loss, avg },
    healthThresholds,
  );

  return {
    latest: latest === null ? null : Math.round(latest * 10) / 10,
    avg: avg === null ? null : Math.round(avg * 10) / 10,
    min: minimums.length ? Math.min(...minimums) : null,
    max: maximums.length ? Math.max(...maximums) : null,
    loss: Math.round(loss * 10) / 10,
    total,
    status,
    updatedAt: updatedTimes.length ? new Date(Math.max(...updatedTimes)).toISOString() : null,
    history,
  };
}

export async function loadTopologyConfig(filePath) {
  return (await new TopologyConfigStore(filePath).read()).config;
}

function nodeDescriptor(item) {
  if (typeof item === "string") return { id: item };
  return { ...item, id: String(item.id) };
}

function virtualNode(descriptor) {
  if (descriptor.id === "client") {
    return {
      id: "client",
      name: descriptor.label || "Client (Local)",
      region: descriptor.region || "",
      type: descriptor.type || "client",
      online: true,
      virtual: true,
    };
  }
  return {
    id: "internet",
    name: descriptor.label || "Global Internet",
    region: descriptor.region || "",
    type: descriptor.type || "target",
    online: true,
    virtual: true,
  };
}

function hydrateNode(item, nodeMap) {
  const descriptor = nodeDescriptor(item);
  if (VIRTUAL_NODE_IDS.has(descriptor.id)) return virtualNode(descriptor);
  const live = nodeMap.get(descriptor.id);
  return {
    id: descriptor.id,
    name: descriptor.label || live?.name || descriptor.id.slice(0, 8),
    region: descriptor.region || live?.region || "",
    type: descriptor.type || "server",
    os: live?.os || "",
    online: live?.online ?? false,
    virtual: false,
  };
}

function overallSummary(routes, nodes) {
  const edges = routes.flatMap((route) => route.edges);
  const known = edges.filter((edge) => edge.stats.latest !== null);
  const averageLatency = known.length
    ? known.reduce((sum, edge) => sum + edge.stats.latest, 0) / known.length
    : null;
  const averageLossValues = edges.filter((edge) => edge.stats.loss !== null);
  const averageLoss = averageLossValues.length
    ? averageLossValues.reduce((sum, edge) => sum + edge.stats.loss, 0) / averageLossValues.length
    : null;
  return {
    routes: routes.length,
    edges: edges.length,
    nodes: nodes.length,
    onlineNodes: nodes.filter((node) => node.online).length,
    averageLatency: averageLatency === null ? null : Math.round(averageLatency * 10) / 10,
    averageLoss: averageLoss === null ? null : Math.round(averageLoss * 10) / 10,
  };
}

export async function buildLiveDashboard(client, config, { probeStore = null } = {}) {
  const hasPrivateProbes = config.routes.some((route) => route.edges.some((edge) => edge.probe_id));
  const hasKomariTasks = config.routes.some((route) =>
    route.edges.some((edge) =>
      !edge.probe_id && ((Array.isArray(edge.task_ids) && edge.task_ids.length) || edge.task_id !== undefined || edge.task_name),
    ),
  );
  const [nodePayload, taskPayload] = await Promise.all([
    client.getNodes(),
    hasKomariTasks ? client.getPingTasks() : Promise.resolve([]),
  ]);
  const liveNodes = normalizeNodeList(nodePayload);
  const tasks = normalizePingTasks(taskPayload);
  const nodeMap = new Map(liveNodes.map((node) => [node.id, node]));
  const recordCache = new Map();
  const allRecordCache = new Map();

  async function allKomariPingRecords(sourceUuid) {
    const key = `${sourceUuid}:all:${config.history_hours || 1}`;
    if (!allRecordCache.has(key)) {
      const request = typeof client.getAllPingRecords === "function"
        ? client.getAllPingRecords({ uuid: sourceUuid, hours: config.history_hours || 1 })
        : client.getPingRecords({ uuid: sourceUuid, taskId: null, hours: config.history_hours || 1, allTasks: true });
      allRecordCache.set(key, Promise.resolve(request));
    }
    return await allRecordCache.get(key);
  }

  async function komariTaskStats(sourceUuid, task, healthThresholds) {
    const thresholdKey = JSON.stringify(resolveHealthThresholds(healthThresholds));
    const key = `${sourceUuid}:${task.id}:${config.history_hours || 1}:${thresholdKey}`;
    if (!recordCache.has(key)) {
      recordCache.set(
        key,
        client
          .getPingRecords({ uuid: sourceUuid, taskId: task.id, hours: config.history_hours || 1 })
          .then((payload) => computeEdgeStats(payload, task.id, healthThresholds)),
      );
    }
    return await recordCache.get(key);
  }

  async function edgeStats(edge) {
    if (edge.probe_id) {
      if (!probeStore) {
        return {
          task: { id: `probe:${edge.probe_id}`, name: edge.probe_name || edge.probe_id, type: "private", clients: [] },
          stats: { latest: null, avg: null, min: null, max: null, loss: null, total: 0, status: "unconfigured", updatedAt: null, history: [] },
          error: "Private probe storage is unavailable",
        };
      }
      return {
        task: {
          id: `probe:${edge.probe_id}`,
          name: edge.probe_name || edge.probe_id,
          type: "private",
          clients: [String(edge.source_uuid || edge.from || "")],
        },
        stats: probeStore.getEdgeStats(edge.probe_id, config.history_hours || 1, edge.health_thresholds),
        error: null,
      };
    }
    if (Array.isArray(edge.task_ids) && edge.task_ids.length) {
      const taskIds = [...new Set(edge.task_ids.map(Number).filter(Number.isFinite))];
      const groupTasks = taskIds.map((id) => tasks.find((task) => task.id === id) || { id, name: `Task ${id}`, clients: [] });
      const sourceUuid = String(edge.source_uuid || edge.from || "");
      try {
        const payload = await allKomariPingRecords(sourceUuid);
        const groupStats = groupTasks.map((task) => computeEdgeStats(payload, task.id, edge.health_thresholds));
        return {
          task: {
            id: `group:${taskIds.join(",")}`,
            name: edge.task_group_name || `Komari aggregate (${taskIds.length} tasks)`,
            type: "komari-group",
            clients: [sourceUuid],
            tasks: groupTasks.map((task) => ({ id: task.id, name: task.name })),
          },
          stats: combineEdgeStats(groupStats, edge.health_thresholds),
          error: null,
        };
      } catch (error) {
        return {
          task: {
            id: `group:${taskIds.join(",")}`,
            name: edge.task_group_name || `Komari aggregate (${taskIds.length} tasks)`,
            type: "komari-group",
            clients: [sourceUuid],
          },
          stats: { latest: null, avg: null, min: null, max: null, loss: null, total: 0, status: "failed", updatedAt: null, history: [] },
          error: error.message,
        };
      }
    }
    const task = resolveTask(edge, tasks);
    if (!task) {
      return {
        task: null,
        stats: { latest: null, avg: null, min: null, max: null, loss: null, total: 0, status: "unconfigured", updatedAt: null, history: [] },
        error: `Task not found: ${edge.task_name || edge.task_id || "unspecified"}`,
      };
    }
    const sourceUuid = String(edge.source_uuid || edge.from || "");
    try {
      return { task, stats: await komariTaskStats(sourceUuid, task, edge.health_thresholds), error: null };
    } catch (error) {
      return {
        task,
        stats: { latest: null, avg: null, min: null, max: null, loss: null, total: 0, status: "failed", updatedAt: null, history: [] },
        error: error.message,
      };
    }
  }

  const routes = await Promise.all(
    config.routes.map(async (route) => {
      const nodes = route.nodes.map((item) => hydrateNode(item, nodeMap));
      const edges = await Promise.all(
        route.edges.map(async (edge) => ({ ...edge, ...(await edgeStats(edge)) })),
      );
      return { id: route.id, name: route.name || route.id, nodes, edges };
    }),
  );

  const usedIds = new Set(
    config.routes.flatMap((route) => route.nodes.map((item) => nodeDescriptor(item).id)).filter((id) => !VIRTUAL_NODE_IDS.has(id)),
  );
  const usedNodes = [...usedIds].map((id) => hydrateNode({ id }, nodeMap));

  return {
    meta: {
      mode: hasPrivateProbes ? "hybrid" : "live",
      siteName: config.site_name || "TopoMari",
      mainTitle: config.title || "TopoMari",
      title: config.title,
      subtitle: config.subtitle,
      refreshIntervalSeconds: Number(config.refresh_interval_seconds || 15),
      generatedAt: new Date().toISOString(),
    },
    summary: overallSummary(routes, usedNodes),
    routes,
    nodes: usedNodes,
    tasks,
  };
}

function demoHistory(base, phase, loss) {
  const now = Date.now();
  return Array.from({ length: 36 }, (_, index) => {
    const wave = Math.sin(index * 0.55 + phase) * Math.max(1, base * 0.055);
    const ripple = Math.cos(index * 0.21 + phase * 2) * Math.max(0.5, base * 0.025);
    const failed = loss > 0 && (index + Math.floor(phase * 10)) % Math.max(5, Math.round(100 / loss)) === 0;
    return {
      time: new Date(now - (35 - index) * 20_000).toISOString(),
      value: failed ? null : Math.max(0, Math.round((base + wave + ripple) * 10) / 10),
    };
  });
}

export function buildDemoDashboard(config) {
  const tick = Date.now() / 10_000;
  const nodeMap = new Map();
  const actualDescriptors = config.routes
    .flatMap((route) => route.nodes.map(nodeDescriptor))
    .filter((node) => !VIRTUAL_NODE_IDS.has(node.id));
  for (const descriptor of actualDescriptors) {
    if (!nodeMap.has(descriptor.id)) {
      const phase = descriptor.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) / 37;
      nodeMap.set(descriptor.id, {
        id: descriptor.id,
        name: descriptor.label || descriptor.id,
        region: descriptor.region || "",
        os: "Linux",
        online: true,
        cpu: Math.round((22 + Math.sin(tick + phase) * 10) * 10) / 10,
        memory: Math.round((48 + Math.cos(tick * 0.7 + phase) * 8) * 10) / 10,
      });
    }
  }

  const routes = config.routes.map((route, routeIndex) => {
    const nodes = route.nodes.map((item) => hydrateNode(item, nodeMap));
    const edges = route.edges.map((edge, edgeIndex) => {
      const base = Number(edge.demo_latency ?? 30);
      const configuredLoss = Number(edge.demo_loss ?? 0);
      const phase = routeIndex * 1.7 + edgeIndex * 0.8;
      const latest = Math.max(0, Math.round((base + Math.sin(tick + phase) * Math.max(0.6, base * 0.04)) * 10) / 10);
      const history = demoHistory(base, phase, configuredLoss);
      const values = history.filter((point) => point.value !== null).map((point) => point.value);
      const loss = Math.round(((history.length - values.length) / history.length) * 1000) / 10;
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      const status = classifyHealth({ hasData: true, loss, avg }, edge.health_thresholds);
      return {
        ...edge,
        task: {
          id: edge.probe_id ? `probe:${edge.probe_id}` : routeIndex * 10 + edgeIndex + 1,
          name: edge.probe_name || edge.probe_id || edge.task_group_name || edge.task_name,
          type: edge.probe_id ? "private" : Array.isArray(edge.task_ids) ? "komari-group" : "tcp",
          clients: [edge.source_uuid],
        },
        error: null,
        stats: {
          latest,
          avg: Math.round(avg * 10) / 10,
          min: Math.min(...values),
          max: Math.max(...values),
          loss,
          total: history.length,
          status,
          updatedAt: new Date().toISOString(),
          history,
        },
      };
    });
    return { id: route.id, name: route.name || route.id, nodes, edges };
  });

  const usedNodes = [...nodeMap.values()];
  return {
    meta: {
      mode: "demo",
      siteName: config.site_name || "TopoMari",
      mainTitle: config.title || "TopoMari",
      title: config.title,
      subtitle: config.subtitle,
      refreshIntervalSeconds: Number(config.refresh_interval_seconds || 15),
      generatedAt: new Date().toISOString(),
    },
    summary: overallSummary(routes, usedNodes),
    routes,
    nodes: usedNodes,
    tasks: routes.flatMap((route) => route.edges.map((edge) => edge.task)),
  };
}
