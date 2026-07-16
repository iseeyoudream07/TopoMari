import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeTopologyConfig } from "./topology-config.mjs";

export class TopologyRevisionConflict extends Error {
  constructor(message = "Topology changed in another browser. Reload it and try again.") {
    super(message);
    this.name = "TopologyRevisionConflict";
    this.status = 409;
  }
}

function serialize(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function revisionOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class TopologyConfigStore {
  constructor(filePath) {
    this.filePath = resolve(filePath instanceof URL ? fileURLToPath(filePath) : filePath);
    this.mutation = Promise.resolve();
  }

  async read() {
    const raw = await readFile(this.filePath, "utf8");
    const config = sanitizeTopologyConfig(JSON.parse(raw));
    const canonical = serialize(config);
    return { config, revision: revisionOf(canonical) };
  }

  async write(config, expectedRevision) {
    const work = async () => {
      const current = await this.read();
      if (!expectedRevision || expectedRevision !== current.revision) {
        throw new TopologyRevisionConflict();
      }
      const normalized = sanitizeTopologyConfig(config);
      const body = serialize(normalized);
      const temporary = `${this.filePath}.${randomBytes(6).toString("hex")}.tmp`;
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporary, body, { mode: 0o640 });
      await rename(temporary, this.filePath);
      return { config: normalized, revision: revisionOf(body) };
    };
    const result = this.mutation.then(work, work);
    this.mutation = result.catch(() => {});
    return await result;
  }
}
