const DEFAULT_REPORT_CONCURRENCY = 6;
const MAX_MONITOR_NODES = 256;
const MAX_RECENT_REPORTS = 512;
const ONLINE_REPORT_THRESHOLD_MS = 10 * 60_000;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function firstValue(object, keys, fallback = null) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  return fallback;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function timestampOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return null;
  const milliseconds = parsed < 100_000_000_000 ? parsed * 1_000 : parsed;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function percentOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(Math.min(100, number) * 10) / 10;
}

function percentage(used, total) {
  if (used === null || total === null || total <= 0) return null;
  return Math.round(Math.min(100, Math.max(0, (used / total) * 100)) * 10) / 10;
}

function hiddenNode(raw) {
  const hidden = firstValue(raw, ["hidden", "Hidden", "is_hidden"], false);
  return hidden === true || hidden === 1 || String(hidden).toLowerCase() === "true";
}

function nodeStatus(raw) {
  const explicit = firstValue(raw, ["online", "is_online", "connected"]);
  if (typeof explicit === "boolean") return explicit ? "online" : "offline";
  if (typeof explicit === "number") return explicit > 0 ? "online" : "offline";
  const status = String(firstValue(raw, ["status", "state"], "")).toLowerCase();
  if (["online", "up", "connected", "active"].includes(status)) return "online";
  if (["offline", "down", "disconnected", "inactive"].includes(status)) return "offline";
  return "unknown";
}

function safeCountry(location) {
  const countryCode = String(location?.countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return {};
  return {
    countryCode,
    countryName: String(location?.countryName || countryCode).trim().slice(0, 120) || countryCode,
  };
}

export function normalizeKomariMonitorNodes(payload, locations = new Map()) {
  const candidates = payload?.nodes ?? payload?.clients ?? payload;
  const locationMap = locations instanceof Map ? locations : new Map(Object.entries(locations || {}));
  return asArray(candidates)
    .filter((raw) => !hiddenNode(raw))
    .slice(0, MAX_MONITOR_NODES)
    .map((raw) => {
      const id = String(firstValue(raw, ["uuid", "UUID", "id", "client_id", "node_id"], "")).trim();
      if (!id) return null;
      const name = String(firstValue(raw, ["name", "client_name", "custom_name", "display_name"], id.slice(0, 8)))
        .trim()
        .slice(0, 160) || id.slice(0, 8);
      return {
        id,
        name,
        region: String(firstValue(raw, ["region", "location", "country", "group"], "")).trim().slice(0, 160),
        os: String(firstValue(raw, ["os", "system", "platform"], "")).trim().slice(0, 80),
        arch: String(firstValue(raw, ["arch", "architecture"], "")).trim().slice(0, 40),
        status: nodeStatus(raw),
        cpuCores: numberOrNull(firstValue(raw, ["cpu_cores", "cpuCores", "cores"])),
        memoryTotal: numberOrNull(firstValue(raw, ["mem_total", "memory_total", "ram_total"])),
        diskTotal: numberOrNull(firstValue(raw, ["disk_total", "storage_total"])),
        trafficLimit: numberOrNull(firstValue(raw, ["traffic_limit", "trafficLimit"])),
        ...safeCountry(locationMap.get(id)),
      };
    })
    .filter(Boolean);
}

function latestReport(payload) {
  const source = payload?.records ?? payload?.reports ?? payload;
  const candidates = (!Array.isArray(source) && source && typeof source === "object"
    && (source.cpu || source.ram || source.memory || source.network)
    ? [source]
    : asArray(source)).slice(-MAX_RECENT_REPORTS);
  if (!candidates.length) return null;
  return candidates.reduce((latest, report) => {
    if (!latest) return report;
    const latestTime = Date.parse(timestampOrNull(firstValue(latest, ["updated_at", "updatedAt", "timestamp", "time"])) || "") || 0;
    const reportTime = Date.parse(timestampOrNull(firstValue(report, ["updated_at", "updatedAt", "timestamp", "time"])) || "") || 0;
    return reportTime >= latestTime ? report : latest;
  }, null);
}

export function normalizeKomariRecentReport(payload, node = {}) {
  const report = latestReport(payload);
  if (!report) return null;

  const cpu = report.cpu || {};
  const ram = report.ram || report.memory || {};
  const disk = report.disk || report.storage || {};
  const network = report.network || {};
  const load = report.load || {};
  const memoryUsed = numberOrNull(firstValue(ram, ["used", "used_bytes"], firstValue(report, ["memory_used", "mem_used"])));
  const memoryTotal = numberOrNull(firstValue(ram, ["total", "total_bytes"], node.memoryTotal));
  const diskUsed = numberOrNull(firstValue(disk, ["used", "used_bytes"], firstValue(report, ["disk_used"])));
  const diskTotal = numberOrNull(firstValue(disk, ["total", "total_bytes"], node.diskTotal));
  const totalUpload = numberOrNull(firstValue(network, ["totalUp", "total_up", "totalUpload"], firstValue(report, ["total_up", "traffic_up"])));
  const totalDownload = numberOrNull(firstValue(network, ["totalDown", "total_down", "totalDownload"], firstValue(report, ["total_down", "traffic_down"])));
  const trafficUsed = totalUpload === null && totalDownload === null
    ? null
    : (totalUpload || 0) + (totalDownload || 0);

  return {
    updatedAt: timestampOrNull(firstValue(report, ["updated_at", "updatedAt", "timestamp", "time"])),
    uptimeSeconds: numberOrNull(firstValue(report, ["uptime", "uptime_seconds"])),
    cpu: {
      usagePercent: percentOrNull(firstValue(cpu, ["usage", "usage_percent"], firstValue(report, ["cpu_usage", "cpu"]))),
      cores: node.cpuCores ?? null,
    },
    memory: {
      usedBytes: memoryUsed,
      totalBytes: memoryTotal,
      usagePercent: percentage(memoryUsed, memoryTotal),
    },
    disk: {
      usedBytes: diskUsed,
      totalBytes: diskTotal,
      usagePercent: percentage(diskUsed, diskTotal),
    },
    network: {
      uploadBytesPerSecond: numberOrNull(firstValue(network, ["up", "upload", "uploadBytesPerSecond"], firstValue(report, ["network_up", "upload"]))),
      downloadBytesPerSecond: numberOrNull(firstValue(network, ["down", "download", "downloadBytesPerSecond"], firstValue(report, ["network_down", "download"]))),
      totalUploadBytes: totalUpload,
      totalDownloadBytes: totalDownload,
    },
    traffic: {
      usedBytes: trafficUsed,
      limitBytes: node.trafficLimit ?? null,
      usagePercent: percentage(trafficUsed, node.trafficLimit ?? null),
    },
    load: {
      one: numberOrNull(firstValue(load, ["load1", "one"], firstValue(report, ["load1"]))),
      five: numberOrNull(firstValue(load, ["load5", "five"], firstValue(report, ["load5"]))),
      fifteen: numberOrNull(firstValue(load, ["load15", "fifteen"], firstValue(report, ["load15"]))),
    },
  };
}

function resolvedNodeStatus(node, telemetry, now) {
  if (node.status !== "unknown") return node.status;
  const updatedAt = Date.parse(String(telemetry?.updatedAt || ""));
  if (!Number.isFinite(updatedAt)) return "unknown";
  return now - updatedAt <= ONLINE_REPORT_THRESHOLD_MS ? "online" : "offline";
}

function publicNode(node, telemetry, now) {
  const {
    cpuCores: _cpuCores,
    memoryTotal: _memoryTotal,
    diskTotal: _diskTotal,
    trafficLimit: _trafficLimit,
    ...safeNode
  } = node;
  const status = resolvedNodeStatus(node, telemetry, now);
  return telemetry
    ? { ...safeNode, status, telemetryAvailable: true, ...telemetry }
    : {
        ...safeNode,
        status,
        telemetryAvailable: false,
        updatedAt: null,
        uptimeSeconds: null,
        cpu: { usagePercent: null, cores: node.cpuCores ?? null },
        memory: { usedBytes: null, totalBytes: node.memoryTotal ?? null, usagePercent: null },
        disk: { usedBytes: null, totalBytes: node.diskTotal ?? null, usagePercent: null },
        network: {
          uploadBytesPerSecond: null,
          downloadBytesPerSecond: null,
          totalUploadBytes: null,
          totalDownloadBytes: null,
        },
        traffic: { usedBytes: null, limitBytes: node.trafficLimit ?? null, usagePercent: null },
        load: { one: null, five: null, fifteen: null },
      };
}

export async function buildKomariOverview({
  nodePayload,
  client,
  locations,
  concurrency = DEFAULT_REPORT_CONCURRENCY,
  now = Date.now(),
}) {
  const inventory = normalizeKomariMonitorNodes(nodePayload, locations);
  const nodes = new Array(inventory.length);
  let cursor = 0;
  let unavailable = 0;

  const worker = async () => {
    while (cursor < inventory.length) {
      const index = cursor++;
      const node = inventory[index];
      let telemetry = null;
      try {
        if (typeof client?.getRecentNodeReports === "function") {
          telemetry = normalizeKomariRecentReport(await client.getRecentNodeReports(node.id), node);
        }
      } catch {
        telemetry = null;
      }
      if (!telemetry) unavailable += 1;
      nodes[index] = publicNode(node, telemetry, now);
    }
  };

  const workerCount = Math.min(
    Math.max(1, Math.round(Number(concurrency) || DEFAULT_REPORT_CONCURRENCY)),
    Math.max(1, inventory.length),
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const online = nodes.filter((node) => node.status === "online").length;
  const offline = nodes.filter((node) => node.status === "offline").length;
  return {
    state: unavailable === 0 ? "ready" : unavailable === nodes.length && nodes.length ? "unavailable" : "partial",
    generatedAt: new Date().toISOString(),
    summary: { total: nodes.length, online, offline, unknown: nodes.length - online - offline },
    nodes,
  };
}

export function buildDemoKomariOverview(nodes, now = Date.now()) {
  const tick = now / 10_000;
  const unique = [...new Map((nodes || []).map((node) => [node.id, node])).values()];
  const monitorNodes = unique.map((node, index) => {
    const phase = index * 0.83 + String(node.id).length * 0.11;
    const cpu = Math.round((18 + Math.sin(tick + phase) * 12 + index * 2) * 10) / 10;
    const memoryPercent = Math.round((36 + Math.cos(tick * 0.6 + phase) * 9 + index * 3) * 10) / 10;
    const diskPercent = Math.min(88, 28 + index * 9);
    const memoryTotal = 2 * 1024 ** 3;
    const diskTotal = 40 * 1024 ** 3;
    const totalUpload = (24 + index * 11) * 1024 ** 3;
    const totalDownload = (52 + index * 17) * 1024 ** 3;
    const trafficLimit = 1_000 * 1024 ** 3;
    return {
      id: node.id,
      name: node.name,
      region: node.region || "",
      os: node.os || "Linux",
      arch: "amd64",
      status: node.online === false ? "offline" : "online",
      ...(node.countryCode ? { countryCode: node.countryCode, countryName: node.countryName || node.countryCode } : {}),
      telemetryAvailable: true,
      updatedAt: new Date(now).toISOString(),
      uptimeSeconds: 86_400 * (index + 3),
      cpu: { usagePercent: Math.max(0, cpu), cores: 2 + (index % 3) * 2 },
      memory: { usedBytes: memoryTotal * memoryPercent / 100, totalBytes: memoryTotal, usagePercent: memoryPercent },
      disk: { usedBytes: diskTotal * diskPercent / 100, totalBytes: diskTotal, usagePercent: diskPercent },
      network: {
        uploadBytesPerSecond: 4_096 * (index + 1),
        downloadBytesPerSecond: 12_288 * (index + 1),
        totalUploadBytes: totalUpload,
        totalDownloadBytes: totalDownload,
      },
      traffic: {
        usedBytes: totalUpload + totalDownload,
        limitBytes: trafficLimit,
        usagePercent: percentage(totalUpload + totalDownload, trafficLimit),
      },
      load: { one: 0.12 + index * 0.04, five: 0.09 + index * 0.03, fifteen: 0.06 + index * 0.02 },
    };
  });
  const online = monitorNodes.filter((node) => node.status === "online").length;
  return {
    state: "ready",
    generatedAt: new Date(now).toISOString(),
    summary: { total: monitorNodes.length, online, offline: monitorNodes.length - online, unknown: 0 },
    nodes: monitorNodes,
  };
}
