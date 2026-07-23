const JSON_HEADERS = Object.freeze({ Accept: "application/json" });

export async function requestJson(path, { method = "GET", body, csrfToken } = {}) {
  const headers = { ...JSON_HEADERS };
  if (csrfToken) headers["X-Topology-CSRF"] = csrfToken;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
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
  site() {
    return requestJson(`/api/site?t=${Date.now()}`);
  },
});

export const authApi = Object.freeze({
  session() {
    return requestJson(`/api/auth/session?t=${Date.now()}`);
  },
  login(username, password) {
    return requestJson("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
  },
  logout(csrfToken) {
    return requestJson("/api/auth/logout", {
      method: "POST",
      body: {},
      csrfToken,
    });
  },
});

async function requestFavicon(file, csrfToken) {
  const response = await fetch("/api/admin/site/favicon", {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Topology-CSRF": csrfToken,
    },
    body: file,
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function requestThemeBackground(mode, type, file, csrfToken) {
  const response = await fetch(`/api/admin/theme/background/${mode}?type=${encodeURIComponent(type)}`, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Topology-CSRF": csrfToken,
    },
    body: file,
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const adminApi = Object.freeze({
  site() {
    return requestJson(`/api/admin/site?t=${Date.now()}`);
  },
  saveSite(settings, revision, csrfToken) {
    return requestJson("/api/admin/site", {
      method: "PUT",
      body: { ...settings, revision },
      csrfToken,
    });
  },
  updateGeoIp(csrfToken) {
    return requestJson("/api/admin/geoip/update", {
      method: "POST",
      body: {},
      csrfToken,
    });
  },
  saveKomariApiKey(apiKey, csrfToken) {
    return requestJson("/api/admin/komari-api-key", {
      method: "PUT",
      body: { apiKey },
      csrfToken,
    });
  },
  clearKomariApiKey(csrfToken) {
    return requestJson("/api/admin/komari-api-key", {
      method: "DELETE",
      csrfToken,
    });
  },
  uploadFavicon(file, csrfToken) {
    return requestFavicon(file, csrfToken);
  },
  deleteFavicon(csrfToken) {
    return requestJson("/api/admin/site/favicon", {
      method: "DELETE",
      csrfToken,
    });
  },
  uploadThemeBackground(mode, type, file, csrfToken) {
    return requestThemeBackground(mode, type, file, csrfToken);
  },
  deleteThemeBackground(mode, csrfToken) {
    return requestJson(`/api/admin/theme/background/${mode}`, {
      method: "DELETE",
      csrfToken,
    });
  },
});

export const editorApi = Object.freeze({
  bootstrap() {
    return requestJson(`/api/editor/bootstrap?t=${Date.now()}`);
  },
  inventory() {
    return requestJson(`/api/editor/inventory?t=${Date.now()}`);
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
  branding() {
    return requestJson(`/api/editor/branding?t=${Date.now()}`);
  },
  saveBranding(siteName, mainTitle, revision, csrfToken) {
    return requestJson("/api/editor/branding", {
      method: "PUT",
      body: { siteName, mainTitle, revision },
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
