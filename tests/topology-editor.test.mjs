import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry } from "../lib/agent-registry.mjs";
import { ProbeStore } from "../lib/probe-store.mjs";
import { sanitizeTopologyConfig } from "../lib/topology-config.mjs";
import { TopologyConfigStore, TopologyRevisionConflict } from "../lib/topology-config-store.mjs";

const indexUrl = new URL("../public/index.html", import.meta.url);
const editorUrl = new URL("../public/editor.js", import.meta.url);
const stylesUrl = new URL("../public/styles.css", import.meta.url);
const installerUrl = new URL("../public/agent/install.sh", import.meta.url);
const probeAgentUrl = new URL("../public/agent/probe_agent.py", import.meta.url);

function sampleConfig() {
  return {
    title: "Editor test",
    subtitle: "Safe config",
    refresh_interval_seconds: 15,
    history_hours: 1,
    browser_secret: "must-not-survive",
    routes: [
      {
        id: "test-route",
        name: "Test route",
        nodes: [
          { id: "client", label: "Local", type: "client", ip: "192.0.2.1" },
          { id: "relay", label: "Relay", type: "server", raw: { password: "secret" } },
          { id: "internet", label: "Internet", type: "target" },
        ],
        edges: [
          {
            from: "client",
            to: "relay",
            source_uuid: "relay",
            task_ids: [1, 2],
            task_group_name: "Komari",
            target_host: "198.51.100.10",
          },
          {
            from: "relay",
            to: "internet",
            source_uuid: "relay",
            probe_id: "relay-egress",
            probe_name: "Private",
            agent_id: "relay-agent",
            token: "plain-token",
          },
        ],
      },
    ],
  };
}

test("topology editor whitelist removes target addresses and arbitrary secrets", () => {
  const normalized = sanitizeTopologyConfig(sampleConfig());
  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes("198.51.100.10"), false);
  assert.equal(serialized.includes("192.0.2.1"), false);
  assert.equal(serialized.includes("plain-token"), false);
  assert.equal(serialized.includes("must-not-survive"), false);
  assert.equal(normalized.routes[0].edges[1].agent_id, "relay-agent");
});

test("editor bindings point to unique elements in the shipped page", async () => {
  const [html, script] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(editorUrl, "utf8"),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML ids must be unique");
  const referenced = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(referenced.filter((id) => !ids.includes(id)), []);
  assert.match(html, /aria-controls="topology-manager"/);
});

test("route library constrains long names to its grid column", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  assert.match(styles, /\.route-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.route-list-item\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /\.route-list-item\s*\{[^}]*max-width:\s*100%/s);
  assert.match(styles, /\.route-list-item\s*\{[^}]*overflow:\s*hidden/s);
});

test("probe installer verifies the first report and one-shot failures exit nonzero", async () => {
  const installer = await readFile(installerUrl, "utf8");
  assert.match(installer, /probe_agent\.py" --config "\$CONFIG_FILE" --once/);
  assert.match(installer, /systemctl is-active --quiet komari-topology-agent\.service/);

  const probeAgentPath = fileURLToPath(probeAgentUrl);
  const python = `
import importlib.util
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("probe_agent", ${JSON.stringify(probeAgentPath)})
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
agent.load_config = lambda _path: {"interval_seconds": 30, "timeout_seconds": 5}

def fail(_config):
    raise RuntimeError("submit failed")

agent.run_cycle = fail
sys.argv = ["probe_agent.py", "--config", "ignored", "--once"]
assert agent.main() == 1
agent.run_cycle = lambda _config: None
assert agent.main() == 0

class Connection:
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False

agent.socket.create_connection = lambda *_args, **_kwargs: Connection()
sample = agent.measure_tcp({"edge_id": "relay-egress", "host": "example.test", "port": 443}, 5)
assert sample["success"] is True
assert "timestamp" not in sample
`;
  const result = spawnSync("python3", ["-c", python], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("topology writes are atomic and reject stale revisions", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-editor-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "topology.json");
  await writeFile(filePath, `${JSON.stringify(sampleConfig(), null, 2)}\n`);
  const store = new TopologyConfigStore(filePath);
  const first = await store.read();
  const updated = clone(first.config);
  updated.routes[0].name = "Updated route";
  const result = await store.write(updated, first.revision);
  assert.equal(result.config.routes[0].name, "Updated route");
  await assert.rejects(() => store.write(first.config, first.revision), TopologyRevisionConflict);
  assert.equal((await readFile(filePath, "utf8")).includes("target_host"), false);
});

test("agent enrollment issues a token once and supports explicit rotation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-enrollment-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const registry = new AgentRegistry(join(directory, "agents.json"), { reloadIntervalMs: 0 });
  const first = await registry.issueToken("relay-agent", ["relay-egress"]);
  assert.equal((await registry.authenticate("relay-agent", first.token)).id, "relay-agent");
  await assert.rejects(
    () => registry.issueToken("relay-agent", ["relay-exit"]),
    (error) => error.status === 409,
  );
  const rotated = await registry.issueToken("relay-agent", ["relay-exit"], { rotateExisting: true });
  assert.equal(await registry.authenticate("relay-agent", first.token), null);
  assert.deepEqual(rotated.agent.allowedEdges.sort(), ["relay-egress", "relay-exit"]);
  assert.equal((await registry.authenticate("relay-agent", rotated.token)).id, "relay-agent");
  assert.equal((await registry.setEnabled("relay-agent", false)).enabled, false);
  assert.equal(await registry.authenticate("relay-agent", rotated.token), null);
});

test("enrollment codes are single-use, expiring, and store rotation intent", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "komari-code-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  let now = Date.parse("2026-07-16T00:00:00Z");
  const store = new ProbeStore({ filePath: join(directory, "probes.db"), now: () => now });
  context.after(() => store.close());

  const enrollment = store.createEnrollment("relay-agent", "relay-egress", { rotateExisting: true });
  const consumed = store.consumeEnrollment(enrollment.code);
  assert.deepEqual(consumed, {
    agentId: "relay-agent",
    edgeId: "relay-egress",
    rotateExisting: true,
    expiresAt: enrollment.expiresAt,
  });
  assert.equal(store.consumeEnrollment(enrollment.code), null);

  const expired = store.createEnrollment("relay-agent", "relay-egress");
  now += 16 * 60_000;
  assert.equal(store.consumeEnrollment(expired.code), null);
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
