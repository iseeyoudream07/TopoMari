import test from "node:test";
import assert from "node:assert/strict";
import { classifyHealth, resolveHealthThresholds } from "../lib/health-status.mjs";

test("preserves the default warning and degraded boundaries", () => {
  assert.equal(classifyHealth({ loss: 0, avg: 149 }), "healthy");
  assert.equal(classifyHealth({ loss: 0, avg: 150 }), "warning");
  assert.equal(classifyHealth({ loss: 20, avg: 10 }), "degraded");
  assert.equal(classifyHealth({ latestFailed: true, loss: 0, avg: 10 }), "failed");
  assert.equal(classifyHealth({ hasData: false }), "unknown");
});

test("rejects invalid per-edge threshold overrides", () => {
  assert.throws(
    () => resolveHealthThresholds({ warning_latency_ms: 400, degraded_latency_ms: 250 }),
    /must be lower/,
  );
  assert.throws(() => resolveHealthThresholds({ typo_latency_ms: 200 }), /unknown key/);
});
