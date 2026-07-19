import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicIp,
  KomariGeoIpService,
  normalizeGeoIpRecord,
  selectPublicNodeIp,
} from "../lib/komari-geoip.mjs";

test("accepts public node addresses while rejecting private and documentation ranges", () => {
  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
  assert.equal(isPublicIp("10.0.0.1"), false);
  assert.equal(isPublicIp("192.168.1.1"), false);
  assert.equal(isPublicIp("203.0.113.7"), false);
  assert.equal(isPublicIp("2001:db8::1"), false);
  assert.equal(selectPublicNodeIp({ ipv4: "10.0.0.1", ipv6: "2606:4700:4700::1111" }), "2606:4700:4700::1111");
});

test("normalizes only country-level MaxMind output", () => {
  assert.deepEqual(normalizeGeoIpRecord({ ISOCode: "us", Name: "United States" }), {
    countryCode: "US",
    countryName: "United States",
    locationSource: "maxmind",
  });
  assert.equal(normalizeGeoIpRecord({ ISOCode: "invalid", Name: "Nope" }), null);
});

test("resolves Komari node IPs without returning addresses or credentials", async () => {
  const lookedUp = [];
  const client = {
    configured: true,
    apiKeyConfigured: true,
    async getGeoIpSettings() {
      return { enabled: true, provider: "mmdb" };
    },
    async getNodeIpInventory() {
      return [
        { id: "node-a", ipv4: "8.8.8.8", token: "must-not-survive" },
        { id: "node-private", ipv4: "10.0.0.2" },
      ];
    },
    async lookupGeoIp(ip) {
      lookedUp.push(ip);
      return { ISOCode: "US", Name: "United States" };
    },
  };
  const service = new KomariGeoIpService({ client, now: () => Date.parse("2026-07-19T02:00:00Z") });
  const locations = await service.resolveNodeLocations();

  assert.deepEqual(lookedUp, ["8.8.8.8"]);
  assert.deepEqual(locations.get("node-a"), {
    countryCode: "US",
    countryName: "United States",
    locationSource: "maxmind",
  });
  assert.equal(locations.has("node-private"), false);
  assert.equal(JSON.stringify([...locations]).includes("8.8.8.8"), false);
  assert.equal(JSON.stringify([...locations]).includes("must-not-survive"), false);
});

test("updates Komari to MaxMind and verifies the resulting provider", async () => {
  const calls = [];
  const client = {
    configured: true,
    apiKeyConfigured: true,
    async configureMaxMindGeoIp(options) {
      calls.push(["configure", options]);
    },
    async updateGeoIpDatabase() {
      calls.push("update");
    },
    async getGeoIpSettings() {
      calls.push("status");
      return { enabled: true, provider: "mmdb" };
    },
  };
  const service = new KomariGeoIpService({ client, settleDelayMs: 0 });
  const status = await service.updateDatabase();
  assert.deepEqual(calls, ["status", ["configure", { forceReload: false }], "update", "status"]);
  assert.equal(status.ready, true);
  assert.equal(status.provider, "maxmind");
});

test("forces a provider reload when MaxMind was configured but disabled", async () => {
  const calls = [];
  let statusReads = 0;
  const client = {
    configured: true,
    apiKeyConfigured: true,
    async configureMaxMindGeoIp(options) {
      calls.push(["configure", options]);
    },
    async updateGeoIpDatabase() {
      calls.push("update");
    },
    async getGeoIpSettings() {
      statusReads += 1;
      calls.push("status");
      return statusReads === 1
        ? { enabled: false, provider: "mmdb" }
        : { enabled: true, provider: "mmdb" };
    },
  };
  const service = new KomariGeoIpService({ client, settleDelayMs: 0 });
  const status = await service.updateDatabase();
  assert.deepEqual(calls, ["status", ["configure", { forceReload: true }], "update", "status"]);
  assert.equal(status.ready, true);
});
