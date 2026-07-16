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
  constructor({ baseUrl, cookie = "", authorization = "", timeoutMs = 8000 } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.cookie = cookie;
    this.authorization = authorization;
    this.timeoutMs = Number(timeoutMs) || 8000;
  }

  get configured() {
    return Boolean(this.baseUrl);
  }

  async request(pathname) {
    if (!this.configured) {
      throw new KomariError("Komari is not configured", 503);
    }

    const url = new URL(pathname.replace(/^\//, ""), this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers = {
      Accept: "application/json",
      "User-Agent": "TopoMari/2.4",
    };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.authorization) headers.Authorization = this.authorization;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
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
        throw new KomariError(`Komari request timed out after ${this.timeoutMs}ms`, 504);
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
