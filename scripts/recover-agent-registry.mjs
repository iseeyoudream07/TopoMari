#!/usr/bin/env node

import { chmod, chown, copyFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAgentConfig, writeAgentConfig } from "../lib/agent-registry.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const sourceArgument = process.argv[2];
if (!sourceArgument) {
  console.error("Usage: node scripts/recover-agent-registry.mjs <previous-agents.json>");
  process.exit(1);
}

const sourcePath = resolve(sourceArgument);
const destinationPath = resolve(process.env.AGENT_CONFIG_PATH || resolve(rootDir, "config", "agents.json"));
if (sourcePath === destinationPath) {
  console.error("The recovery source must differ from the active Agent registry.");
  process.exit(1);
}

let destinationStat = null;
try {
  await stat(sourcePath);
  destinationStat = await stat(destinationPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
} catch (error) {
  console.error(`Unable to read the recovery source: ${error.message}`);
  process.exit(1);
}

const [source, destination] = await Promise.all([
  readAgentConfig(sourcePath),
  readAgentConfig(destinationPath),
]);
if (!source.agents.length) {
  console.error("The recovery source does not contain any Agents.");
  process.exit(1);
}

const destinationById = new Map(destination.agents.map((agent) => [agent.id, agent]));
const added = [];
const extended = [];
const conflicts = [];
const now = new Date().toISOString();

for (const sourceAgent of source.agents) {
  const current = destinationById.get(sourceAgent.id);
  if (!current) {
    destination.agents.push(sourceAgent);
    destinationById.set(sourceAgent.id, sourceAgent);
    added.push(sourceAgent.id);
    continue;
  }
  if (current.token_hash !== sourceAgent.token_hash) {
    conflicts.push(sourceAgent.id);
    continue;
  }
  const combinedEdges = [...new Set([...current.allowed_edges, ...sourceAgent.allowed_edges])];
  if (combinedEdges.length !== current.allowed_edges.length) {
    current.allowed_edges = combinedEdges;
    current.updated_at = now;
    extended.push(current.id);
  }
}

if (added.length || extended.length) {
  if (destinationStat) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const backupPath = `${destinationPath}.before-recovery-${stamp}.json`;
    await copyFile(destinationPath, backupPath);
    await chmod(backupPath, 0o640);
  }
  await writeAgentConfig(destinationPath, destination);
  if (destinationStat && typeof process.getuid === "function" && process.getuid() === 0) {
    await chown(destinationPath, destinationStat.uid, destinationStat.gid);
    await chmod(destinationPath, destinationStat.mode & 0o777);
  }
}

console.log(`Recovered Agents added: ${added.length}${added.length ? ` (${added.join(", ")})` : ""}`);
console.log(`Existing Agents with restored edge permissions: ${extended.length}${extended.length ? ` (${extended.join(", ")})` : ""}`);
if (conflicts.length) {
  console.warn(
    `Skipped ${conflicts.length} Agent token conflict(s): ${conflicts.join(", ")}. `
      + "The active registry was kept; re-enroll only those Agents if they are not reporting.",
  );
}
