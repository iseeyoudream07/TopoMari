import { resolveHealthThresholds } from "./health-status.mjs";
import { validateIdentifier } from "./agent-registry.mjs";

const MAX_ROUTES = 64;
const MAX_NODES_PER_ROUTE = 12;
const MAX_TEXT_LENGTH = 160;
const HEALTH_KEYS = [
  "warning_latency_ms",
  "degraded_latency_ms",
  "warning_loss_percent",
  "degraded_loss_percent",
];

function text(value, fallback = "", maximum = MAX_TEXT_LENGTH) {
  return String(value ?? fallback).trim().slice(0, maximum);
}

function finiteNumber(value, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function optionalIdentifier(value, label) {
  const normalized = text(value);
  return normalized ? validateIdentifier(normalized, label) : "";
}

function sanitizeNode(value) {
  const source = typeof value === "string" ? { id: value } : value || {};
  const node = {
    id: validateIdentifier(source.id, "node id"),
  };
  const label = text(source.label);
  const type = text(source.type, "server", 32);
  const region = text(source.region);
  if (label) node.label = label;
  if (type) node.type = type;
  if (region) node.region = region;
  return node;
}

function sanitizeThresholds(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("health_thresholds must be an object");
  }
  const thresholds = {};
  for (const key of HEALTH_KEYS) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
      thresholds[key] = Number(value[key]);
    }
  }
  resolveHealthThresholds(thresholds);
  return Object.keys(thresholds).length ? thresholds : undefined;
}

function sanitizeEdge(value) {
  const source = value || {};
  const edge = {
    from: validateIdentifier(source.from, "edge from"),
    to: validateIdentifier(source.to, "edge to"),
  };

  const sourceUuid = optionalIdentifier(source.source_uuid, "source uuid");
  const probeId = optionalIdentifier(source.probe_id, "probe id");
  const agentId = optionalIdentifier(source.agent_id, "agent id");
  const probeName = text(source.probe_name);
  const taskName = text(source.task_name);
  const taskGroupName = text(source.task_group_name);
  const direction = text(source.measurement_direction, "", 16);
  const taskIds = Array.isArray(source.task_ids)
    ? [...new Set(source.task_ids.map(Number).filter((item) => Number.isInteger(item) && item >= 0))].slice(0, 64)
    : [];
  const taskId = source.task_id === undefined || source.task_id === null || source.task_id === ""
    ? null
    : Number(source.task_id);

  if (sourceUuid) edge.source_uuid = sourceUuid;
  if (probeId) edge.probe_id = probeId;
  if (agentId) edge.agent_id = agentId;
  if (probeName) edge.probe_name = probeName;
  if (taskIds.length) edge.task_ids = taskIds;
  if (Number.isInteger(taskId) && taskId >= 0) edge.task_id = taskId;
  if (taskName) edge.task_name = taskName;
  if (taskGroupName) edge.task_group_name = taskGroupName;
  if (direction) edge.measurement_direction = direction;

  if (source.demo_latency !== undefined) {
    edge.demo_latency = finiteNumber(source.demo_latency, 30, { maximum: 60_000 });
  }
  if (source.demo_loss !== undefined) {
    edge.demo_loss = finiteNumber(source.demo_loss, 0, { maximum: 100 });
  }
  const thresholds = sanitizeThresholds(source.health_thresholds);
  if (thresholds) edge.health_thresholds = thresholds;
  return edge;
}

function sanitizeRoute(value) {
  const source = value || {};
  const id = validateIdentifier(source.id, "route id");
  const nodes = Array.isArray(source.nodes) ? source.nodes.map(sanitizeNode) : [];
  const edges = Array.isArray(source.edges) ? source.edges.map(sanitizeEdge) : [];
  return {
    id,
    name: text(source.name, id),
    nodes,
    edges,
  };
}

export function sanitizeTopologyConfig(value) {
  const source = value || {};
  const routes = Array.isArray(source.routes) ? source.routes.map(sanitizeRoute) : [];
  const config = {
    title: text(source.title, "TopoMari"),
    subtitle: text(source.subtitle, "Multi-hop latency and packet-loss visibility"),
    refresh_interval_seconds: Math.round(
      finiteNumber(source.refresh_interval_seconds, 15, { minimum: 5, maximum: 3600 }),
    ),
    history_hours: finiteNumber(source.history_hours, 1, { minimum: 1, maximum: 168 }),
    routes,
  };
  validateTopologyConfig(config);
  return config;
}

export function validateTopologyConfig(config) {
  if (!Array.isArray(config?.routes) || !config.routes.length) {
    throw new Error("topology must contain at least one route");
  }
  if (config.routes.length > MAX_ROUTES) {
    throw new Error(`topology cannot contain more than ${MAX_ROUTES} routes`);
  }

  const routeIds = new Set();
  const probeIds = new Set();
  for (const route of config.routes) {
    if (routeIds.has(route.id)) throw new Error(`Duplicate route id: ${route.id}`);
    routeIds.add(route.id);
    if (!Array.isArray(route.nodes) || route.nodes.length < 2 || route.nodes.length > MAX_NODES_PER_ROUTE) {
      throw new Error(`Route ${route.id} needs between 2 and ${MAX_NODES_PER_ROUTE} nodes`);
    }
    if (!Array.isArray(route.edges) || route.edges.length !== route.nodes.length - 1) {
      throw new Error(`Route ${route.id} must have exactly nodes.length - 1 edges`);
    }
    const nodeIds = route.nodes.map((node) => node.id);
    if (new Set(nodeIds).size !== nodeIds.length) throw new Error(`Route ${route.id} contains duplicate nodes`);

    route.edges.forEach((edge, index) => {
      const expectedFrom = nodeIds[index];
      const expectedTo = nodeIds[index + 1];
      if (edge.from !== expectedFrom || edge.to !== expectedTo) {
        throw new Error(`Route ${route.id} edge ${index + 1} must connect ${expectedFrom} to ${expectedTo}`);
      }
      const hasTaskGroup = Array.isArray(edge.task_ids) && edge.task_ids.length > 0;
      const hasTask = edge.task_id !== undefined || Boolean(edge.task_name) || hasTaskGroup;
      if (!edge.probe_id && !hasTask) {
        throw new Error(`Route ${route.id} edge ${index + 1} needs a private probe or Komari task`);
      }
      if (edge.probe_id) {
        if (probeIds.has(edge.probe_id)) throw new Error(`Duplicate probe id: ${edge.probe_id}`);
        probeIds.add(edge.probe_id);
      }
      if (edge.measurement_direction && !["forward", "reverse"].includes(edge.measurement_direction)) {
        throw new Error(`Route ${route.id} edge ${index + 1} has an invalid measurement direction`);
      }
      resolveHealthThresholds(edge.health_thresholds);
    });
  }
  return config;
}
