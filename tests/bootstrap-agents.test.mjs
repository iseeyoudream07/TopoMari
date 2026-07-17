import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bootstrapPath = fileURLToPath(new URL("../scripts/bootstrap-agents.mjs", import.meta.url));
const recoverPath = fileURLToPath(new URL("../scripts/recover-agent-registry.mjs", import.meta.url));

test("bootstraps agents from private probes declared in the topology", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-bootstrap-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const topologyPath = join(directory, "topology.json");
  const agentsPath = join(directory, "agents.json");
  await writeFile(
    topologyPath,
    `${JSON.stringify({
      title: "Bootstrap test",
      routes: [
        {
          id: "example",
          nodes: [
            { id: "relay" },
            { id: "exit" },
            { id: "internet" },
          ],
          edges: [
            { from: "relay", to: "exit", probe_id: "relay-to-exit", agent_id: "shared-agent" },
            { from: "exit", to: "internet", probe_id: "exit-to-internet", agent_id: "shared-agent" },
          ],
        },
      ],
    }, null, 2)}\n`,
  );

  const environment = {
    ...process.env,
    TOPOLOGY_CONFIG_PATH: topologyPath,
    AGENT_CONFIG_PATH: agentsPath,
  };
  const first = spawnSync(process.execPath, [bootstrapPath], { encoding: "utf8", env: environment });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /shared-agent/);

  const config = JSON.parse(await readFile(agentsPath, "utf8"));
  assert.equal(config.agents.length, 1);
  assert.equal(config.agents[0].id, "shared-agent");
  assert.deepEqual(config.agents[0].allowed_edges, ["exit-to-internet", "relay-to-exit"]);
  assert.match(config.agents[0].token_hash, /^[a-f0-9]{64}$/);

  const second = spawnSync(process.execPath, [bootstrapPath], { encoding: "utf8", env: environment });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /already exist/);
});

test("recovers missing Agents without overwriting newer token hashes", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-recover-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "previous-agents.json");
  const destinationPath = join(directory, "agents.json");
  const baseAgent = (id, tokenHash, edges) => ({
    id,
    token_hash: tokenHash,
    allowed_edges: edges,
    enabled: true,
  });
  await writeFile(sourcePath, `${JSON.stringify({
    version: 1,
    agents: [
      baseAgent("old-agent", "b".repeat(64), ["old-edge"]),
      baseAgent("shared-agent", "c".repeat(64), ["shared-two"]),
      baseAgent("new-agent", "d".repeat(64), ["stale-edge"]),
    ],
  })}\n`);
  await writeFile(destinationPath, `${JSON.stringify({
    version: 1,
    agents: [
      baseAgent("new-agent", "a".repeat(64), ["new-edge"]),
      baseAgent("shared-agent", "c".repeat(64), ["shared-one"]),
    ],
  })}\n`);

  const result = spawnSync(process.execPath, [recoverPath, sourcePath], {
    encoding: "utf8",
    env: { ...process.env, AGENT_CONFIG_PATH: destinationPath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Recovered Agents added: 1 \(old-agent\)/);
  assert.match(result.stderr, /Skipped 1 Agent token conflict/);

  const recovered = JSON.parse(await readFile(destinationPath, "utf8"));
  const agents = new Map(recovered.agents.map((agent) => [agent.id, agent]));
  assert.equal(agents.get("new-agent").token_hash, "a".repeat(64));
  assert.deepEqual(agents.get("new-agent").allowed_edges, ["new-edge"]);
  assert.deepEqual(agents.get("shared-agent").allowed_edges.sort(), ["shared-one", "shared-two"]);
  assert.equal(agents.get("old-agent").token_hash, "b".repeat(64));
});
