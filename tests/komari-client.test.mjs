import test from "node:test";
import assert from "node:assert/strict";
import { KomariClient } from "../lib/komari-client.mjs";

test("retries Komari PostgreSQL ping queries without task_id", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("task_id=")) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Failed to fetch ping records: ERROR: operator does not exist: text ->> unknown (SQLSTATE 42883)",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          records: [{ task_id: 1, time: "2026-07-16T01:00:00Z", value: 59 }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const client = new KomariClient({ baseUrl: "https://status.example.com/" });
  const payload = await client.getPingRecords({ uuid: "node-a", taskId: 1, hours: 1 });
  assert.equal(payload.records[0].value, 59);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /task_id=1/);
  assert.doesNotMatch(urls[1], /task_id=/);
});

test("uses the Komari API key for admin GeoIP calls and sanitizes node inventory", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const pathname = new URL(url).pathname;
    if (pathname === "/api/admin/client/list") {
      return new Response(JSON.stringify([
        { uuid: "node-a", ipv4: "8.8.8.8", ipv6: "", token: "upstream-node-token" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (pathname === "/api/admin/settings/") {
      return new Response(JSON.stringify({
        status: "success",
        data: { geo_ip_enabled: true, geo_ip_provider: "mmdb", api_key: "upstream-api-key" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = new KomariClient({
    baseUrl: "https://status.example.com/",
    apiKey: "test-admin-key",
  });
  const inventory = await client.getNodeIpInventory();
  const settings = await client.getGeoIpSettings();
  await client.configureMaxMindGeoIp({ forceReload: true });
  await client.updateGeoIpDatabase();

  assert.deepEqual(inventory, [{ id: "node-a", ipv4: "8.8.8.8", ipv6: "" }]);
  assert.deepEqual(settings, { enabled: true, provider: "mmdb" });
  assert.equal(JSON.stringify(inventory).includes("upstream-node-token"), false);
  assert.ok(requests.every((request) => request.options.headers.Authorization === "Bearer test-admin-key"));
  const settingsUpdates = requests.filter((request) => request.options.method === "POST" && request.url.endsWith("/api/admin/settings/"));
  assert.deepEqual(settingsUpdates.map((request) => JSON.parse(request.options.body)), [{
    geo_ip_enabled: true,
    geo_ip_provider: "empty",
  }, {
    geo_ip_enabled: true,
    geo_ip_provider: "mmdb",
  }]);
  assert.ok(requests.some((request) => request.url.endsWith("/api/admin/update/mmdb")));
});
