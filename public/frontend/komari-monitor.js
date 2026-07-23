import { getLocale, t } from "./i18n.js?v=2.8.4-ui2";

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
  return values.map((value) => value === null ? "—" : value.toFixed(2)).join(" · ");
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

function meter(label, percent, detail) {
  const numeric = finiteNumber(percent);
  const clamped = numeric === null ? 0 : Math.min(100, Math.max(0, numeric));
  const state = numeric !== null && numeric >= 85 ? "danger" : numeric !== null && numeric >= 65 ? "warning" : "normal";
  const aria = numeric === null
    ? `aria-label="${escapeHtml(`${label}: ${t("komariMonitor.unavailable")}`)}"`
    : `role="meter" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${clamped}"`;
  return `
    <div class="komari-meter" data-state="${state}" ${aria}>
      <div class="komari-meter-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(detail)}</strong></div>
      <div class="komari-meter-track" aria-hidden="true"><i style="width:${clamped}%"></i></div>
    </div>`;
}

function renderNodeCard(node) {
  const online = node.status === "online";
  const offline = node.status === "offline";
  const statusKey = online ? "common.online" : offline ? "common.offline" : "common.noData";
  const flag = countryFlag(node.countryCode);
  const region = [node.region, node.countryName && node.countryName !== node.region ? node.countryName : ""]
    .filter(Boolean)
    .join(" · ");
  const platform = [node.os, node.arch].filter(Boolean).join(" ");
  const memoryDetail = node.memory?.usagePercent === null || node.memory?.usagePercent === undefined
    ? formatMonitorBytes(node.memory?.totalBytes)
    : `${formatPercent(node.memory?.usagePercent)} · ${formatMonitorBytes(node.memory?.usedBytes)} / ${formatMonitorBytes(node.memory?.totalBytes)}`;
  const diskDetail = node.disk?.usagePercent === null || node.disk?.usagePercent === undefined
    ? formatMonitorBytes(node.disk?.totalBytes)
    : `${formatPercent(node.disk?.usagePercent)} · ${formatMonitorBytes(node.disk?.usedBytes)} / ${formatMonitorBytes(node.disk?.totalBytes)}`;
  const trafficDetail = node.traffic?.limitBytes === null || node.traffic?.limitBytes === undefined
    ? formatMonitorBytes(node.traffic?.usedBytes)
    : `${formatPercent(node.traffic?.usagePercent)} · ${formatMonitorBytes(node.traffic?.usedBytes)} / ${formatMonitorBytes(node.traffic?.limitBytes)}`;
  const cpuDetail = node.cpu?.cores
    ? `${formatPercent(node.cpu?.usagePercent)} · ${t("komariMonitor.cores", { count: node.cpu.cores })}`
    : formatPercent(node.cpu?.usagePercent);

  return `
    <article class="komari-node-card ${online ? "" : offline ? "is-offline" : "is-unknown"}" data-telemetry="${node.telemetryAvailable ? "ready" : "unavailable"}">
      <header class="komari-node-header">
        <div class="komari-node-identity">
          <span class="komari-status-dot" aria-hidden="true"></span>
          <div><h3>${escapeHtml(node.name)}</h3><p>${escapeHtml([region, platform].filter(Boolean).join(" · ") || "Komari Agent")}</p></div>
        </div>
        <div class="komari-node-state"><span class="komari-country-flag" title="${escapeHtml(node.countryName || node.countryCode || "")}">${escapeHtml(flag)}</span><span>${escapeHtml(t(statusKey))}</span></div>
      </header>
      <div class="komari-metric-grid">
        ${meter(t("komariMonitor.cpu"), node.cpu?.usagePercent, cpuDetail)}
        ${meter(t("komariMonitor.memory"), node.memory?.usagePercent, memoryDetail)}
        ${meter(t("komariMonitor.disk"), node.disk?.usagePercent, diskDetail)}
        ${meter(t("komariMonitor.traffic"), node.traffic?.usagePercent, trafficDetail)}
      </div>
      <div class="komari-load-row"><span>${escapeHtml(t("komariMonitor.load"))}</span><strong>${escapeHtml(formatLoad(node.load))}</strong></div>
      <footer class="komari-node-footer">
        <span class="is-upload"><i aria-hidden="true">↑</i><strong>${escapeHtml(formatMonitorBytes(node.network?.uploadBytesPerSecond, { rate: true }))}</strong><small>${escapeHtml(t("komariMonitor.upload"))}</small></span>
        <span class="is-download"><i aria-hidden="true">↓</i><strong>${escapeHtml(formatMonitorBytes(node.network?.downloadBytesPerSecond, { rate: true }))}</strong><small>${escapeHtml(t("komariMonitor.download"))}</small></span>
        <span><strong>${escapeHtml(formatUptime(node.uptimeSeconds))}</strong><small>${escapeHtml(t("komariMonitor.uptime"))}</small></span>
        <span><strong>${escapeHtml(formatUpdatedAt(node.updatedAt))}</strong><small>${escapeHtml(node.telemetryAvailable ? t("komariMonitor.updated") : t("komariMonitor.unavailable"))}</small></span>
      </footer>
    </article>`;
}

export function renderKomariMonitor(overview, { container, summaryElement } = {}) {
  if (!container) return;
  const nodes = Array.isArray(overview?.nodes) ? overview.nodes : [];
  const summary = overview?.summary || {};
  if (summaryElement) {
    summaryElement.textContent = t("komariMonitor.onlineSummary", {
      online: Number(summary.online || 0),
      total: Number(summary.total || nodes.length),
    });
    summaryElement.dataset.state = String(overview?.state || "unavailable");
  }
  container.innerHTML = nodes.length
    ? nodes.map(renderNodeCard).join("")
    : `<div class="empty-state">${escapeHtml(t("komariMonitor.empty"))}</div>`;
}
