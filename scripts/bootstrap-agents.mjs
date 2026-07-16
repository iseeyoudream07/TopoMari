#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { hashAgentToken, readAgentConfig, writeAgentConfig } from "../lib/agent-registry.mjs";
import { loadTopologyConfig } from "../lib/topology-service.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const configPath = resolve(process.env.AGENT_CONFIG_PATH || resolve(rootDir, "config", "agents.json"));
const topologyPath = resolve(process.env.TOPOLOGY_CONFIG_PATH || resolve(rootDir, "config", "topology.json"));
const topology = await loadTopologyConfig(topologyPath);
const definitions = new Map();

for (const edge of topology.routes.flatMap((route) => route.edges)) {
  if (!edge.probe_id || !edge.agent_id) continue;
  if (!definitions.has(edge.agent_id)) definitions.set(edge.agent_id, new Set());
  definitions.get(edge.agent_id).add(edge.probe_id);
}

if (!definitions.size) {
  console.error("No private probe edges with agent_id values were found in the topology.");
  process.exit(1);
}

const config = await readAgentConfig(configPath);
const existing = new Set(config.agents.map((agent) => agent.id));
const created = [];
const now = new Date().toISOString();

for (const [agentId, edgeSet] of [...definitions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  if (existing.has(agentId)) continue;
  const edges = [...edgeSet].sort();
  const token = randomBytes(32).toString("base64url");
  config.agents.push({
    id: agentId,
    token_hash: hashAgentToken(token),
    allowed_edges: edges,
    enabled: true,
    created_at: now,
    updated_at: now,
  });
  created.push({ agentId, edges, token });
}

if (created.length) await writeAgentConfig(configPath, config);

if (!created.length) {
  console.log("All private probe agents declared in the topology already exist. Tokens cannot be recovered; rotate one if needed.");
  process.exit(0);
}

console.log("Private probe tokens (shown once):");
for (const item of created) {
  console.log(`${item.agentId}\t${item.edges.join(",")}\t${item.token}`);
}
console.log("Store these tokens securely. Only SHA-256 hashes were saved.");
