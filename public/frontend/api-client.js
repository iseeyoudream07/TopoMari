const JSON_HEADERS = Object.freeze({ Accept: "application/json" });

export async function requestJson(path, { method = "GET", body, csrfToken } = {}) {
  const headers = { ...JSON_HEADERS };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    if (csrfToken) headers["X-Topology-CSRF"] = csrfToken;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const dashboardApi = Object.freeze({
  snapshot() {
    return requestJson(`/api/dashboard?t=${Date.now()}`);
  },
});

export const editorApi = Object.freeze({
  bootstrap() {
    return requestJson(`/api/editor/bootstrap?t=${Date.now()}`);
  },
  probeStatus() {
    return requestJson(`/api/probes?t=${Date.now()}`);
  },
  saveTopology(config, revision, csrfToken) {
    return requestJson("/api/editor/topology", {
      method: "PUT",
      body: { config, revision },
      csrfToken,
    });
  },
  createEnrollment(body, csrfToken) {
    return requestJson("/api/editor/enrollments", {
      method: "POST",
      body,
      csrfToken,
    });
  },
  setAgentEnabled(agentId, enabled, csrfToken) {
    return requestJson("/api/editor/agents/action", {
      method: "POST",
      body: { agentId, enabled },
      csrfToken,
    });
  },
});
