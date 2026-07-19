import { isIP } from "node:net";

const MAX_GEOIP_NODES = 256;
const MAX_LOOKUP_CONCURRENCY = 4;
const MAXMIND_PROVIDERS = new Set(["mmdb", "maxmind"]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function isPublicIpv4(value) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return false;
  }
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function isPublicIp(value) {
  const address = String(value || "").trim();
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;

  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  if (["::", "::1"].includes(normalized)) return false;
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return false;
  if (normalized.startsWith("2001:db8")) return false;
  return true;
}

export function selectPublicNodeIp(node) {
  for (const value of [node?.ipv4, node?.ipv6]) {
    const address = String(value || "").trim();
    if (isPublicIp(address)) return address;
  }
  return "";
}

export function normalizeGeoIpRecord(value) {
  const source = value?.data ?? value ?? {};
  const countryCode = String(
    source.ISOCode
      ?? source.isoCode
      ?? source.iso_code
      ?? source.countryCode
      ?? source.country_code
      ?? "",
  ).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;
  const countryName = String(source.Name ?? source.name ?? source.countryName ?? source.country_name ?? countryCode)
    .trim()
    .slice(0, 120) || countryCode;
  return { countryCode, countryName, locationSource: "maxmind" };
}

function publicStatusError(error) {
  const status = Number(error?.status) || 0;
  if (status === 401 || status === 403) return "api-key-rejected";
  if (status === 404) return "api-unsupported";
  if (status === 503) return "api-key-missing";
  return "komari-unavailable";
}

export class KomariGeoIpService {
  constructor({
    client,
    statusTtlMs = 60_000,
    locationTtlMs = 12 * 60 * 60_000,
    settleDelayMs = 750,
    now = () => Date.now(),
  } = {}) {
    this.client = client;
    this.statusTtlMs = Math.max(1_000, Number(statusTtlMs) || 60_000);
    this.locationTtlMs = Math.max(60_000, Number(locationTtlMs) || 12 * 60 * 60_000);
    this.settleDelayMs = Math.max(0, Number(settleDelayMs) || 0);
    this.now = now;
    this.statusCache = null;
    this.locationCache = new Map();
    this.lastResolvedCount = 0;
    this.lastSyncAt = "";
  }

  baseStatus() {
    return {
      komariConfigured: this.client?.configured === true,
      apiKeyConfigured: this.client?.apiKeyConfigured === true,
      upstreamEnabled: null,
      upstreamProvider: "",
      provider: "maxmind",
      ready: false,
      checkedAt: "",
      locatedNodes: this.lastResolvedCount,
      lastSyncAt: this.lastSyncAt,
      error: "",
    };
  }

  async status({ refresh = false } = {}) {
    const currentTime = this.now();
    if (!refresh && this.statusCache?.expiresAt > currentTime) {
      return { ...this.statusCache.value, locatedNodes: this.lastResolvedCount, lastSyncAt: this.lastSyncAt };
    }

    const status = this.baseStatus();
    if (!status.komariConfigured) {
      status.error = "komari-unconfigured";
    } else if (!status.apiKeyConfigured) {
      status.error = "api-key-missing";
    } else {
      try {
        const settings = await this.client.getGeoIpSettings();
        status.upstreamEnabled = settings.enabled === true;
        status.upstreamProvider = String(settings.provider || "").toLowerCase();
        status.ready = status.upstreamEnabled && MAXMIND_PROVIDERS.has(status.upstreamProvider);
        if (!status.upstreamEnabled) status.error = "geoip-disabled";
        else if (!status.ready) status.error = "provider-not-maxmind";
      } catch (error) {
        status.error = publicStatusError(error);
      }
    }
    status.checkedAt = new Date(currentTime).toISOString();
    this.statusCache = { value: status, expiresAt: currentTime + this.statusTtlMs };
    return { ...status };
  }

  async resolveNodeLocations() {
    const status = await this.status();
    if (!status.ready) return new Map();

    let inventory;
    try {
      inventory = asArray(await this.client.getNodeIpInventory()).slice(0, MAX_GEOIP_NODES);
    } catch {
      return new Map();
    }

    const results = new Map();
    const queue = inventory
      .map((node) => ({ id: String(node?.id || ""), ip: selectPublicNodeIp(node) }))
      .filter((node) => node.id && node.ip);
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        const cached = this.locationCache.get(item.id);
        if (cached?.ip === item.ip && cached.expiresAt > this.now()) {
          if (cached.location) results.set(item.id, cached.location);
          continue;
        }
        let location = null;
        try {
          location = normalizeGeoIpRecord(await this.client.lookupGeoIp(item.ip));
        } catch {
          location = null;
        }
        this.locationCache.set(item.id, {
          ip: item.ip,
          location,
          expiresAt: this.now() + this.locationTtlMs,
        });
        if (location) results.set(item.id, location);
      }
    };

    await Promise.all(Array.from(
      { length: Math.min(MAX_LOOKUP_CONCURRENCY, Math.max(1, queue.length)) },
      () => worker(),
    ));
    this.lastResolvedCount = results.size;
    this.lastSyncAt = new Date(this.now()).toISOString();
    return results;
  }

  async updateDatabase() {
    if (!this.client?.configured || !this.client?.apiKeyConfigured) {
      const error = new Error("Komari API key is required to update MaxMind GeoIP data");
      error.status = 503;
      throw error;
    }
    const previousSettings = await this.client.getGeoIpSettings();
    const previousProvider = String(previousSettings?.provider || "").toLowerCase();
    // Komari reloads on provider changes. If mmdb was already selected while
    // GeoIP was disabled, toggle through its empty provider to trigger that reload.
    const forceReload = previousSettings?.enabled !== true && MAXMIND_PROVIDERS.has(previousProvider);
    await this.client.configureMaxMindGeoIp({ forceReload });
    if (this.settleDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.settleDelayMs));
    }
    await this.client.updateGeoIpDatabase();
    this.locationCache.clear();
    this.statusCache = null;
    this.lastResolvedCount = 0;
    this.lastSyncAt = "";
    const status = await this.status({ refresh: true });
    if (!status.ready) {
      const error = new Error("Komari did not activate the MaxMind GeoIP provider");
      error.status = 502;
      throw error;
    }
    return status;
  }
}
