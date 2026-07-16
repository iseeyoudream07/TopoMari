import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function validateIdentifier(value, label = "identifier") {
  const normalized = String(value || "").trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`${label} must match ${ID_PATTERN}`);
  }
  return normalized;
}

export function hashAgentToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function normalizeAgent(agent) {
  const id = validateIdentifier(agent?.id, "agent id");
  const tokenHash = String(agent?.token_hash || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
    throw new Error(`Agent ${id} has an invalid token_hash`);
  }
  const allowedEdges = [...new Set((agent.allowed_edges || []).map((edge) => validateIdentifier(edge, "edge id")))];
  if (!allowedEdges.length) throw new Error(`Agent ${id} must allow at least one edge`);
  return {
    id,
    token_hash: tokenHash,
    allowed_edges: allowedEdges,
    enabled: agent.enabled !== false,
    created_at: agent.created_at || null,
    updated_at: agent.updated_at || null,
  };
}

export function normalizeAgentConfig(payload) {
  const source = Array.isArray(payload?.agents) ? payload.agents : [];
  const agents = source.map(normalizeAgent);
  const ids = new Set();
  for (const agent of agents) {
    if (ids.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
    ids.add(agent.id);
  }
  return { version: 1, agents };
}

export async function readAgentConfig(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return normalizeAgentConfig(JSON.parse(text));
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, agents: [] };
    throw error;
  }
}

export async function writeAgentConfig(filePath, config) {
  const normalized = normalizeAgentConfig(config);
  const absolute = resolve(filePath);
  const temporary = `${absolute}.tmp`;
  await mkdir(dirname(absolute), { recursive: true });
  // Token hashes stay private to the owner and the dedicated dashboard group.
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o640 });
  await rename(temporary, absolute);
}

function secureHashEqual(leftHex, rightHex) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicAgent(agent) {
  if (!agent) return null;
  return {
    id: agent.id,
    allowedEdges: [...agent.allowed_edges],
    enabled: agent.enabled,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  };
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

export class AgentRegistry {
  constructor(filePath, { reloadIntervalMs = 1000 } = {}) {
    this.filePath = resolve(filePath);
    this.reloadIntervalMs = Math.max(0, Number(reloadIntervalMs) || 0);
    this.lastCheckedAt = 0;
    this.lastModifiedAt = -1;
    this.agents = new Map();
    this.mutation = Promise.resolve();
  }

  async reload(force = false) {
    const now = Date.now();
    if (!force && now - this.lastCheckedAt < this.reloadIntervalMs) return;
    this.lastCheckedAt = now;

    let modifiedAt = 0;
    try {
      modifiedAt = (await stat(this.filePath)).mtimeMs;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!force && modifiedAt === this.lastModifiedAt) return;

    const config = await readAgentConfig(this.filePath);
    this.agents = new Map(config.agents.map((agent) => [agent.id, agent]));
    this.lastModifiedAt = modifiedAt;
  }

  async authenticate(agentId, token) {
    await this.reload();
    const normalizedId = String(agentId || "").trim();
    const agent = this.agents.get(normalizedId);
    if (!agent || !agent.enabled || !token) return null;
    const presentedHash = hashAgentToken(token);
    return secureHashEqual(agent.token_hash, presentedHash) ? agent : null;
  }

  async list() {
    await this.reload();
    return [...this.agents.values()].map(publicAgent);
  }

  async get(agentId) {
    await this.reload();
    return publicAgent(this.agents.get(String(agentId || "").trim()));
  }

  async issueToken(agentId, allowedEdges, { rotateExisting = false } = {}) {
    const id = validateIdentifier(agentId, "agent id");
    const edges = [...new Set((allowedEdges || []).map((edge) => validateIdentifier(edge, "edge id")))];
    if (!edges.length) throw new Error(`Agent ${id} must allow at least one edge`);

    return await this.runMutation(async (config) => {
      const now = new Date().toISOString();
      const existing = config.agents.find((agent) => agent.id === id);
      if (existing && !rotateExisting) {
        throw conflict(`Agent ${id} already exists. Confirm token rotation to continue.`);
      }
      const token = randomBytes(32).toString("base64url");
      const updated = normalizeAgent({
        id,
        token_hash: hashAgentToken(token),
        allowed_edges: existing ? [...existing.allowed_edges, ...edges] : edges,
        enabled: true,
        created_at: existing?.created_at || now,
        updated_at: now,
      });
      if (existing) Object.assign(existing, updated);
      else config.agents.push(updated);
      return { token, agent: publicAgent(updated) };
    });
  }

  async setEnabled(agentId, enabled) {
    const id = validateIdentifier(agentId, "agent id");
    return await this.runMutation(async (config) => {
      const agent = config.agents.find((item) => item.id === id);
      if (!agent) {
        const error = new Error(`Agent ${id} was not found`);
        error.status = 404;
        throw error;
      }
      agent.enabled = Boolean(enabled);
      agent.updated_at = new Date().toISOString();
      return publicAgent(agent);
    });
  }

  async runMutation(callback) {
    const work = async () => {
      const config = await readAgentConfig(this.filePath);
      const result = await callback(config);
      await writeAgentConfig(this.filePath, config);
      await this.reload(true);
      return result;
    };
    const result = this.mutation.then(work, work);
    this.mutation = result.catch(() => {});
    return await result;
  }
}
