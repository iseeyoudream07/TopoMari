import { adminApi, authApi, dashboardApi } from "./frontend/api-client.js";
import { t } from "./frontend/i18n.js";
import { initPreferences, setAutoThemeBeijing } from "./frontend/preferences.js";
import { initTopologyEditor } from "./editor.js";

const elements = {
  loginGate: document.getElementById("login-gate"),
  loginForm: document.getElementById("login-form"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  loginSubmit: document.getElementById("login-submit"),
  loginError: document.getElementById("login-error"),
  shell: document.getElementById("admin-shell"),
  sidebar: document.getElementById("admin-sidebar"),
  sidebarToggle: document.getElementById("sidebar-toggle"),
  sidebarScrim: document.getElementById("sidebar-scrim"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsSubmenu: document.getElementById("settings-submenu"),
  breadcrumb: document.getElementById("admin-breadcrumb"),
  logout: document.getElementById("logout-button"),
  notice: document.getElementById("admin-notice"),
  editorDisabled: document.getElementById("editor-disabled"),
  siteForm: document.getElementById("site-settings-form"),
  siteName: document.getElementById("site-name-input"),
  siteDescription: document.getElementById("site-description-input"),
  descriptionCount: document.getElementById("description-count"),
  autoTheme: document.getElementById("auto-theme-beijing"),
  siteSave: document.getElementById("site-save"),
  siteSaveStatus: document.getElementById("site-save-status"),
  faviconFile: document.getElementById("favicon-file"),
  faviconUpload: document.getElementById("favicon-upload"),
  faviconReset: document.getElementById("favicon-reset"),
  faviconPreview: document.getElementById("favicon-preview"),
  faviconStatus: document.getElementById("favicon-status"),
};

let session = { authenticated: false, csrfToken: "", editorEnabled: false };
let siteState = null;
let editorController = null;
let adminInitialized = false;
let noticeTimer = null;

function updateFaviconImages(version = Date.now()) {
  const source = `/favicon?v=${version}`;
  document.querySelectorAll("#login-favicon, #admin-favicon, #favicon-preview").forEach((image) => {
    image.src = source;
  });
  const link = document.getElementById("site-favicon");
  if (link) link.href = source;
}

function updateSiteIdentity(site) {
  if (!site) return;
  const siteName = site.siteName || "TopoMari";
  document.querySelectorAll("#login-site-name, #admin-site-name").forEach((element) => {
    element.textContent = siteName;
  });
  document.title = `${siteName} · ${t("admin.consoleTitle")}`;
  setAutoThemeBeijing(site.autoThemeBeijing === true);
  if (site.faviconVersion) updateFaviconImages(site.faviconVersion);
}

function updateFaviconStatus() {
  if (!siteState) return;
  elements.faviconStatus.textContent = t(siteState.customFavicon ? "site.faviconCustom" : "site.faviconCurrent");
  elements.faviconReset.disabled = !siteState.customFavicon;
}

function showNotice(message, tone = "success") {
  window.clearTimeout(noticeTimer);
  elements.notice.textContent = message;
  elements.notice.dataset.tone = tone;
  elements.notice.hidden = false;
  noticeTimer = window.setTimeout(() => {
    elements.notice.hidden = true;
  }, tone === "error" ? 8_000 : 4_500);
}

function showLogin(error = "") {
  elements.shell.hidden = true;
  elements.loginGate.hidden = false;
  if (error) {
    elements.loginError.textContent = error;
    elements.loginError.hidden = false;
  } else {
    elements.loginError.hidden = true;
  }
  window.setTimeout(() => elements.loginUsername.focus(), 0);
}

function showAdmin() {
  elements.loginGate.hidden = true;
  elements.shell.hidden = false;
  elements.loginError.hidden = true;
}

function closeSidebar() {
  elements.shell.dataset.sidebarOpen = "false";
  elements.sidebarScrim.hidden = true;
  elements.sidebarToggle.setAttribute("aria-expanded", "false");
}

function openSidebar() {
  elements.shell.dataset.sidebarOpen = "true";
  elements.sidebarScrim.hidden = false;
  elements.sidebarToggle.setAttribute("aria-expanded", "true");
}

function selectedView() {
  return window.location.hash === "#site" ? "site" : "routes";
}

function activateView(view, { updateHash = true } = {}) {
  const resolved = view === "site" ? "site" : "routes";
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== resolved;
  });
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    const active = button.dataset.adminView === resolved;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  elements.settingsToggle.classList.toggle("is-active", resolved === "site");
  elements.breadcrumb.textContent = t(resolved === "site" ? "admin.site" : "admin.routes");
  if (updateHash) history.replaceState(null, "", resolved === "site" ? "#site" : "#routes");
  closeSidebar();
}

function fillSiteForm(site) {
  siteState = site;
  elements.siteName.value = site.siteName || "TopoMari";
  elements.siteDescription.value = site.description || "";
  elements.descriptionCount.textContent = String(elements.siteDescription.value.length);
  elements.autoTheme.checked = site.autoThemeBeijing === true;
  elements.siteSaveStatus.textContent = "";
  updateFaviconStatus();
  updateSiteIdentity(site);
  updateFaviconImages(site.faviconVersion || Date.now());
}

async function loadSiteSettings() {
  const site = await adminApi.site();
  session.csrfToken = site.csrfToken || session.csrfToken;
  fillSiteForm(site);
  return site;
}

async function initializeAdmin(status) {
  session = { ...session, ...status };
  showAdmin();
  const site = await loadSiteSettings();

  if (!session.editorEnabled) {
    elements.editorDisabled.hidden = false;
    document.getElementById("topology-manager").hidden = true;
  } else if (!adminInitialized) {
    editorController = await initTopologyEditor({
      embedded: true,
      onSaved: loadSiteSettings,
    });
    if (!editorController?.available) {
      elements.editorDisabled.hidden = false;
      document.getElementById("topology-manager").hidden = true;
    }
  } else if (editorController?.available) {
    await editorController.reload();
  }

  editorController?.syncSiteSettings?.(site, site.revision);
  adminInitialized = true;
  activateView(selectedView(), { updateHash: false });
}

async function handleUnauthorized(error) {
  if (error?.status !== 401) return false;
  session = { authenticated: false, csrfToken: "", editorEnabled: session.editorEnabled };
  showLogin(t("admin.sessionExpired"));
  return true;
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginSubmit.disabled = true;
  elements.loginError.hidden = true;
  try {
    const status = await authApi.login(elements.loginUsername.value.trim(), elements.loginPassword.value);
    elements.loginPassword.value = "";
    await initializeAdmin(status);
  } catch (error) {
    showLogin(error.message || t("admin.loginFailed"));
  } finally {
    elements.loginSubmit.disabled = false;
  }
});

elements.logout.addEventListener("click", async () => {
  elements.logout.disabled = true;
  try {
    await authApi.logout(session.csrfToken);
  } catch (error) {
    if (error.status !== 401) showNotice(error.message, "error");
  } finally {
    session = { authenticated: false, csrfToken: "", editorEnabled: session.editorEnabled };
    elements.logout.disabled = false;
    showLogin();
  }
});

document.querySelectorAll("[data-admin-view]").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.adminView));
});

elements.settingsToggle.addEventListener("click", () => {
  const expanded = elements.settingsToggle.getAttribute("aria-expanded") === "true";
  elements.settingsToggle.setAttribute("aria-expanded", String(!expanded));
  elements.settingsSubmenu.hidden = expanded;
});

elements.sidebarToggle.addEventListener("click", () => {
  if (elements.shell.dataset.sidebarOpen === "true") closeSidebar();
  else openSidebar();
});
elements.sidebarScrim.addEventListener("click", closeSidebar);

elements.siteDescription.addEventListener("input", () => {
  elements.descriptionCount.textContent = String(elements.siteDescription.value.length);
});

elements.siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!siteState) return;
  elements.siteSave.disabled = true;
  elements.siteSaveStatus.textContent = t("site.saving");
  try {
    const site = await adminApi.saveSite(
      elements.siteName.value.trim(),
      elements.siteDescription.value.trim(),
      elements.autoTheme.checked,
      siteState.revision,
      session.csrfToken,
    );
    fillSiteForm(site);
    editorController?.syncSiteSettings?.(site, site.revision);
    elements.siteSaveStatus.textContent = t("site.saved");
    showNotice(t("site.saved"));
  } catch (error) {
    if (await handleUnauthorized(error)) return;
    elements.siteSaveStatus.textContent = error.message;
    showNotice(error.message, "error");
    if (error.status === 409) await loadSiteSettings();
  } finally {
    elements.siteSave.disabled = false;
  }
});

elements.faviconUpload.addEventListener("click", async () => {
  const file = elements.faviconFile.files?.[0];
  if (!file) {
    showNotice(t("site.chooseFavicon"), "error");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showNotice(t("site.faviconTooLarge"), "error");
    return;
  }
  elements.faviconUpload.disabled = true;
  try {
    const site = await adminApi.uploadFavicon(file, session.csrfToken);
    fillSiteForm({ ...siteState, ...site });
    elements.faviconFile.value = "";
    showNotice(t("site.faviconUploaded"));
  } catch (error) {
    if (!await handleUnauthorized(error)) showNotice(error.message, "error");
  } finally {
    elements.faviconUpload.disabled = false;
  }
});

elements.faviconReset.addEventListener("click", async () => {
  if (!siteState?.customFavicon || !window.confirm(t("site.resetConfirm"))) return;
  elements.faviconReset.disabled = true;
  try {
    const site = await adminApi.deleteFavicon(session.csrfToken);
    fillSiteForm({ ...siteState, ...site });
    showNotice(t("site.faviconResetDone"));
  } catch (error) {
    if (!await handleUnauthorized(error)) showNotice(error.message, "error");
  } finally {
    elements.faviconReset.disabled = !siteState?.customFavicon;
  }
});

document.addEventListener("topomari:languagechange", () => {
  activateView(selectedView(), { updateHash: false });
  updateFaviconStatus();
  if (siteState) updateSiteIdentity(siteState);
});

initPreferences();
elements.shell.dataset.sidebarOpen = "false";

try {
  const site = await dashboardApi.site();
  updateSiteIdentity(site);
  updateFaviconImages(site.faviconVersion || Date.now());
} catch {
  // The login form remains usable when public metadata is temporarily unavailable.
}

try {
  const status = await authApi.session();
  if (status.authenticated) await initializeAdmin(status);
  else showLogin();
} catch (error) {
  showLogin(error.message || t("admin.loginFailed"));
}
