const DIAGNOSTIC_API_PATHS = new Set(["/api/nodes", "/api/ping-tasks"]);

export function isDiagnosticApiPath(pathname) {
  return DIAGNOSTIC_API_PATHS.has(String(pathname || ""));
}

export function validateDashboardAuthConfig({ user = "", password = "", demoMode = false, allowUnauthenticated = false } = {}) {
  if (Boolean(user) !== Boolean(password)) {
    throw new Error("DASHBOARD_USER and DASHBOARD_PASSWORD must either both be set or both be empty");
  }

  const configured = Boolean(user && password);
  if (!demoMode && !configured && !allowUnauthenticated) {
    throw new Error(
      "Live mode requires DASHBOARD_USER and DASHBOARD_PASSWORD. " +
        "Set ALLOW_UNAUTHENTICATED_DASHBOARD=true only when an upstream proxy enforces authentication.",
    );
  }
  return configured;
}
