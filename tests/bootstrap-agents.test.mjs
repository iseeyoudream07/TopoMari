import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bootstrapPath = fileURLToPath(new URL("../scripts/bootstrap-agents.mjs", import.meta.url));

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
