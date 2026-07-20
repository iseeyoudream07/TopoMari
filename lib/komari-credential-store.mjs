import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const MAX_API_KEY_LENGTH = 4096;

export function normalizeKomariApiKey(value) {
  const key = String(value || "").trim();
  const normalized = key.toLowerCase().startsWith("bearer ") ? key.slice(7).trim() : key;
  if (normalized.length > MAX_API_KEY_LENGTH) {
    const error = new Error(`Komari API key cannot exceed ${MAX_API_KEY_LENGTH} characters`);
    error.status = 400;
    throw error;
  }
  if (/\r|\n/.test(normalized)) {
    const error = new Error("Komari API key must be a single line");
    error.status = 400;
    throw error;
  }
  return normalized;
}

export class KomariCredentialStore {
  constructor(filePath, { fallbackApiKey = "" } = {}) {
    this.filePath = filePath;
    this.fallbackApiKey = normalizeKomariApiKey(fallbackApiKey);
    this.managedApiKey = "";
  }

  get apiKey() {
    return this.managedApiKey || this.fallbackApiKey;
  }

  get managed() {
    return Boolean(this.managedApiKey);
  }

  state() {
    return {
      configured: Boolean(this.apiKey),
      managed: this.managed,
    };
  }

  async reload() {
    try {
      this.managedApiKey = normalizeKomariApiKey(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.managedApiKey = "";
    }
    return this.state();
  }

  async set(value) {
    const apiKey = normalizeKomariApiKey(value);
    if (!apiKey) {
      const error = new Error("Komari API key is required");
      error.status = 400;
      throw error;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, `${apiKey}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch((error) => {
      if (error?.code !== "ENOSYS" && error?.code !== "EINVAL") throw error;
    });
    this.managedApiKey = apiKey;
    return this.state();
  }

  async clear() {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.managedApiKey = "";
    return this.state();
  }
}
