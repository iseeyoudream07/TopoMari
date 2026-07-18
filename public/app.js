import { dashboardApi } from "./frontend/api-client.js";
import { getLocale, t } from "./frontend/i18n.js";
import { initPreferences, setAutoThemeBeijing } from "./frontend/preferences.js";
import { createRouteGlobe } from "./frontend/route-globe.js?v=2.8.1-globe-overview";
import { applySiteTheme } from "./frontend/site-theme.js";
import { applyThemeSettings } from "./frontend/theme-background.js";
import { renderSparkline } from "./sparkline.js";

const elements = {
  title: document.getElementById("page-title"),
  description: document.getElementById("site-description"),
  sourceChip: document.getElementById("source-chip"),
  sourceLabel: document.getElementById("source-label"),
  refreshButton: document.getElementById("refresh-button"),
  routes: document.getElementById("topology-routes"),
  updated: document.getElementById("last-updated"),
  links: document.getElementById("link-health-list"),
  nodes: document.getElementById("node-grid"),
  errorPanel: document.getElementById("error-panel"),
  errorMessage: document.getElementById("error-message"),
  statRoutes: document.getElementById("stat-routes"),
  statEdges: document.getElementById("stat-edges"),
  statNodes: document.getElementById("stat-nodes"),
  statLatency: document.getElementById("stat-latency"),
  statLoss: document.getElementById("stat-loss"),
  statAlerts: document.getElementById("stat-alerts"),
  globeCanvas: document.getElementById("route-globe-canvas"),
  globeNodeCount: document.getElementById("route-globe-node-count"),
  globeLinkCount: document.getElementById("route-globe-link-count"),
};

let refreshTimer = null;
let loading = false;
let lastDashboard = null;
let lastError = null;

const routeGlobe = createRouteGlobe(elements.globeCanvas, {
  countElement: elements.globeLinkCount,
  nodeCountElement: elements.globeNodeCount,
});

const knownStatuses = new Set(["healthy", "warning", "degraded", "failed", "unconfigured", "unknown"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
}

function formatLatency(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${formatNumber(number, number < 10 && number % 1 ? 1 : 0)} ms` : "—";
}

function formatLoss(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${formatNumber(number, number % 1 ? 1 : 0)}%` : "—";
}

function statusLabel(status) {
  return t(`status.${knownStatuses.has(status) ? status : "unknown"}`);
}

function statusRank(status) {
  return {
    failed: 6,
    degraded: 5,
    warning: 4,
    unconfigured: 3,
    unknown: 2,
    healthy: 1,
  }[status] || 0;
}

function nodeIcon(type) {
  if (type === "client") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 4.5 6.3 4.5 9S15 17.7 12 21c-3-3.3-4.5-6.3-4.5-9S9 6.3 12 3z"/></svg>';
  }
  if (type === "target") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8M5.7 6.4l12.6 11.2M18.3 6.4 5.7 17.6"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/></svg>';
}

function measurementLabel(edge) {
  let label;
  if (edge.task?.type === "private" || edge.probe_id) {
    label = `${edge.task?.name || edge.probe_name || t("measurement.privateProbe")} · ${edge.probe_id || "private"}`;
  } else {
    label = edge.task?.name || edge.task_name || edge.task_id || t("measurement.unconfigured");
  }
  return edge.measurement_direction === "reverse" ? `${label} · ${t("measurement.reverse")}` : label;
}

function renderTopologyNode(node) {
  const stateText = node.virtual
    ? node.region || t("node.virtualEndpoint")
    : node.online
      ? node.region || t("common.online")
      : t("common.offline");
  return `
    <div class="topology-node ${node.online ? "" : "is-offline"}" data-type="${escapeHtml(node.type || "server")}" aria-label="${escapeHtml(node.name)}, ${escapeHtml(stateText)}">
      <div class="node-icon">${nodeIcon(node.type)}</div>
      <div class="node-copy">
        <span class="node-name">${escapeHtml(node.name)}</span>
        <span class="${node.virtual ? "node-region" : "node-state"}">${escapeHtml(stateText)}</span>
      </div>
    </div>`;
}

function renderConnector(edge) {
  const status = edge.stats?.status || "unknown";
  const loss = edge.stats?.loss;
  const lossClass = Number(loss) > 0 ? "has-loss" : "";
  const taskName = measurementLabel(edge);
  const error = edge.error ? ` · ${edge.error}` : "";
  const aria = `${taskName}: ${formatLatency(edge.stats?.latest)}, ${t("link.loss")} ${formatLoss(loss)}${error}`;
  return `
    <div class="edge-connector" data-status="${escapeHtml(status)}" aria-label="${escapeHtml(aria)}">
      <div class="edge-metrics">
        <span class="metric-pill">${escapeHtml(formatLatency(edge.stats?.latest))}</span>
        <span class="metric-pill loss ${lossClass}">${escapeHtml(formatLoss(loss))}</span>
      </div>
      <div class="edge-line"><span class="edge-packet" aria-hidden="true"></span></div>
    </div>`;
}

function routeHealth(route) {
  return route.edges.reduce(
    (worst, edge) => (statusRank(edge.stats?.status) > statusRank(worst) ? edge.stats.status : worst),
    "healthy",
  );
}

function renderRoutes(routes) {
  if (!routes.length) {
    elements.routes.innerHTML = `<div class="empty-state">${escapeHtml(t("empty.routes"))}</div>`;
    return;
  }

  elements.routes.innerHTML = routes
    .map((route) => {
      const health = routeHealth(route);
      const track = route.nodes
        .map((node, index) => `${index ? renderConnector(route.edges[index - 1]) : ""}${renderTopologyNode(node)}`)
        .join("");
      return `
        <article class="route-card">
          <div class="route-meta">
            <span class="route-name">${escapeHtml(route.name)}</span>
            <span class="route-status ${health === "healthy" ? "" : health === "failed" ? "is-failed" : "is-warning"}">${escapeHtml(statusLabel(health))}</span>
          </div>
          <div class="route-track">${track}</div>
        </article>`;
    })
    .join("");
}

function flattenEdges(routes) {
  return routes.flatMap((route) =>
    route.edges.map((edge, index) => ({
      ...edge,
      routeName: route.name,
      fromNode: route.nodes[index],
      toNode: route.nodes[index + 1],
    })),
  );
}

function renderLinkHealth(routes) {
  const edges = flattenEdges(routes).sort((a, b) => {
    const statusDifference = statusRank(b.stats?.status) - statusRank(a.stats?.status);
    if (statusDifference) return statusDifference;
    return Number(b.stats?.latest || 0) - Number(a.stats?.latest || 0);
  });

  if (!edges.length) {
    elements.links.innerHTML = `<div class="empty-state">${escapeHtml(t("empty.links"))}</div>`;
    return;
  }

  const sparkLabels = {
    empty: t("spark.empty"),
    collecting: (value) => t("spark.collecting", { value }),
    range: (min, max) => t("spark.range", { min, max }),
  };
  elements.links.innerHTML = edges
    .map((edge) => {
      const status = edge.stats?.status || "unknown";
      const latencyClass = status === "failed" || status === "degraded" ? "is-danger" : status === "warning" ? "is-warning" : "";
      const lossClass = Number(edge.stats?.loss) >= 10 ? "is-danger" : Number(edge.stats?.loss) > 0 ? "is-warning" : "";
      return `
        <div class="link-row">
          <div class="link-title">
            <strong>${escapeHtml(edge.fromNode?.name)} → ${escapeHtml(edge.toNode?.name)}</strong>
          </div>
          <div class="link-stat">
            <strong class="${latencyClass}">${escapeHtml(formatLatency(edge.stats?.latest))}</strong>
            <span>${escapeHtml(t("link.average", { value: formatLatency(edge.stats?.avg) }))}</span>
          </div>
          ${renderSparkline(edge.stats?.history, status, formatLatency, sparkLabels)}
          <div class="link-stat">
            <strong class="${lossClass}">${escapeHtml(formatLoss(edge.stats?.loss))}</strong>
            <span>${escapeHtml(t("link.loss"))}</span>
          </div>
          <span class="status-badge ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
        </div>`;
    })
    .join("");
}

function renderNodes(nodes) {
  if (!nodes.length) {
    elements.nodes.innerHTML = `<div class="empty-state">${escapeHtml(t("empty.nodes"))}</div>`;
    return;
  }
  elements.nodes.innerHTML = nodes
    .map((node) => {
      const state = node.online ? t("common.online") : t("common.offline");
      return `
        <div class="asset-node ${node.online ? "" : "is-offline"}">
          <div class="asset-node-header">
            <div class="asset-node-name">
              <strong>${escapeHtml(node.name)}</strong>
              <span>${escapeHtml(node.region || node.os || "Komari Agent")}</span>
            </div>
            <span class="node-online-dot" aria-label="${escapeHtml(state)}"></span>
          </div>
        </div>`;
    })
    .join("");
}

function renderSummary(summary, routes) {
  const alertStatuses = new Set(["warning", "degraded", "failed"]);
  const alertCount = flattenEdges(routes).filter((edge) => alertStatuses.has(edge.stats?.status)).length;
  elements.statRoutes.textContent = formatNumber(summary.routes);
  elements.statEdges.textContent = formatNumber(summary.edges);
  elements.statNodes.textContent = `${formatNumber(summary.onlineNodes)} / ${formatNumber(summary.nodes)}`;
  elements.statLatency.textContent = summary.averageLatency === null || summary.averageLatency === undefined
    ? "—"
    : formatNumber(summary.averageLatency, summary.averageLatency < 10 && summary.averageLatency % 1 ? 1 : 0);
  elements.statLoss.textContent = summary.averageLoss === null || summary.averageLoss === undefined
    ? "—"
    : formatNumber(summary.averageLoss, summary.averageLoss % 1 ? 1 : 0);
  elements.statAlerts.textContent = formatNumber(alertCount);
  elements.statAlerts.closest(".stat-card")?.toggleAttribute("data-has-alerts", alertCount > 0);
}

function renderDashboard(dashboard) {
  lastDashboard = dashboard;
  lastError = null;
  const { meta, summary, routes, nodes } = dashboard;
  document.title = meta.siteName || "TopoMari";
  elements.title.textContent = meta.mainTitle || meta.title || "TopoMari";
  if (elements.description) elements.description.setAttribute("content", meta.description || "");
  applySiteTheme(meta);
  applyThemeSettings(meta);
  setAutoThemeBeijing(meta.autoThemeBeijing === true);
  elements.sourceChip.dataset.mode = meta.mode;
  elements.sourceLabel.textContent = t("source.hybrid");
  const updatedTime = new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(meta.generatedAt));
  elements.updated.textContent = t("updated.at", { time: updatedTime });
  renderSummary(summary, routes || []);
  routeGlobe?.update(routes || []);
  renderRoutes(routes || []);
  renderLinkHealth(routes || []);
  renderNodes(nodes || []);
  elements.errorPanel.hidden = true;
  scheduleRefresh(Number(meta.refreshIntervalSeconds || 15));
}

function showError(error) {
  lastError = error;
  elements.sourceChip.dataset.mode = "error";
  elements.sourceLabel.textContent = t("source.hybrid");
  elements.errorMessage.textContent = error.message || String(error);
  elements.errorPanel.hidden = false;
  if (!lastDashboard) {
    elements.routes.innerHTML = `<div class="empty-state">${escapeHtml(t("empty.snapshot"))}</div>`;
    elements.links.innerHTML = `<div class="empty-state">${escapeHtml(t("empty.linkUnavailable"))}</div>`;
    elements.nodes.innerHTML = `<div class="empty-state">${escapeHtml(t("empty.nodeUnavailable"))}</div>`;
  }
}

function scheduleRefresh(seconds) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadDashboard, Math.max(5, seconds) * 1000);
}

async function loadDashboard() {
  if (loading) return;
  loading = true;
  if (elements.refreshButton) {
    elements.refreshButton.disabled = true;
    elements.refreshButton.classList.add("is-loading");
  }
  try {
    renderDashboard(await dashboardApi.snapshot());
  } catch (error) {
    showError(error);
    scheduleRefresh(15);
  } finally {
    loading = false;
    if (elements.refreshButton) {
      elements.refreshButton.disabled = false;
      elements.refreshButton.classList.remove("is-loading");
    }
  }
}

initPreferences();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadDashboard();
});

document.addEventListener("topomari:languagechange", () => {
  const activeError = lastError;
  if (lastDashboard) renderDashboard(lastDashboard);
  if (activeError) showError(activeError);
});

loadDashboard();
