import test from "node:test";
import assert from "node:assert/strict";
import { isDiagnosticApiPath, validateDashboardAuthConfig } from "../lib/security-policy.mjs";

test("identifies only the explicitly gated diagnostic APIs", () => {
  assert.equal(isDiagnosticApiPath("/api/nodes"), true);
  assert.equal(isDiagnosticApiPath("/api/ping-tasks"), true);
  assert.equal(isDiagnosticApiPath("/api/dashboard"), false);
  assert.equal(isDiagnosticApiPath("/api/node-recent"), false);
});

test("refuses live mode without admin credentials", () => {
  assert.throws(
    () => validateDashboardAuthConfig({ demoMode: false }),
    /Live mode requires DASHBOARD_USER and DASHBOARD_PASSWORD for the admin console/,
  );
  assert.equal(
    validateDashboardAuthConfig({
      demoMode: false,
      user: "operator",
      password: "long-random-password",
    }),
    true,
  );
  assert.equal(
    validateDashboardAuthConfig({ demoMode: false, allowUnauthenticated: true }),
    false,
  );
});

test("rejects half-configured Basic Auth credentials", () => {
  assert.throws(
    () => validateDashboardAuthConfig({ demoMode: true, user: "operator" }),
    /must either both be set or both be empty/,
  );
});
