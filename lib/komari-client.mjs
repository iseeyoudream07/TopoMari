export class KomariError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.name = "KomariError";
    this.status = status;
    this.details = details;
  }
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("KOMARI_BASE_URL must use http:// or https://");
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url.toString();
}

function normalizeApiKey(value) {
  const key = String(value || "").trim();
  return key.toLowerCase().startsWith("bearer ") ? key.slice(7).trim() : key;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

export function unwrapKomariPayload(payload) {
  if (payload && typeof payload === "object" && payload.status === "error") {
    throw new KomariError(payload.message || "Komari returned an error", 502, payload);
  }
  if (payload && typeof payload === "object" && Object.hasOwn(payload, "data")) {
    return payload.data;
  }
  return payload;
}

export class KomariClient {
  constructor({ baseUrl, cookie = "", authorization = "", apiKey = "", timeoutMs = 8000 } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.cookie = cookie;
    this.authorization = authorization;
    this.apiKey = normalizeApiKey(apiKey);
    this.timeoutMs = Number(timeoutMs) || 8000;
  }

  get configured() {
    return Boolean(this.baseUrl);
  }

  get apiKeyConfigured() {
    return Boolean(this.apiKey || /^Bearer\s+\S/i.test(String(this.authorization || "").trim()));
  }

  get adminAuthorization() {
    if (this.apiKey) return `Bearer ${this.apiKey}`;
    const authorization = String(this.authorization || "").trim();
    return /^Bearer\s+\S/i.test(authorization) ? authorization : "";
  }

  setApiKey(value) {
    this.apiKey = normalizeApiKey(value);
  }

  async request(pathname, {
    method = "GET",
    body,
    admin = false,
    timeoutMs = this.timeoutMs,
  } = {}) {
    if (!this.configured) {
      throw new KomariError("Komari is not configured", 503);
    }
    if (admin && !this.adminAuthorization) {
      throw new KomariError("Komari API key is not configured", 503);
    }

    const url = new URL(pathname.replace(/^\//, ""), this.baseUrl);
    const controller = new AbortController();
    const requestTimeoutMs = Math.max(1, Number(timeoutMs) || this.timeoutMs);
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    const headers = {
      Accept: "application/json",
      "User-Agent": "TopoMari/2.8.4",
    };
    if (this.cookie) headers.Cookie = this.cookie;
    const authorization = admin ? this.adminAuthorization : this.authorization || this.adminAuthorization;
    if (authorization) headers.Authorization = authorization;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "follow",
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new KomariError(
          `Komari returned a non-JSON response (${response.status})`,
          502,
          text.slice(0, 300),
        );
      }

      if (!response.ok) {
        throw new KomariError(
          payload?.message || `Komari request failed (${response.status})`,
          response.status,
          payload,
        );
      }
      return unwrapKomariPayload(payload);
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new KomariError(`Komari request timed out after ${requestTimeoutMs}ms`, 504);
      }
      if (error instanceof KomariError) throw error;
      throw new KomariError(`Unable to reach Komari: ${error.message}`, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  getNodes() {
    return this.request("/api/nodes");
  }

  getPingTasks() {
    return this.request("/api/task/ping");
  }

  async getNodeIpInventory() {
    const payload = await this.request("/api/admin/client/list", { admin: true });
    const candidates = payload?.nodes ?? payload?.clients ?? payload;
    return asArray(candidates)
      .map((node) => ({
        id: String(node?.uuid ?? node?.UUID ?? node?.id ?? node?.client_id ?? node?.node_id ?? ""),
        ipv4: String(node?.ipv4 ?? node?.IPv4 ?? "").trim(),
        ipv6: String(node?.ipv6 ?? node?.IPv6 ?? "").trim(),
      }))
      .filter((node) => node.id);
  }

  async getGeoIpSettings() {
    const payload = await this.request("/api/admin/settings/", { admin: true });
    return {
      enabled: payload?.geo_ip_enabled === true || String(payload?.geo_ip_enabled).toLowerCase() === "true",
      provider: String(payload?.geo_ip_provider || "").trim().toLowerCase(),
    };
  }

  async configureMaxMindGeoIp({ forceReload = false } = {}) {
    if (forceReload) {
      await this.request("/api/admin/settings/", {
        method: "POST",
        body: {
          geo_ip_enabled: true,
          geo_ip_provider: "empty",
        },
        admin: true,
      });
    }
    return this.request("/api/admin/settings/", {
      method: "POST",
      body: {
        geo_ip_enabled: true,
        geo_ip_provider: "mmdb",
      },
      admin: true,
    });
  }

  lookupGeoIp(ip) {
    const query = new URLSearchParams({ ip: String(ip || "") });
    return this.request(`/api/admin/test/geoip?${query.toString()}`, { admin: true });
  }

  updateGeoIpDatabase() {
    return this.request("/api/admin/update/mmdb", {
      method: "POST",
      admin: true,
      timeoutMs: Math.max(this.timeoutMs, 60_000),
    });
  }

  async getPingRecords({ uuid, taskId, hours = 1, allTasks = false }) {
    const query = new URLSearchParams({
      uuid: String(uuid || ""),
      hours: String(hours || 1),
    });
    if (!allTasks && taskId !== undefined && taskId !== null && taskId !== "") {
      query.set("task_id", String(taskId));
    }
    try {
      return await this.request(`/api/records/ping?${query.toString()}`);
    } catch (error) {
      const brokenPostgresTaskFilter =
        !allTasks &&
        taskId !== undefined &&
        /operator does not exist:\s*text\s*->>|SQLSTATE\s*42883/i.test(String(error?.message || ""));
      if (!brokenPostgresTaskFilter) throw error;
      query.delete("task_id");
      return await this.request(`/api/records/ping?${query.toString()}`);
    }
  }

  getAllPingRecords({ uuid, hours = 1 }) {
    return this.getPingRecords({ uuid, hours, allTasks: true });
  }
}
