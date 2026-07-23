import { getLocale, t } from "./i18n.js?v=2.8.4-ui5";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatMonitorBytes(value, { rate = false } = {}) {
  const number = finiteNumber(value);
  if (number === null || number < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let amount = number;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const digits = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2;
  const formatted = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(amount);
  return `${formatted} ${units[unit]}${rate ? "/s" : ""}`;
}

function formatPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return "—";
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(number)}%`;
}

function formatLoad(load) {
  const values = [load?.one, load?.five, load?.fifteen].map(finiteNumber);
  if (values.every((value) => value === null)) return "—";
  return values.map((value) => value === null ? "—" : value.toFixed(2)).join(", ");
}

function formatUptime(value) {
  const seconds = finiteNumber(value);
  if (seconds === null || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return t("komariMonitor.uptimeDays", { count: days });
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return t("komariMonitor.uptimeHours", { count: hours });
  return t("komariMonitor.uptimeMinutes", { count: Math.max(0, Math.floor(seconds / 60)) });
}

function formatOnlineUptime(value) {
  const uptime = formatUptime(value);
  const online = t("komariMonitor.online");
  return getLocale().startsWith("zh") ? `${online} ${uptime}` : `${uptime} ${online}`;
}

function formatUpdatedAt(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function countryFlag(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((character) => 127397 + character.charCodeAt(0)));
}

function nodeCountryCode(node) {
  const explicit = String(node?.countryCode || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  const tokens = [node?.region, node?.countryName, node?.name]
    .filter(Boolean)
    .join(" ")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  return tokens.find((token) => /^[A-Z]{2}$/.test(token)) || "";
}

function statusRank(status) {
  return {
    healthy: 1,
    unknown: 2,
    unconfigured: 3,
    warning: 4,
    degraded: 5,
    failed: 6,
  }[String(status || "unknown")] || 0;
}

function healthLookupKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function buildKomariNodeHealth(routes = []) {
  const lookup = new Map();
  for (const route of routes || []) {
    const routeNodes = Array.isArray(route?.nodes) ? route.nodes : [];
    const edges = Array.isArray(route?.edges) ? route.edges : [];
    edges.forEach((edge, index) => {
      const stats = edge?.stats || {};
      const sourceId = edge?.source_uuid || edge?.task?.clients?.[0] || routeNodes[index]?.id;
      const sourceNode = routeNodes.find((node) => String(node?.id || "") === String(sourceId || ""));
      const keys = [sourceId, sourceNode?.id, sourceNode?.name, sourceNode?.label]
        .map(healthLookupKey)
        .filter(Boolean);
      if (!keys.length) return;

      const candidate = {
        latency: finiteNumber(stats.latest ?? stats.avg),
        loss: finiteNumber(stats.loss),
        history: Array.isArray(stats.history) ? stats.history.slice(-24) : [],
        status: String(stats.status || "unknown"),
      };
      const candidateScore = statusRank(candidate.status) * 1_000
        + candidate.history.length
        + (candidate.latency === null ? 0 : 100);
      for (const key of keys) {
        const current = lookup.get(key);
        const currentScore = current
          ? statusRank(current.status) * 1_000 + current.history.length + (current.latency === null ? 0 : 100)
          : -1;
        if (candidateScore > currentScore) lookup.set(key, candidate);
      }
    });
  }
  return lookup;
}

function nodeHealth(node, lookup) {
  return lookup.get(healthLookupKey(node?.id))
    || lookup.get(healthLookupKey(node?.name))
    || { latency: null, loss: null, history: [], status: "unknown" };
}

function osMark(value) {
  const os = String(value || "").trim();
  const normalized = os.toLowerCase();
  if (normalized.includes("windows")) {
    return `<span class="komari-os-mark is-windows" title="${escapeHtml(os)}" aria-label="${escapeHtml(os)}"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 3.2 8 2.3v6.1H2zm7-1.1 7-1v7.3H9zM2 9.4h6v6.2l-6-.9zm7 0h7v7.4l-7-1z"/></svg></span>`;
  }
  if (normalized.includes("ubuntu")) {
    return `<span class="komari-os-mark is-ubuntu" title="${escapeHtml(os)}" aria-label="${escapeHtml(os)}"><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="4.1"/><circle cx="9" cy="2.5" r="1.45"/><circle cx="3.4" cy="12.2" r="1.45"/><circle cx="14.6" cy="12.2" r="1.45"/></svg></span>`;
  }
  return `<span class="komari-os-mark" title="${escapeHtml(os || "Linux")}" aria-label="${escapeHtml(os || "Linux")}"><svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.25" y="3" width="13.5" height="12" rx="3"/><path d="m5.2 7 2 2-2 2M9 11h3.8"/></svg></span>`;
}

function metricDetail(used, total) {
  return `${formatMonitorBytes(used)} / ${formatMonitorBytes(total)}`;
}

function meter(label, percent, detail, { unlimited = false } = {}) {
  const numeric = finiteNumber(percent);
  const clamped = numeric === null ? 0 : Math.min(100, Math.max(0, numeric));
  const state = numeric !== null && numeric >= 85 ? "danger" : numeric !== null && numeric >= 65 ? "warning" : "normal";
  const aria = numeric === null
    ? `aria-label="${escapeHtml(`${label}: ${t("komariMonitor.unavailable")}`)}"`
    : `role="meter" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${clamped}"`;
  return `
    <div class="komari-meter" data-state="${state}" ${aria}>
      <div class="komari-meter-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(unlimited && numeric === null ? "∞" : formatPercent(numeric))}</strong></div>
      <div class="komari-meter-track" aria-hidden="true"><i style="width:${clamped}%"></i></div>
      <small>${escapeHtml(detail)}</small>
    </div>`;
}

function healthBarClass(value, { latency = false, baseline = 0 } = {}) {
  if (value === null) return "is-lost";
  if (!latency) return "is-good";
  if (value >= Math.max(250, baseline * 2.2)) return "is-bad";
  if (value >= Math.max(150, baseline * 1.55)) return "is-warning";
  return "is-good";
}

function renderLatencyBars(health) {
  const history = Array.isArray(health?.history) ? health.history.slice(-24) : [];
  const values = history.map((item) => finiteNumber(item?.value));
  const successful = values.filter((value) => value !== null);
  const baseline = successful.length
    ? successful.reduce((sum, value) => sum + value, 0) / successful.length
    : finiteNumber(health?.latency) || 0;
  const min = successful.length ? Math.min(...successful) : 0;
  const max = successful.length ? Math.max(...successful) : min;
  const range = Math.max(1, max - min);
  const padded = Array.from({ length: Math.max(0, 24 - values.length) }, () => undefined).concat(values);
  return padded.map((value) => {
    if (value === undefined) return '<i class="is-empty"></i>';
    const height = value === null ? 100 : Math.round(42 + ((value - min) / range) * 58);
    return `<i class="${healthBarClass(value, { latency: true, baseline })}" style="height:${height}%"></i>`;
  }).join("");
}

function renderLossBars(health) {
  const history = Array.isArray(health?.history) ? health.history.slice(-24) : [];
  if (history.length) {
    const padded = Array.from({ length: Math.max(0, 24 - history.length) }, () => undefined).concat(history);
    return padded.map((item) => {
      if (item === undefined) return '<i class="is-empty"></i>';
      return `<i class="${healthBarClass(finiteNumber(item?.value))}"></i>`;
    }).join("");
  }
  const loss = finiteNumber(health?.loss);
  if (loss === null) return Array.from({ length: 24 }, () => '<i class="is-empty"></i>').join("");
  const lostBars = Math.round(Math.min(100, loss) / 100 * 24);
  return Array.from({ length: 24 }, (_, index) => `<i class="${index >= 24 - lostBars ? "is-lost" : "is-good"}"></i>`).join("");
}

function renderHealthPanel(label, value, bars, kind) {
  return `
    <div class="komari-health-panel" data-kind="${kind}">
      <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      <span class="komari-health-bars" aria-hidden="true">${bars}</span>
    </div>`;
}

function renderNodeCard(node, health) {
  const online = node.status === "online";
  const offline = node.status === "offline";
  const statusKey = online ? "common.online" : offline ? "common.offline" : "common.noData";
  const countryCode = nodeCountryCode(node);
  const flag = countryFlag(countryCode);
  const memoryDetail = metricDetail(node.memory?.usedBytes, node.memory?.totalBytes);
  const diskDetail = metricDetail(node.disk?.usedBytes, node.disk?.totalBytes);
  const trafficDetail = node.traffic?.limitBytes === null || node.traffic?.limitBytes === undefined
    ? `${formatMonitorBytes(node.traffic?.usedBytes)} / ∞`
    : metricDetail(node.traffic?.usedBytes, node.traffic?.limitBytes);
  const cpuDetail = formatLoad(node.load);
  const platform = [node.os, node.arch].filter(Boolean).join(" · ") || "Komari Agent";
  const state = t(statusKey);
  const latency = formatMonitorLatency(health?.latency);
  const loss = formatPercent(health?.loss);

  return `
    <article class="komari-node-card ${online ? "" : offline ? "is-offline" : "is-unknown"}" data-telemetry="${node.telemetryAvailable ? "ready" : "unavailable"}" aria-label="${escapeHtml(`${node.name}, ${state}`)}">
      <header class="komari-node-header">
        <div class="komari-node-identity">
          <span class="komari-status-dot" aria-hidden="true"></span>
          <h3>${escapeHtml(node.name)}</h3>
        </div>
        <div class="komari-node-state">${osMark(node.os)}<span class="komari-country-flag" title="${escapeHtml(node.countryName || countryCode)}">${escapeHtml(flag)}</span><span class="visually-hidden">${escapeHtml(state)}</span></div>
      </header>
      <div class="komari-node-tags">
        <span>${escapeHtml(formatOnlineUptime(node.uptimeSeconds))}</span>
        <span title="${escapeHtml(platform)}">${escapeHtml(platform)}</span>
      </div>
      <div class="komari-metric-grid">
        ${meter(t("komariMonitor.cpu"), node.cpu?.usagePercent, cpuDetail)}
        ${meter(t("komariMonitor.memory"), node.memory?.usagePercent, memoryDetail)}
        ${meter(t("komariMonitor.disk"), node.disk?.usagePercent, diskDetail)}
        ${meter(t("komariMonitor.traffic"), node.traffic?.usagePercent, trafficDetail, { unlimited: true })}
      </div>
      <div class="komari-compact-panels">
        <div class="komari-compact-panel is-rate">
          <span><i aria-hidden="true">⌃</i>${escapeHtml(formatMonitorBytes(node.network?.uploadBytesPerSecond, { rate: true }))}</span>
          <span><i aria-hidden="true">⌄</i>${escapeHtml(formatMonitorBytes(node.network?.downloadBytesPerSecond, { rate: true }))}</span>
        </div>
        <div class="komari-compact-panel is-total">
          <span title="${escapeHtml(t("komariMonitor.totalUpload"))}"><i aria-hidden="true">↥</i>${escapeHtml(formatMonitorBytes(node.network?.totalUploadBytes))}</span>
          <span title="${escapeHtml(t("komariMonitor.totalDownload"))}"><i aria-hidden="true">↧</i>${escapeHtml(formatMonitorBytes(node.network?.totalDownloadBytes))}</span>
        </div>
        <div class="komari-compact-panel is-load" title="${escapeHtml(t("komariMonitor.load"))}">
          <span>${escapeHtml(finiteNumber(node.load?.one)?.toFixed(2) || "—")}</span>
          <span>${escapeHtml([node.load?.five, node.load?.fifteen].map((value) => finiteNumber(value)?.toFixed(2) || "—").join(" / "))}</span>
        </div>
      </div>
      <div class="komari-health-grid">
        ${renderHealthPanel(t("komariMonitor.latency"), latency, renderLatencyBars(health), "latency")}
        ${renderHealthPanel(t("komariMonitor.loss"), loss, renderLossBars(health), "loss")}
      </div>
      <span class="visually-hidden">${escapeHtml(`${t("komariMonitor.updated")}: ${formatUpdatedAt(node.updatedAt)}`)}</span>
    </article>`;
}

function formatMonitorLatency(value) {
  const number = finiteNumber(value);
  if (number === null) return "—";
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: number < 10 ? 1 : 0 }).format(number)} ms`;
}

export function renderKomariMonitor(overview, { container, summaryElement, routes = [] } = {}) {
  if (!container) return;
  const nodes = Array.isArray(overview?.nodes) ? overview.nodes : [];
  const summary = overview?.summary || {};
  const healthLookup = buildKomariNodeHealth(routes);
  if (summaryElement) {
    summaryElement.textContent = t("komariMonitor.onlineSummary", {
      online: Number(summary.online || 0),
      total: Number(summary.total || nodes.length),
    });
    summaryElement.dataset.state = String(overview?.state || "unavailable");
  }
  container.innerHTML = nodes.length
    ? nodes.map((node) => renderNodeCard(node, nodeHealth(node, healthLookup))).join("")
    : `<div class="empty-state">${escapeHtml(t("komariMonitor.empty"))}</div>`;
}
