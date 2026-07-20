import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry } from "../lib/agent-registry.mjs";
import { ProbeStore } from "../lib/probe-store.mjs";
import {
  sanitizeBranding,
  sanitizeSiteSettings,
  sanitizeThemeSettings,
  sanitizeTopologyConfig,
  sanitizeVisualThemeSettings,
} from "../lib/topology-config.mjs";
import { TopologyConfigStore, TopologyRevisionConflict } from "../lib/topology-config-store.mjs";

const adminIndexUrl = new URL("../public/admin/index.html", import.meta.url);
const editorUrl = new URL("../public/editor.js", import.meta.url);
const stylesUrl = new URL("../public/styles.css", import.meta.url);
const installerUrl = new URL("../public/agent/install.sh", import.meta.url);
const agentUpdaterUrl = new URL("../public/agent/update.sh", import.meta.url);
const dashboardUpdaterUrl = new URL("../scripts/update-dashboard.sh", import.meta.url);
const dashboardUninstallerUrl = new URL("../scripts/uninstall-dashboard.sh", import.meta.url);
const dockerfileUrl = new URL("../Dockerfile", import.meta.url);
const probeAgentUrl = new URL("../public/agent/probe_agent.py", import.meta.url);

function sampleConfig() {
  return {
    site_name: "TopoMari site",
    title: "Editor test",
    description: "A private topology overview",
    auto_theme_beijing: true,
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
          { id: "relay", label: "Relay", type: "server", latitude: 35.6762, longitude: 139.6503, raw: { password: "secret" } },
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
  assert.equal(normalized.site_name, "TopoMari site");
  assert.equal(normalized.description, "A private topology overview");
  assert.equal(normalized.auto_theme_beijing, true);
  assert.equal(normalized.visual_theme, "topomari");
  assert.equal(normalized.custom_theme_colors, false);
  assert.equal(normalized.theme_colors.light_background, "#eeede5");
  assert.equal(normalized.routes[0].nodes[1].latitude, 35.6762);
  assert.equal(normalized.routes[0].nodes[1].longitude, 139.6503);
});

test("topology node coordinates must be complete and within globe bounds", () => {
  const incomplete = sampleConfig();
  delete incomplete.routes[0].nodes[1].longitude;
  assert.throws(() => sanitizeTopologyConfig(incomplete), /latitude and longitude must be configured together/);

  const invalid = sampleConfig();
  invalid.routes[0].nodes[1].latitude = 91;
  assert.throws(() => sanitizeTopologyConfig(invalid), /node latitude must be between -90 and 90/);
});

test("site settings sanitize the public metadata and Beijing theme option", () => {
  assert.deepEqual(sanitizeSiteSettings({}), {
    siteName: "TopoMari",
    description: "Multi-hop latency and packet-loss visibility",
    autoThemeBeijing: false,
    visualTheme: "topomari",
    customThemeColors: false,
    themeColors: {
      lightBackground: "#eeede5",
      lightAccent: "#a7622d",
      darkBackground: "#1c1b19",
      darkAccent: "#e4a35f",
    },
    themeSettings: {
      backgroundEnabled: false,
      backgroundType: "image",
      lightBackground: "",
      darkBackground: "",
      backgroundBlur: 0,
      backgroundOverlay: 0,
      glassBlur: 18,
      glassOpacity: 78,
      glassBorder: 18,
      cornerRadius: 18,
    },
    geoIp: {
      enabled: false,
      provider: "maxmind",
      lastUpdatedAt: "",
    },
  });
  assert.deepEqual(sanitizeSiteSettings({
    site_name: "  My site  ",
    description: "  My description  ",
    auto_theme_beijing: true,
  }), {
    siteName: "My site",
    description: "My description",
    autoThemeBeijing: true,
    visualTheme: "topomari",
    customThemeColors: false,
    themeColors: {
      lightBackground: "#eeede5",
      lightAccent: "#a7622d",
      darkBackground: "#1c1b19",
      darkAccent: "#e4a35f",
    },
    themeSettings: {
      backgroundEnabled: false,
      backgroundType: "image",
      lightBackground: "",
      darkBackground: "",
      backgroundBlur: 0,
      backgroundOverlay: 0,
      glassBlur: 18,
      glassOpacity: 78,
      glassBorder: 18,
      cornerRadius: 18,
    },
    geoIp: {
      enabled: false,
      provider: "maxmind",
      lastUpdatedAt: "",
    },
  });
});

test("GeoIP settings only persist the local enablement and MaxMind metadata", () => {
  const normalized = sanitizeTopologyConfig({
    ...sampleConfig(),
    geo_ip_enabled: true,
    geo_ip_provider: "untrusted-provider",
    geo_ip_last_updated_at: "2026-07-19T02:03:04Z",
    geo_ip_api_key: "must-not-survive",
  });
  assert.equal(normalized.geo_ip_enabled, true);
  assert.equal(normalized.geo_ip_provider, "maxmind");
  assert.equal(normalized.geo_ip_last_updated_at, "2026-07-19T02:03:04.000Z");
  assert.equal(JSON.stringify(normalized).includes("must-not-survive"), false);
});

test("visual theme settings whitelist presets and six-digit colors", () => {
  assert.deepEqual(sanitizeVisualThemeSettings({
    visualTheme: "glassmorphism",
    customThemeColors: true,
    themeColors: {
      lightBackground: "#ABCDEF",
      lightAccent: "javascript:alert(1)",
      darkBackground: "#101827",
      darkAccent: "#12abefcc",
    },
  }), {
    visualTheme: "glassmorphism",
    customThemeColors: true,
    themeColors: {
      lightBackground: "#abcdef",
      lightAccent: "#059669",
      darkBackground: "#101827",
      darkAccent: "#34d399",
    },
  });

  assert.equal(sanitizeVisualThemeSettings({ visual_theme: "unknown" }).visualTheme, "topomari");
  assert.equal(sanitizeVisualThemeSettings({ custom_theme_colors: true, customThemeColors: false }).customThemeColors, false);
  assert.equal(sanitizeSiteSettings({ auto_theme_beijing: true, autoThemeBeijing: false }).autoThemeBeijing, false);
});

test("theme detail settings validate sources and clamp visual controls", () => {
  assert.deepEqual(sanitizeThemeSettings({
    background_enabled: true,
    background_type: "video",
    light_background: "local:light",
    dark_background: "https://example.com/background.webm",
    background_blur: 99,
    background_overlay: -140,
    glass_blur: -2,
    glass_opacity: 12,
    glass_border: 140,
    corner_radius: 90,
  }), {
    backgroundEnabled: true,
    backgroundType: "video",
    lightBackground: "local:light",
    darkBackground: "https://example.com/background.webm",
    backgroundBlur: 40,
    backgroundOverlay: -100,
    glassBlur: 0,
    glassOpacity: 45,
    glassBorder: 100,
    cornerRadius: 28,
  });
  assert.equal(sanitizeThemeSettings({ lightBackground: "javascript:alert(1)" }).lightBackground, "");
  assert.equal(sanitizeThemeSettings({ darkBackground: "https://user:pass@example.com/a.png" }).darkBackground, "");
  assert.equal(sanitizeThemeSettings({ darkBackground: "/assets/night.webp" }).darkBackground, "/assets/night.webp");
});

test("branding keeps separate safe defaults for the browser title and page heading", () => {
  assert.deepEqual(sanitizeBranding({}), { siteName: "TopoMari", mainTitle: "TopoMari" });
  assert.deepEqual(sanitizeBranding({ siteName: "  My site  ", mainTitle: "  My dashboard  " }), {
    siteName: "My site",
    mainTitle: "My dashboard",
  });
  assert.deepEqual(sanitizeBranding({ siteName: "", mainTitle: "" }), {
    siteName: "TopoMari",
    mainTitle: "TopoMari",
  });
});

test("editor bindings point to unique elements in the shipped page", async () => {
  const [html, script] = await Promise.all([
    readFile(adminIndexUrl, "utf8"),
    readFile(editorUrl, "utf8"),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML ids must be unique");
  const referenced = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  const optionalStandaloneControls = new Set(["manager-toggle", "manager-close"]);
  assert.deepEqual(referenced.filter((id) => !ids.includes(id) && !optionalStandaloneControls.has(id)), []);
  assert.match(html, /id="topology-manager"/);
  assert.match(html, /data-admin-panel="routes"/);
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
  assert.match(installer, /Type=notify/);
  assert.match(installer, /WatchdogSec=120/);

  const probeAgentPath = fileURLToPath(probeAgentUrl);
  const python = `
import importlib.util
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("probe_agent", ${JSON.stringify(probeAgentPath)})
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
agent.load_config = lambda _path: {"interval_seconds": 30, "timeout_seconds": 5}
notifications = []
agent.systemd_notify = notifications.append

def fail(_config):
    raise RuntimeError("submit failed")

agent.run_cycle = fail
sys.argv = ["probe_agent.py", "--config", "ignored", "--once"]
assert agent.main() == 1
agent.run_cycle = lambda _config: None
assert agent.main() == 0
assert any(message.startswith("READY=1") for message in notifications)
assert any(message.startswith("WATCHDOG=1") for message in notifications)
assert any(message.startswith("STOPPING=1") for message in notifications)

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

test("Agent and dashboard lifecycle scripts preserve credentials and runtime state", async () => {
  const [agentUpdater, dashboardUpdater, dashboardUninstaller, dockerfile] = await Promise.all([
    readFile(agentUpdaterUrl, "utf8"),
    readFile(dashboardUpdaterUrl, "utf8"),
    readFile(dashboardUninstallerUrl, "utf8"),
    readFile(dockerfileUrl, "utf8"),
  ]);
  assert.match(agentUpdater, /--config "\$CONFIG_FILE" --once/);
  assert.match(agentUpdater, /Existing config, token, targets, and Agent ID were preserved/);
  assert.doesNotMatch(agentUpdater, /enrollment-code/);
  assert.match(agentUpdater, /WatchdogSec=120/);

  assert.match(dashboardUpdater, /tar -C "\$PROJECT_DIR" -czf "\$BACKUP_FILE" \.env config data/);
  assert.match(dashboardUpdater, /git -C "\$PROJECT_DIR" pull --ff-only/);
  assert.match(dashboardUpdater, /umask 077\s+tar -C "\$PROJECT_DIR" -czf "\$BACKUP_FILE" \.env config data/s);
  assert.match(dashboardUpdater, /umask 022\s+git -C "\$PROJECT_DIR" pull --ff-only/s);
  assert.match(dashboardUpdater, /AGENT_HASH_AFTER_PULL/);
  assert.match(dashboardUpdater, /probe history exists but config\/agents\.json is missing/);
  assert.match(dashboardUninstaller, /Refusing to uninstall from unsafe project path/);
  assert.match(dashboardUninstaller, /tar -C "\$PROJECT_DIR" -czf "\$RUNTIME_BACKUP"/);
  assert.match(dashboardUninstaller, /\.env config data/);
  assert.match(dashboardUninstaller, /\.uninstalled-\$TIMESTAMP/);
  assert.match(dashboardUninstaller, /docker compose[^\n]+ down/);
  assert.doesNotMatch(dashboardUninstaller, /docker compose[^\n]+ down[^\n]+-v/);
  assert.doesNotMatch(dashboardUninstaller, /rm -rf/);
  assert.match(dockerfile, /COPY --chown=node:node package\.json server\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node public \.\/public/);
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
  let now = Date.parse("2026-07-16T00:00:00Z");
  const store = new ProbeStore({ filePath: join(directory, "probes.db"), now: () => now });
  context.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

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
