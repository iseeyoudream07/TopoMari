import { resolveHealthThresholds } from "./health-status.mjs";
import { validateIdentifier } from "./agent-registry.mjs";

const MAX_ROUTES = 64;
const MAX_NODES_PER_ROUTE = 12;
const MAX_TEXT_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 500;
const DEFAULT_BRAND_NAME = "TopoMari";
const DEFAULT_SITE_DESCRIPTION = "Multi-hop latency and packet-loss visibility";
const VISUAL_THEMES = new Set(["topomari", "glassmorphism"]);
const BACKGROUND_TYPES = new Set(["image", "video"]);
const DEFAULT_THEME_SETTINGS = Object.freeze({
  backgroundEnabled: false,
  backgroundType: "image",
  lightBackground: "",
  darkBackground: "",
  backgroundBlur: 0,
  backgroundOverlay: 0,
  glassBlur: 18,
  glassOpacity: 78,
  glassBorder: 18,
  cornerRadius: 18,
});
const DEFAULT_THEME_COLORS = Object.freeze({
  topomari: Object.freeze({
    lightBackground: "#eeede5",
    lightAccent: "#a7622d",
    darkBackground: "#1c1b19",
    darkAccent: "#e4a35f",
  }),
  glassmorphism: Object.freeze({
    lightBackground: "#e8edf4",
    lightAccent: "#059669",
    darkBackground: "#0b1020",
    darkAccent: "#34d399",
  }),
});
const HEALTH_KEYS = [
  "warning_latency_ms",
  "degraded_latency_ms",
  "warning_loss_percent",
  "degraded_loss_percent",
];

function text(value, fallback = "", maximum = MAX_TEXT_LENGTH) {
  return String(value ?? fallback).trim().slice(0, maximum);
}

export function sanitizeBranding(value) {
  const source = value || {};
  return {
    siteName: text(source.siteName ?? source.site_name, DEFAULT_BRAND_NAME) || DEFAULT_BRAND_NAME,
    mainTitle: text(source.mainTitle ?? source.main_title ?? source.title, DEFAULT_BRAND_NAME) || DEFAULT_BRAND_NAME,
  };
}

function hexColor(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

export function sanitizeVisualThemeSettings(value) {
  const source = value || {};
  const colors = source.themeColors ?? source.theme_colors ?? {};
  const requestedTheme = text(source.visualTheme ?? source.visual_theme, "topomari", 32).toLowerCase();
  const visualTheme = VISUAL_THEMES.has(requestedTheme) ? requestedTheme : "topomari";
  const defaults = DEFAULT_THEME_COLORS[visualTheme];
  return {
    visualTheme,
    customThemeColors: source.customThemeColors === undefined
      ? source.custom_theme_colors === true
      : source.customThemeColors === true,
    themeColors: {
      lightBackground: hexColor(
        colors.lightBackground ?? colors.light_background,
        defaults.lightBackground,
      ),
      lightAccent: hexColor(colors.lightAccent ?? colors.light_accent, defaults.lightAccent),
      darkBackground: hexColor(
        colors.darkBackground ?? colors.dark_background,
        defaults.darkBackground,
      ),
      darkAccent: hexColor(colors.darkAccent ?? colors.dark_accent, defaults.darkAccent),
    },
  };
}

function booleanSetting(source, camelKey, snakeKey, fallback = false) {
  if (source[camelKey] !== undefined) return source[camelKey] === true;
  if (source[snakeKey] !== undefined) return source[snakeKey] === true;
  return fallback;
}

function backgroundSource(value, mode) {
  const source = text(value, "", 1_000);
  if (!source) return "";
  if (source === `local:${mode}`) return source;
  if (source.startsWith("/") && !source.startsWith("//")) return source;
  try {
    const parsed = new URL(source);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

export function sanitizeThemeSettings(value) {
  const source = value?.themeSettings ?? value?.theme_settings ?? value ?? {};
  const requestedType = text(source.backgroundType ?? source.background_type, "image", 16).toLowerCase();
  return {
    backgroundEnabled: booleanSetting(source, "backgroundEnabled", "background_enabled"),
    backgroundType: BACKGROUND_TYPES.has(requestedType) ? requestedType : DEFAULT_THEME_SETTINGS.backgroundType,
    lightBackground: backgroundSource(
      source.lightBackground ?? source.light_background,
      "light",
    ),
    darkBackground: backgroundSource(
      source.darkBackground ?? source.dark_background,
      "dark",
    ),
    backgroundBlur: Math.round(finiteNumber(
      source.backgroundBlur ?? source.background_blur,
      DEFAULT_THEME_SETTINGS.backgroundBlur,
      { minimum: 0, maximum: 40 },
    )),
    backgroundOverlay: Math.round(finiteNumber(
      source.backgroundOverlay ?? source.background_overlay,
      DEFAULT_THEME_SETTINGS.backgroundOverlay,
      { minimum: -100, maximum: 100 },
    )),
    glassBlur: Math.round(finiteNumber(
      source.glassBlur ?? source.glass_blur,
      DEFAULT_THEME_SETTINGS.glassBlur,
      { minimum: 0, maximum: 30 },
    )),
    glassOpacity: Math.round(finiteNumber(
      source.glassOpacity ?? source.glass_opacity,
      DEFAULT_THEME_SETTINGS.glassOpacity,
      { minimum: 45, maximum: 100 },
    )),
    glassBorder: Math.round(finiteNumber(
      source.glassBorder ?? source.glass_border,
      DEFAULT_THEME_SETTINGS.glassBorder,
      { minimum: 0, maximum: 100 },
    )),
    cornerRadius: Math.round(finiteNumber(
      source.cornerRadius ?? source.corner_radius,
      DEFAULT_THEME_SETTINGS.cornerRadius,
      { minimum: 8, maximum: 28 },
    )),
  };
}

function isoTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function sanitizeGeoIpSettings(value) {
  const root = value || {};
  const source = root.geoIp ?? root.geo_ip ?? {};
  const enabled = source.enabled === undefined
    ? root.geoIpEnabled === undefined
      ? root.geo_ip_enabled === true
      : root.geoIpEnabled === true
    : source.enabled === true;
  return {
    enabled,
    provider: "maxmind",
    lastUpdatedAt: isoTimestamp(
      source.lastUpdatedAt
        ?? source.last_updated_at
        ?? root.geoIpLastUpdatedAt
        ?? root.geo_ip_last_updated_at,
    ),
  };
}

export function sanitizeSiteSettings(value) {
  const source = value || {};
  const branding = sanitizeBranding(source);
  const visualTheme = sanitizeVisualThemeSettings(source);
  return {
    siteName: branding.siteName,
    description: text(
      source.description ?? source.site_description ?? source.subtitle,
      DEFAULT_SITE_DESCRIPTION,
      MAX_DESCRIPTION_LENGTH,
    ) || DEFAULT_SITE_DESCRIPTION,
    autoThemeBeijing: source.autoThemeBeijing === undefined
      ? source.auto_theme_beijing === true
      : source.autoThemeBeijing === true,
    ...visualTheme,
    themeSettings: sanitizeThemeSettings(source),
    geoIp: sanitizeGeoIpSettings(source),
  };
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

function optionalCoordinate(value, label, minimum, maximum) {
  if (value === undefined || value === null || value === "") return undefined;
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return Math.round(coordinate * 1_000_000) / 1_000_000;
}

function sanitizeNode(value) {
  const source = typeof value === "string" ? { id: value } : value || {};
  const node = {
    id: validateIdentifier(source.id, "node id"),
  };
  const label = text(source.label);
  const type = text(source.type, "server", 32);
  const region = text(source.region);
  const latitude = optionalCoordinate(source.latitude ?? source.lat, "node latitude", -90, 90);
  const longitude = optionalCoordinate(source.longitude ?? source.lng ?? source.lon, "node longitude", -180, 180);
  if (label) node.label = label;
  if (type) node.type = type;
  if (region) node.region = region;
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new Error("node latitude and longitude must be configured together");
  }
  if (latitude !== undefined) {
    node.latitude = latitude;
    node.longitude = longitude;
  }
  return node;
}

function sanitizeThresholds(value, globalThresholds) {
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
  resolveHealthThresholds({ ...globalThresholds, ...thresholds });
  return Object.keys(thresholds).length ? thresholds : undefined;
}

function sanitizeEdge(value, globalThresholds) {
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
  const thresholds = sanitizeThresholds(source.health_thresholds, globalThresholds);
  if (thresholds) edge.health_thresholds = thresholds;
  return edge;
}

function sanitizeRoute(value, globalThresholds) {
  const source = value || {};
  const id = validateIdentifier(source.id, "route id");
  const nodes = Array.isArray(source.nodes) ? source.nodes.map(sanitizeNode) : [];
  const edges = Array.isArray(source.edges) ? source.edges.map((edge) => sanitizeEdge(edge, globalThresholds)) : [];
  return {
    id,
    name: text(source.name, id),
    nodes,
    edges,
  };
}

export function sanitizeTopologyConfig(value) {
  const source = value || {};
  const healthThresholds = resolveHealthThresholds(source.health_thresholds ?? source.healthThresholds ?? {});
  const routes = Array.isArray(source.routes)
    ? source.routes.map((route) => sanitizeRoute(route, healthThresholds))
    : [];
  const branding = sanitizeBranding(source);
  const site = sanitizeSiteSettings(source);
  const config = {
    site_name: branding.siteName,
    title: branding.mainTitle,
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
    geo_ip_enabled: site.geoIp.enabled,
    geo_ip_provider: "maxmind",
    geo_ip_last_updated_at: site.geoIp.lastUpdatedAt,
    health_thresholds: healthThresholds,
    subtitle: text(source.subtitle, DEFAULT_SITE_DESCRIPTION),
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
      resolveHealthThresholds({
        ...(config.health_thresholds || {}),
        ...(edge.health_thresholds || {}),
      });
    });
  }
  return config;
}
