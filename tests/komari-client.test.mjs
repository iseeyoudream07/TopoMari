import test from "node:test";
import assert from "node:assert/strict";
import { KomariClient, selectNodeTargetHost } from "../lib/komari-client.mjs";

test("selects a valid IPv4 target before falling back to unbracketed IPv6", () => {
  assert.equal(selectNodeTargetHost({ ipv4: "8.8.8.8", ipv6: "2606:4700:4700::1111" }), "8.8.8.8");
  assert.equal(selectNodeTargetHost({ ipv4: "not-an-ip", ipv6: " [2606:4700:4700::1111] " }), "2606:4700:4700::1111");
  assert.equal(selectNodeTargetHost({ IPv4: "1.1.1.1", IPv6: "[2001:4860:4860::8888]" }), "1.1.1.1");
  assert.equal(selectNodeTargetHost({ ipv4: "999.1.1.1", ipv6: "not-an-ip" }), "");
  assert.equal(selectNodeTargetHost({}), "");
});

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
        { uuid: "node-a", ipv4: "8.8.8.8", ipv6: "2606:4700:4700::1111", token: "upstream-node-token" },
        { uuid: "node-b", ipv4: "invalid", ipv6: "[2001:4860:4860::8888]", token: "second-node-token" },
        { uuid: "node-c", ipv4: "", ipv6: "invalid" },
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

  assert.deepEqual(inventory, [
    { id: "node-a", targetHost: "8.8.8.8", ipv4: "8.8.8.8", ipv6: "2606:4700:4700::1111" },
    { id: "node-b", targetHost: "2001:4860:4860::8888", ipv4: "", ipv6: "2001:4860:4860::8888" },
    { id: "node-c", targetHost: "", ipv4: "", ipv6: "" },
  ]);
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

test("requests recent node reports from the encoded public Komari path", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let capturedRequest;
  globalThis.fetch = async (url, options = {}) => {
    capturedRequest = { url: String(url), options };
    return new Response(JSON.stringify({
      status: "success",
      data: [{ uuid: "node/a b", cpu_usage: 12.5 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const client = new KomariClient({ baseUrl: "https://status.example.com/", apiKey: "recent-report-key" });
  const reports = await client.getRecentNodeReports(" node/a b ");

  assert.deepEqual(reports, [{ uuid: "node/a b", cpu_usage: 12.5 }]);
  assert.equal(capturedRequest.url, "https://status.example.com/api/recent/node%2Fa%20b");
  assert.equal(capturedRequest.options.method, "GET");
  assert.equal(capturedRequest.options.headers.Authorization, "Bearer recent-report-key");
  assert.equal(capturedRequest.url.includes("recent-report-key"), false);
});
