import { createServer } from "node:http";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ADMIN_SESSION_COOKIE,
  AdminSessionStore,
  parseCookies,
  serializeSessionCookie,
} from "./lib/admin-session.mjs";
import { KomariClient, KomariError } from "./lib/komari-client.mjs";
import { AgentRegistry } from "./lib/agent-registry.mjs";
import { ProbeRateLimiter, ProbeValidationError, normalizeProbePayload } from "./lib/probe-ingest.mjs";
import { ProbeStore } from "./lib/probe-store.mjs";
import { isDiagnosticApiPath, validateDashboardAuthConfig } from "./lib/security-policy.mjs";
import { TopologyConfigStore } from "./lib/topology-config-store.mjs";
import { sanitizeBranding, sanitizeSiteSettings } from "./lib/topology-config.mjs";
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
const faviconPath = resolve(rootDir, process.env.SITE_FAVICON_PATH || "data/favicon");
const themeAssetDir = resolve(rootDir, process.env.THEME_ASSET_DIR || "data/theme/user-assets");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const cacheTtlMs = Math.max(1, Number(process.env.CACHE_TTL_SECONDS || 8)) * 1000;
const basicUser = process.env.DASHBOARD_USER || "";
const basicPassword = process.env.DASHBOARD_PASSWORD || "";
const maxIngestBodyBytes = Math.max(1024, Number(process.env.MAX_INGEST_BODY_BYTES || 32_768));
const maxEditorBodyBytes = Math.max(16_384, Number(process.env.MAX_EDITOR_BODY_BYTES || 131_072));
const maxFaviconBytes = Math.min(5 * 1024 * 1024, Math.max(16_384, Number(process.env.MAX_FAVICON_BYTES || 2 * 1024 * 1024)));
const maxThemeBackgroundBytes = Math.min(
  64 * 1024 * 1024,
  Math.max(1 * 1024 * 1024, Number(process.env.MAX_THEME_BACKGROUND_BYTES || 32 * 1024 * 1024)),
);
const adminSessionTtlSeconds = Math.max(300, Number(process.env.ADMIN_SESSION_TTL_SECONDS || 604_800));
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
      ? "Admin login is disabled in demo mode because no credentials are configured."
      : "Admin login is disabled by the explicit ALLOW_UNAUTHENTICATED_DASHBOARD override.",
  );
}
const topologyEditorRequested = envFlag("ENABLE_TOPOLOGY_EDITOR", true);
const topologyEditorEnabled = topologyEditorRequested && basicAuthConfigured;
if (topologyEditorRequested && !topologyEditorEnabled) {
  console.warn("Topology editor was disabled because admin credentials are not configured.");
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
const adminLoginRateLimiter = new ProbeRateLimiter({
  limit: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_PER_5_MINUTES || 10),
  windowMs: 5 * 60_000,
});
const adminSessions = new AdminSessionStore({ ttlMs: adminSessionTtlSeconds * 1000 });
const basicCsrfToken = randomBytes(32).toString("base64url");

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

function validBasicCredentials(request) {
  if (!basicAuthConfigured) return false;
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Basic ")) return false;
  let credentials = "";
  try {
    credentials = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    credentials = "";
  }
  const separatorIndex = credentials.indexOf(":");
  const user = separatorIndex >= 0 ? credentials.slice(0, separatorIndex) : credentials;
  const password = separatorIndex >= 0 ? credentials.slice(separatorIndex + 1) : "";
  return secureEqual(user, basicUser) && secureEqual(password, basicPassword);
}

function requestSessionToken(request) {
  return parseCookies(request.headers.cookie).get(ADMIN_SESSION_COOKIE) || "";
}

function adminPrincipal(request) {
  const session = adminSessions.get(requestSessionToken(request));
  if (session) return { ...session, type: "session" };
  if (validBasicCredentials(request)) {
    return { username: basicUser, csrfToken: basicCsrfToken, type: "basic" };
  }
  return null;
}

function requireAdmin(request, response) {
  const principal = adminPrincipal(request);
  if (principal) return principal;
  json(response, 401, { error: "Admin authentication required" });
  return null;
}

function requestIsSecure(request) {
  const forwarded = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwarded === "https" || request.socket.encrypted === true;
}

function sessionCookie(token, request, maximumAgeSeconds = adminSessionTtlSeconds) {
  return serializeSessionCookie(token, {
    maximumAgeSeconds,
    secure: requestIsSecure(request),
  });
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

function requireEditorCsrf(request, response, principal) {
  const presented = String(request.headers["x-topology-csrf"] || "");
  if (presented && principal?.csrfToken && secureEqual(presented, principal.csrfToken)) return true;
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

async function handleEditorApi(request, response, url, principal) {
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
      csrfToken: principal.csrfToken,
      revision,
      config,
      nodes: inventory.nodes,
      tasks: inventory.tasks,
      agents,
      agentRegistry: await agentRegistry.status(),
      probeEdges: probeStore.getOverview(),
    });
  }

  if (url.pathname === "/api/editor/branding" && request.method === "GET") {
    const { config, revision } = await topologyConfigStore.read();
    const branding = sanitizeBranding(config);
    return json(response, 200, { ...branding, revision });
  }

  if (!requireEditorCsrf(request, response, principal)) return;
  if (!requireJsonContent(request, response)) return;

  if (url.pathname === "/api/editor/branding") {
    if (request.method !== "PUT") return methodNotAllowed(response, ["GET", "PUT"]);
    try {
      const body = await readJsonBody(request, maxEditorBodyBytes);
      const current = await topologyConfigStore.read();
      const branding = sanitizeBranding({
        siteName: body.siteName ?? current.config.site_name,
        mainTitle: body.mainTitle ?? current.config.title,
      });
      const result = await topologyConfigStore.write({
        ...current.config,
        site_name: branding.siteName,
        title: branding.mainTitle,
      }, String(body.revision || ""));
      dashboardCache = { expiresAt: 0, value: null, promise: null };
      return json(response, 200, { ...branding, revision: result.revision });
    } catch (error) {
      throw makeClientError(error);
    }
  }

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

async function handleAuthApi(request, response, url) {
  if (url.pathname === "/api/auth/session") {
    if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
    const principal = adminPrincipal(request);
    return json(response, 200, {
      authenticated: Boolean(principal),
      username: principal?.username || "",
      editorEnabled: topologyEditorEnabled,
      csrfToken: principal?.csrfToken || "",
    });
  }

  if (url.pathname === "/api/auth/login") {
    if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
    if (!basicAuthConfigured) {
      return json(response, 503, { error: "Admin credentials are not configured" });
    }
    if (!requireJsonContent(request, response)) return;
    const remote = String(request.socket.remoteAddress || "unknown");
    if (!adminLoginRateLimiter.allow(remote)) {
      return json(response, 429, { error: "Too many login attempts" }, { "Retry-After": "300" });
    }
    const body = await readJsonBody(request, 16_384);
    const username = String(body.username || "");
    const password = String(body.password || "");
    const usernameMatches = secureEqual(username, basicUser);
    const passwordMatches = secureEqual(password, basicPassword);
    if (!usernameMatches || !passwordMatches) {
      return json(response, 401, { error: "Invalid username or password" });
    }
    const session = adminSessions.create(basicUser);
    return json(response, 200, {
      authenticated: true,
      username: session.username,
      editorEnabled: topologyEditorEnabled,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    }, { "Set-Cookie": sessionCookie(session.token, request) });
  }

  if (url.pathname === "/api/auth/logout") {
    if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
    const principal = requireAdmin(request, response);
    if (!principal) return;
    if (!requireEditorCsrf(request, response, principal)) return;
    adminSessions.delete(requestSessionToken(request));
    return json(response, 200, { authenticated: false }, {
      "Set-Cookie": sessionCookie("", request, 0),
    });
  }

  return json(response, 404, { error: "Authentication route not found" });
}

async function faviconState() {
  try {
    const info = await stat(faviconPath);
    return { customFavicon: info.isFile(), faviconVersion: Math.round(info.mtimeMs) };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { customFavicon: false, faviconVersion: 0 };
  }
}

async function siteSettingsPayload({ csrfToken = "" } = {}) {
  const { config, revision } = await topologyConfigStore.read();
  return {
    ...sanitizeSiteSettings(config),
    ...await faviconState(),
    backgroundAssets: await themeBackgroundState(),
    faviconUrl: "/favicon",
    revision,
    csrfToken,
  };
}

async function publicSiteSettingsPayload() {
  const site = await siteSettingsPayload();
  return {
    siteName: site.siteName,
    description: site.description,
    autoThemeBeijing: site.autoThemeBeijing,
    visualTheme: site.visualTheme,
    customThemeColors: site.customThemeColors,
    themeColors: site.themeColors,
    themeSettings: site.themeSettings,
    customFavicon: site.customFavicon,
    faviconVersion: site.faviconVersion,
    faviconUrl: site.faviconUrl,
  };
}

function faviconMime(body) {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) {
    return "image/x-icon";
  }
  return "";
}

const THEME_BACKGROUND_FORMATS = Object.freeze([
  { extension: "png", mime: "image/png", type: "image", matches: (body) => body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { extension: "jpg", mime: "image/jpeg", type: "image", matches: (body) => body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff },
  { extension: "webp", mime: "image/webp", type: "image", matches: (body) => body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP" },
  { extension: "gif", mime: "image/gif", type: "image", matches: (body) => body.length >= 6 && ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii")) },
  { extension: "mp4", mime: "video/mp4", type: "video", matches: (body) => body.length >= 12 && body.subarray(4, 8).toString("ascii") === "ftyp" },
  { extension: "webm", mime: "video/webm", type: "video", matches: (body) => body.length >= 4 && body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
]);

function themeBackgroundFormat(body) {
  return THEME_BACKGROUND_FORMATS.find((format) => format.matches(body)) || null;
}

function themeBackgroundFile(mode, extension) {
  return join(themeAssetDir, `background-${mode}.${extension}`);
}

async function findThemeBackground(mode) {
  for (const format of THEME_BACKGROUND_FORMATS) {
    const path = themeBackgroundFile(mode, format.extension);
    try {
      const info = await stat(path);
      if (info.isFile()) return { ...format, path, version: Math.round(info.mtimeMs), size: info.size };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function themeBackgroundState() {
  const [light, dark] = await Promise.all([
    findThemeBackground("light"),
    findThemeBackground("dark"),
  ]);
  const serialize = (asset) => asset
    ? { exists: true, type: asset.type, mime: asset.mime, version: asset.version, size: asset.size }
    : { exists: false, type: "", mime: "", version: 0, size: 0 };
  return { light: serialize(light), dark: serialize(dark) };
}

async function removeThemeBackground(mode) {
  await Promise.all(THEME_BACKGROUND_FORMATS.map(async (format) => {
    try {
      await unlink(themeBackgroundFile(mode, format.extension));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }));
}

async function writeThemeBackground(mode, body, format) {
  await mkdir(themeAssetDir, { recursive: true });
  await removeThemeBackground(mode);
  const destination = themeBackgroundFile(mode, format.extension);
  const temporary = `${destination}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, body, { mode: 0o640 });
  await rename(temporary, destination);
}

async function readBinaryBody(request, maximumBytes, label = "File") {
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
      if (tooLarge) return rejectBody(new ProbeValidationError(`${label} is too large`, 413));
      resolveBody(Buffer.concat(chunks));
    });
    request.on("error", rejectBody);
  });
}

async function writeFavicon(body) {
  const temporary = `${faviconPath}.${randomBytes(6).toString("hex")}.tmp`;
  await mkdir(dirname(faviconPath), { recursive: true });
  await writeFile(temporary, body, { mode: 0o640 });
  await rename(temporary, faviconPath);
}

async function handleAdminApi(request, response, url, principal) {
  if (url.pathname === "/api/admin/site" && request.method === "GET") {
    return json(response, 200, await siteSettingsPayload({ csrfToken: principal.csrfToken }));
  }

  if (url.pathname === "/api/admin/site") {
    if (request.method !== "PUT") return methodNotAllowed(response, ["GET", "PUT"]);
    if (!requireEditorCsrf(request, response, principal)) return;
    if (!requireJsonContent(request, response)) return;
    const body = await readJsonBody(request, maxEditorBodyBytes);
    const current = await topologyConfigStore.read();
    const mergedThemeSettings = {
      ...(current.config.theme_settings || {}),
      ...(body.theme_settings || {}),
      ...(body.themeSettings || {}),
    };
    const site = sanitizeSiteSettings({
      ...current.config,
      ...body,
      theme_colors: {
        ...(current.config.theme_colors || {}),
        ...(body.theme_colors || {}),
      },
      themeColors: {
        lightBackground: body.themeColors?.lightBackground
          ?? body.theme_colors?.light_background
          ?? current.config.theme_colors?.light_background,
        lightAccent: body.themeColors?.lightAccent
          ?? body.theme_colors?.light_accent
          ?? current.config.theme_colors?.light_accent,
        darkBackground: body.themeColors?.darkBackground
          ?? body.theme_colors?.dark_background
          ?? current.config.theme_colors?.dark_background,
        darkAccent: body.themeColors?.darkAccent
          ?? body.theme_colors?.dark_accent
          ?? current.config.theme_colors?.dark_accent,
      },
      themeSettings: mergedThemeSettings,
    });
    const result = await topologyConfigStore.write({
      ...current.config,
      site_name: site.siteName,
      title: site.siteName,
      description: site.description,
      auto_theme_beijing: site.autoThemeBeijing,
      visual_theme: site.visualTheme,
      custom_theme_colors: site.customThemeColors,
      theme_colors: {
        light_background: site.themeColors.lightBackground,
        light_accent: site.themeColors.lightAccent,
        dark_background: site.themeColors.darkBackground,
        dark_accent: site.themeColors.darkAccent,
      },
      theme_settings: {
        background_enabled: site.themeSettings.backgroundEnabled,
        background_type: site.themeSettings.backgroundType,
        light_background: site.themeSettings.lightBackground,
        dark_background: site.themeSettings.darkBackground,
        background_blur: site.themeSettings.backgroundBlur,
        background_overlay: site.themeSettings.backgroundOverlay,
        glass_blur: site.themeSettings.glassBlur,
        glass_opacity: site.themeSettings.glassOpacity,
        glass_border: site.themeSettings.glassBorder,
        corner_radius: site.themeSettings.cornerRadius,
      },
    }, String(body.revision || ""));
    dashboardCache = { expiresAt: 0, value: null, promise: null };
    return json(response, 200, {
      ...site,
      ...await faviconState(),
      backgroundAssets: await themeBackgroundState(),
      faviconUrl: "/favicon",
      revision: result.revision,
      csrfToken: principal.csrfToken,
    });
  }

  if (url.pathname === "/api/admin/site/favicon") {
    if (request.method !== "PUT" && request.method !== "DELETE") {
      return methodNotAllowed(response, ["PUT", "DELETE"]);
    }
    if (!requireEditorCsrf(request, response, principal)) return;
    if (request.method === "DELETE") {
      try {
        await unlink(faviconPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return json(response, 200, await siteSettingsPayload({ csrfToken: principal.csrfToken }));
    }
    const body = await readBinaryBody(request, maxFaviconBytes, "Favicon");
    if (!body.length) return json(response, 400, { error: "Favicon file is empty" });
    const mime = faviconMime(body);
    if (!mime) return json(response, 415, { error: "Favicon must be a PNG or ICO file" });
    await writeFavicon(body);
    return json(response, 200, {
      ...await siteSettingsPayload({ csrfToken: principal.csrfToken }),
      mime,
    });
  }

  const backgroundMatch = url.pathname.match(/^\/api\/admin\/theme\/background\/(light|dark)$/);
  if (backgroundMatch) {
    if (request.method !== "PUT" && request.method !== "DELETE") {
      return methodNotAllowed(response, ["PUT", "DELETE"]);
    }
    if (!requireEditorCsrf(request, response, principal)) return;
    const mode = backgroundMatch[1];
    if (request.method === "DELETE") {
      await removeThemeBackground(mode);
      return json(response, 200, { backgroundAssets: await themeBackgroundState() });
    }
    const body = await readBinaryBody(request, maxThemeBackgroundBytes, "Theme background");
    if (!body.length) return json(response, 400, { error: "Theme background file is empty" });
    const format = themeBackgroundFormat(body);
    if (!format) return json(response, 415, { error: "Theme background must be PNG, JPEG, WebP, GIF, MP4, or WebM" });
    const expectedType = url.searchParams.get("type");
    if (expectedType && expectedType !== format.type) {
      return json(response, 415, { error: `Selected background type is ${expectedType}, but the uploaded file is ${format.type}` });
    }
    await writeThemeBackground(mode, body, format);
    return json(response, 200, {
      source: `local:${mode}`,
      backgroundAssets: await themeBackgroundState(),
    });
  }

  return json(response, 404, { error: "Admin API route not found" });
}

async function serveFavicon(response) {
  let body;
  let mime;
  try {
    body = await readFile(faviconPath);
    mime = faviconMime(body);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!body || !mime) {
    body = await readFile(join(publicDir, "favicon.png"));
    mime = "image/png";
  }
  response.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function serveThemeBackground(response, mode) {
  const asset = await findThemeBackground(mode);
  if (!asset) {
    response.writeHead(404);
    response.end("Theme background not found");
    return;
  }
  const body = await readFile(asset.path);
  response.writeHead(200, {
    "Content-Type": asset.mime,
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function handleApi(request, response, url) {
  if (url.pathname.startsWith("/api/auth/")) {
    return await handleAuthApi(request, response, url);
  }

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

  if (url.pathname === "/api/site") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);
    return json(response, 200, await publicSiteSettingsPayload());
  }

  if (url.pathname === "/api/dashboard") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);
    return json(response, 200, await getDashboard());
  }

  if (url.pathname === "/api/edge-stats") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);
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

  const principal = requireAdmin(request, response);
  if (!principal) return;

  if (url.pathname.startsWith("/api/admin/")) {
    return await handleAdminApi(request, response, url, principal);
  }

  if (url.pathname.startsWith("/api/editor/")) {
    return await handleEditorApi(request, response, url, principal);
  }

  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);

  if (isDiagnosticApiPath(url.pathname) && !diagnosticApiEnabled) {
    return json(response, 404, { error: "API route not found" });
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
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https: http:; media-src 'self' blob: https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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
    if (url.pathname === "/favicon" || url.pathname === "/favicon.ico") return await serveFavicon(response);
    const backgroundMatch = url.pathname.match(/^\/theme-background\/(light|dark)$/);
    if (backgroundMatch) {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);
      return await serveThemeBackground(response, backgroundMatch[1]);
    }
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(request, response, url);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, ["GET"]);
    if (url.pathname.startsWith("/agent/")) return await serveStatic(response, url.pathname);
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
