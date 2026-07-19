import test from "node:test";
import assert from "node:assert/strict";
import { buildRouteLinks, resolveNodeLocation } from "../public/frontend/route-globe.js";

test("resolves explicit and region-derived globe coordinates", () => {
  assert.deepEqual(resolveNodeLocation({ latitude: 35.6762, longitude: 139.6503, countryCode: "jp" }), {
    lat: 35.6762,
    lng: 139.6503,
    code: "JP",
  });
  assert.deepEqual(resolveNodeLocation({ id: "zouter", name: "Zouter_JP" }), {
    lat: 36.2048,
    lng: 138.2529,
    code: "JP",
  });
  assert.deepEqual(resolveNodeLocation({ id: "dmit", region: "Los Angeles, US" }), {
    lat: 34.0522,
    lng: -118.2437,
    code: "US",
  });
  assert.deepEqual(resolveNodeLocation({ id: "maxmind-node", countryCode: "IN", countryName: "India" }), {
    lat: 20.5937,
    lng: 78.9629,
    code: "IN",
  });
});

test("keeps unknown node placement deterministic", () => {
  const first = resolveNodeLocation({ id: "unknown-edge-node" }, "route-a");
  const second = resolveNodeLocation({ id: "unknown-edge-node" }, "route-a");
  assert.deepEqual(first, second);
  assert.equal(first.inferred, true);
});

test("builds animated globe links from route edge order and status", () => {
  const links = buildRouteLinks([
    {
      id: "tokyo-to-sydney",
      nodes: [
        { id: "tokyo", name: "Tokyo_JP" },
        { id: "sydney", region: "Sydney, AU" },
      ],
      edges: [{ probe_id: "tokyo-sydney", stats: { status: "degraded" } }],
    },
  ]);

  assert.equal(links.length, 1);
  assert.equal(links[0].id, "tokyo-to-sydney:tokyo-sydney");
  assert.equal(links[0].status, "degraded");
  assert.equal(links[0].from.code, "JP");
  assert.equal(links[0].to.code, "AU");
});
