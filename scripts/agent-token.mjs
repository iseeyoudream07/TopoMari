#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  hashAgentToken,
  readAgentConfig,
  validateIdentifier,
  writeAgentConfig,
} from "../lib/agent-registry.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const configPath = resolve(process.env.AGENT_CONFIG_PATH || resolve(rootDir, "config", "agents.json"));

function usage() {
  console.log(`Usage:
  npm run agent:create -- <agent-id> <edge-id> [edge-id...]
  npm run agent:rotate -- <agent-id>
  npm run agent:revoke -- <agent-id>
  npm run agent:enable -- <agent-id>
  npm run agent:list
`);
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function printToken(agent, token) {
  console.log(`Agent: ${agent.id}`);
  console.log(`Allowed edges: ${agent.allowed_edges.join(", ")}`);
  console.log(`Token (shown once): ${token}`);
  console.log("Store this token securely. Only its SHA-256 hash was written to config/agents.json.");
}

const [command, rawAgentId, ...rawEdges] = process.argv.slice(2);
if (!command) {
  usage();
  process.exit(1);
}

const config = await readAgentConfig(configPath);

if (command === "list") {
  if (!config.agents.length) {
    console.log("No private probe agents are configured.");
  } else {
    for (const agent of config.agents) {
      console.log(`${agent.enabled ? "enabled " : "revoked "} ${agent.id} -> ${agent.allowed_edges.join(", ")}`);
    }
  }
  process.exit(0);
}

let agentId;
try {
  agentId = validateIdentifier(rawAgentId, "agent id");
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(1);
}

const existingIndex = config.agents.findIndex((agent) => agent.id === agentId);
const now = new Date().toISOString();

if (command === "create") {
  if (existingIndex >= 0) {
    console.error(`Agent ${agentId} already exists. Use agent:rotate or revoke it first.`);
    process.exit(1);
  }
  let edges;
  try {
    edges = [...new Set(rawEdges.map((edge) => validateIdentifier(edge, "edge id")))];
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!edges.length) {
    console.error("At least one allowed edge id is required.");
    process.exit(1);
  }
  const token = newToken();
  const agent = {
    id: agentId,
    token_hash: hashAgentToken(token),
    allowed_edges: edges,
    enabled: true,
    created_at: now,
    updated_at: now,
  };
  config.agents.push(agent);
  await writeAgentConfig(configPath, config);
  printToken(agent, token);
  process.exit(0);
}

if (existingIndex < 0) {
  console.error(`Agent ${agentId} does not exist.`);
  process.exit(1);
}

const agent = config.agents[existingIndex];
if (command === "rotate") {
  const token = newToken();
  agent.token_hash = hashAgentToken(token);
  agent.enabled = true;
  agent.updated_at = now;
  await writeAgentConfig(configPath, config);
  printToken(agent, token);
} else if (command === "revoke") {
  agent.enabled = false;
  agent.updated_at = now;
  await writeAgentConfig(configPath, config);
  console.log(`Revoked agent ${agentId}.`);
} else if (command === "enable") {
  agent.enabled = true;
  agent.updated_at = now;
  await writeAgentConfig(configPath, config);
  console.log(`Enabled agent ${agentId}. Its existing token remains valid.`);
} else {
  usage();
  process.exit(1);
}
