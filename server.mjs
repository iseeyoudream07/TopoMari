import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { KomariClient, KomariError } from "./lib/komari-client.mjs";
import { AgentRegistry } from "./lib/agent-registry.mjs";
import { ProbeRateLimiter, ProbeValidationError, normalizeProbePayload } from "./lib/probe-ingest.mjs";
import { ProbeStore } from "./lib/probe-store.mjs";
import { isDiagnosticApiPath, validateDashboardAuthConfig } from "./lib/security-policy.mjs";
import { TopologyConfigStore } from "./lib/topology-config-store.mjs";
import {
  buildDemoDashboard,
  buildLiveDashboard,
  computeEdgeStats,
  loadTopologyConfig,
  normalizeNodeList,
  normalizePingTasks,
} from "./lib/topology-service.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(rootDir, "public");
const configPath = resolve(rootDir, process.env.TOPOLOGY_CONFIG_PATH || "config/topology.json");
const agentConfigPath = resolve(rootDir, process.env.AGENT_CONFIG_PATH || "config/agents.json");
const agentBackupPath = resolve(rootDir, process.env.AGENT_BACKUP_PATH || "data/agents.backup.json");
const probeDatabasePath = resolve(rootDir, process.env.PROBE_DB_PATH || "data/probes.db");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const cacheTtlMs = Math.max(1, Number(process.env.CACHE_TTL_SECONDS || 8)) * 1000;
const basicUser = process.env.DASHBOARD_USER || "";
const basicPassword = process.env.DASHBOARD_PASSWORD || "";
const maxIngestBodyBytes = Math.max(1024, Number(process.env.MAX_INGEST_BODY_BYTES || 32_768));
const maxEditorBodyBytes = Math.max(16_384, Number(process.env.MAX_EDITOR_BODY_BYTES || 131_072));
const diagnosticApiEnabled = envFlag("ENABLE_DIAGNOSTIC_API");
const allowUnauthenticatedDashboard = envFlag("ALLOW_UNAUTHENTICATED_DASHBOARD");

const client = new KomariClient({
  baseUrl: process.env.KOMARI_BASE_URL || "",
  cookie: process.env.KOMARI_COOKIE || "",
  authorization: process.env.KOMARI_AUTHORIZATION || "",
  timeoutMs: Number(process.env.KOMARI_TIMEOUT_MS || 8000),
});
const forceDemo = envFlag("DEMO_MODE");
const demoMode = forceDemo || !client.configured;
const basicAuthConfigured = validateDashboardAuthConfig({
  user: basicUser,
  password: basicPassword,
  demoMode,
  allowUnauthenticated: allowUnauthenticatedDashboard,
});
if (!basicAuthConfigured) {
  console.warn(
    demoMode
      ? "Dashboard Basic Auth is disabled in demo mode."
      : "Dashboard Basic Auth is disabled by explicit ALLOW_UNAUTHENTICATED_DASHBOARD override.",
  );
}
const topologyEditorRequested = envFlag("ENABLE_TOPOLOGY_EDITOR");
const topologyEditorEnabled = topologyEditorRequested && basicAuthConfigured;
if (topologyEditorRequested && !topologyEditorEnabled) {
  console.warn("Topology editor was disabled because dashboard Basic Auth is not configured.");
}

const probeStore = new ProbeStore({
  filePath: probeDatabasePath,
  retentionDays: Number(process.env.PROBE_RETENTION_DAYS || 7),
});
const agentRegistry = new AgentRegistry(agentConfigPath, { backupPath: agentBackupPath });
const topologyConfigStore = new TopologyConfigStore(configPath);
const ingestRateLimiter = new ProbeRateLimiter({
  limit: Number(process.env.INGEST_RATE_LIMIT_PER_MINUTE || 120),
});
const enrollmentRateLimiter = new ProbeRateLimiter({
  limit: Number(process.env.ENROLL_RATE_LIMIT_PER_MINUTE || 20),
});
const editorCsrfToken = randomBytes(32).toString("base64url");

// Create the redundant registry copy before serving requests. If an upgrade
// accidentally drops config/agents.json while data/ survives, reload restores
// the exact token hashes and edge permissions from this copy automatically.
await agentRegistry.reload(true);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".py": "text/x-python; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
};

let dashboardCache = { expiresAt: 0, value: null, promise: null };

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireBasicAuth(request, response) {
  if (!basicAuthConfigured) return true;
  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="TopoMari"' });
    response.end("Authentication required");
    return false;
  }
  let credentials = "";
  try {
    credentials = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    credentials = "";
  }
  const separatorIndex = credentials.indexOf(":");
  const user = separatorIndex >= 0 ? credentials.slice(0, separatorIndex) : credentials;
  const password = separatorIndex >= 0 ? credentials.slice(separatorIndex + 1) : "";
  if (!secureEqual(user, basicUser) || !secureEqual(password, basicPassword)) {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="TopoMari"' });
    response.end("Invalid credentials");
    return false;
  }
  return true;
}

function json(response, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

async function getDashboard() {
  if (dashboardCache.value && dashboardCache.expiresAt > Date.now()) {
    return dashboardCache.value;
  }
  if (dashboardCache.promise) return dashboardCache.promise;

  dashboardCache.promise = (async () => {
    const config = await loadTopologyConfig(configPath);
    const dashboard = demoMode
      ? buildDemoDashboard(config)
      : await buildLiveDashboard(client, config, { probeStore });
    dashboardCache = { value: dashboard, expiresAt: Date.now() + cacheTtlMs, promise: null };
    return dashboard;
  })().catch((error) => {
    dashboardCache.promise = null;
    throw error;
  });
  return dashboardCache.promise;
}

function methodNotAllowed(response, methods) {
  return json(response, 405, { error: `Method must be ${methods.join(" or ")}` }, { Allow: methods.join(", ") });
}

function requireJsonContent(request, response) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (contentType.startsWith("application/json")) return true;
  json(response, 415, { error: "Content-Type must be application/json" });
  return false;
}

function requireEditorCsrf(request, response) {
  const presented = String(request.headers["x-topology-csrf"] || "");
  if (presented && secureEqual(presented, editorCsrfToken)) return true;
  json(response, 403, { error: "Invalid or missing topology editor CSRF token" });
  return false;
}

function makeClientError(error, fallbackStatus = 400) {
  if (!error.status) error.status = fallbackStatus;
  return error;
}

async function editorInventory() {
  if (demoMode) {
    const dashboard = await getDashboard();
    return { nodes: dashboard.nodes || [], tasks: dashboard.tasks || [] };
  }
  const [nodes, tasks] = await Promise.all([
    client.getNodes().then(normalizeNodeList),
    client.getPingTasks().then(normalizePingTasks),
  ]);
  return { nodes, tasks };
}

async function handleEditorApi(request, response, url) {
  if (!topologyEditorEnabled) return json(response, 404, { error: "Topology editor is disabled" });

  if (url.pathname === "/api/editor/bootstrap") {
    if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
    const [{ config, revision }, inventory, agents] = await Promise.all([
      topologyConfigStore.read(),
      editorInventory(),
      agentRegistry.list(),
    ]);
    return json(response, 200, {
      enabled: true,
      csrfToken: editorCsrfToken,
      revision,
      config,
      nodes: inventory.nodes,
      tasks: inventory.tasks,
      agents,
      agentRegistry: await agentRegistry.status(),
      probeEdges: probeStore.getOverview(),
    });
  }

  if (!requireEditorCsrf(request, response)) return;
  if (!requireJsonContent(request, response)) return;

  if (url.pathname === "/api/editor/topology") {
    if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]);
    try {
      const body = await readJsonBody(request, maxEditorBodyBytes);
      const result = await topologyConfigStore.write(body.config, String(body.revision || ""));
      dashboardCache = { expiresAt: 0, value: null, promise: null };
      return json(response, 200, result);
    } catch (error) {
      throw makeClientError(error);
    }
  }

  if (url.pathname === "/api/editor/enrollments") {
    if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
    try {
      const body = await readJsonBody(request, maxEditorBodyBytes);
      const agentId = String(body.agentId || "").trim();
      const edgeId = String(body.edgeId || "").trim();
      const rotateExisting = body.rotateExisting === true;
      const { config } = await topologyConfigStore.read();
      const edge = config.routes.flatMap((route) => route.edges).find((item) => item.probe_id === edgeId);
      if (!edge) {
        const error = new Error(`Private probe edge ${edgeId || "(empty)"} was not found in the saved topology`);
        error.status = 404;
        throw error;
      }
      if (edge.agent_id && edge.agent_id !== agentId) {
        throw new Error(`Edge ${edgeId} is assigned to agent ${edge.agent_id}`);
      }
      const existing = await agentRegistry.get(agentId);
      if (existing && !rotateExisting) {
        const error = new Error(`Agent ${agentId} already exists. Confirm token rotation to continue.`);
        error.status = 409;
        throw error;
      }
      const enrollment = probeStore.createEnrollment(agentId, edgeId, { rotateExisting });
      return json(response, 201, {
        code: enrollment.code,
        agentId: enrollment.agentId,
        edgeId: enrollment.edgeId,
        expiresAt: new Date(enrollment.expiresAt).toISOString(),
      });
    } catch (error) {
      throw makeClientError(error);
    }
  }

  if (url.pathname === "/api/editor/agents/action") {
    if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
    try {
      const body = await readJsonBody(request, maxEditorBodyBytes);
      const agent = await agentRegistry.setEnabled(body.agentId, body.enabled === true);
      return json(response, 200, { agent });
    } catch (error) {
      throw makeClientError(error);
    }
  }

  return json(response, 404, { error: "Topology editor API route not found" });
}

async function handleEnroll(request, response) {
  if (!topologyEditorEnabled) return json(response, 404, { error: "Enrollment is disabled" });
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  if (!requireJsonContent(request, response)) return;
  const remote = String(request.socket.remoteAddress || "unknown");
  if (!enrollmentRateLimiter.allow(remote)) {
    return json(response, 429, { error: "Enrollment rate limit exceeded" }, { "Retry-After": "60" });
  }
  const body = await readJsonBody(request, maxIngestBodyBytes);
  const code = String(body.code || "").trim();
  if (code.length < 20 || code.length > 200) return json(response, 400, { error: "Enrollment code is invalid" });
  const enrollment = probeStore.consumeEnrollment(code);
  if (!enrollment) return json(response, 400, { error: "Enrollment code is invalid, expired, or already used" });
  const issued = await agentRegistry.issueToken(enrollment.agentId, [enrollment.edgeId], {
    rotateExisting: enrollment.rotateExisting,
  });
  return json(response, 200, {
    agentId: issued.agent.id,
    edgeId: enrollment.edgeId,
    token: issued.token,
  });
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);
    return json(response, 200, {
      status: "ok",
      mode: demoMode ? "demo" : "live",
      komariConfigured: client.configured,
      probeStorage: "sqlite",
      agentRegistryProtection: "mirrored",
      timestamp: new Date().toISOString(),
    });
  }

  if (!requireBasicAuth(request, response)) return;

  if (url.pathname.startsWith("/api/editor/")) {
    return await handleEditorApi(request, response, url);
  }

  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);

  if (isDiagnosticApiPath(url.pathname) && !diagnosticApiEnabled) {
    return json(response, 404, { error: "API route not found" });
  }

  if (url.pathname === "/api/dashboard") {
    const dashboard = await getDashboard();
    return json(response, 200, dashboard);
  }

  if (url.pathname === "/api/nodes") {
    if (demoMode) return json(response, 200, (await getDashboard()).nodes);
    return json(response, 200, normalizeNodeList(await client.getNodes()));
  }

  if (url.pathname === "/api/ping-tasks") {
    if (demoMode) return json(response, 200, (await getDashboard()).tasks);
    return json(response, 200, normalizePingTasks(await client.getPingTasks()));
  }

  if (url.pathname === "/api/probes") {
    return json(response, 200, {
      agents: await agentRegistry.list(),
      edges: probeStore.getOverview(),
      registry: await agentRegistry.status(),
    });
  }

  if (url.pathname === "/api/edge-stats") {
    const probeId = url.searchParams.get("probe_id") || "";
    const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours") || 1)));
    if (probeId) {
      const config = await loadTopologyConfig(configPath);
      const edge = config.routes.flatMap((route) => route.edges).find((item) => item.probe_id === probeId);
      return json(response, 200, probeStore.getEdgeStats(probeId, hours, edge?.health_thresholds));
    }
    const uuid = url.searchParams.get("source_uuid") || "";
    const taskId = Number(url.searchParams.get("task_id"));
    if (!uuid || !Number.isFinite(taskId)) {
      return json(response, 400, { error: "source_uuid and numeric task_id are required" });
    }
    if (demoMode) {
      const match = (await getDashboard()).routes
        .flatMap((route) => route.edges)
        .find((edge) => edge.source_uuid === uuid && edge.task?.id === taskId);
      return json(response, match ? 200 : 404, match?.stats || { error: "Demo edge not found" });
    }
    const payload = await client.getPingRecords({ uuid, taskId, hours });
    const config = await loadTopologyConfig(configPath);
    const edge = config.routes
      .flatMap((route) => route.edges)
      .find((item) => {
        const sourceUuid = String(item.source_uuid || item.from || "");
        const taskIds = Array.isArray(item.task_ids) ? item.task_ids.map(Number) : [];
        return sourceUuid === uuid && (Number(item.task_id) === taskId || taskIds.includes(taskId));
      });
    return json(response, 200, computeEdgeStats(payload, taskId, edge?.health_thresholds));
  }

  return json(response, 404, { error: "API route not found" });
}

function bearerToken(request) {
  const header = String(request.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function readJsonBody(request, maximumBytes = maxIngestBodyBytes) {
  return await new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return rejectBody(new ProbeValidationError("request body is too large", 413));
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolveBody(text ? JSON.parse(text) : {});
      } catch {
        rejectBody(new ProbeValidationError("request body must be valid JSON"));
      }
    });
    request.on("error", rejectBody);
  });
}

async function handleIngest(request, response) {
  if (request.method !== "POST") {
    return json(response, 405, { error: "POST required" }, { Allow: "POST" });
  }
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return json(response, 415, { error: "Content-Type must be application/json" });
  }

  const agentId = String(request.headers["x-agent-id"] || "").trim();
  const agent = await agentRegistry.authenticate(agentId, bearerToken(request));
  if (!agent) return json(response, 401, { error: "Invalid agent credentials" });
  if (!ingestRateLimiter.allow(agent.id)) {
    return json(response, 429, { error: "Agent rate limit exceeded" }, { "Retry-After": "60" });
  }

  const samples = normalizeProbePayload(await readJsonBody(request));
  const forbidden = samples.find((sample) => !agent.allowed_edges.includes(sample.edgeId));
  if (forbidden) {
    return json(response, 403, { error: `Agent ${agent.id} cannot submit edge ${forbidden.edgeId}` });
  }
  const accepted = probeStore.ingest(agent.id, samples);
  dashboardCache.expiresAt = 0;
  return json(response, 202, {
    status: "accepted",
    agentId: agent.id,
    accepted,
    receivedAt: new Date().toISOString(),
  });
}

function safePublicPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const cleaned = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const absolute = resolve(publicDir, `.${sep}${cleaned}`);
  return absolute.startsWith(publicDir + sep) || absolute === publicDir ? absolute : null;
}

async function serveStatic(response, pathname) {
  let filePath = safePublicPath(pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(body);
  } catch (error) {
    if (error?.code === "ENOENT" && pathname !== "/index.html" && !pathname.startsWith("/agent/")) {
      return serveStatic(response, "/index.html");
    }
    response.writeHead(error?.code === "ENOENT" ? 404 : 500);
    response.end(error?.code === "ENOENT" ? "Not found" : "Unable to read static file");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/ingest") return await handleIngest(request, response);
    if (url.pathname === "/api/enroll") return await handleEnroll(request, response);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(request, response, url);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);
    if (url.pathname.startsWith("/agent/")) return await serveStatic(response, url.pathname);
    if (!requireBasicAuth(request, response)) return;
    return await serveStatic(response, url.pathname);
  } catch (error) {
    const status = Number(error?.status) || (error instanceof KomariError ? error.status : 500);
    console.error(`[${new Date().toISOString()}]`, error);
    return json(response, status, {
      error: error.message || "Internal server error",
      mode: demoMode ? "demo" : "live",
    });
  }
});

server.on("error", (error) => {
  console.error(`Unable to start dashboard server on ${host}:${port}: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`TopoMari listening on http://${host}:${port}`);
  console.log(`Mode: ${demoMode ? "demo" : `live (${client.baseUrl})`}`);
  console.log(`Topology editor: ${topologyEditorEnabled ? "enabled" : "disabled"}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      probeStore.close();
      process.exit(0);
    });
  });
}
