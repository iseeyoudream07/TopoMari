import { adminApi, authApi, dashboardApi } from "./frontend/api-client.js?v=2.8.4-ui2";
import { getLocale, t } from "./frontend/i18n.js?v=2.8.4-ui2";
import { initPreferences, setAutoThemeBeijing } from "./frontend/preferences.js?v=2.8.4-ui2";
import {
  applySiteTheme,
  defaultVisualThemeColors,
  normalizeVisualThemeSettings,
} from "./frontend/site-theme.js";
import {
  applyThemeSettings,
  DEFAULT_THEME_SETTINGS,
  normalizeThemeSettings,
} from "./frontend/theme-background.js";
import { initTopologyEditor } from "./editor.js?v=2.8.4-ui2";

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
  generalForm: document.getElementById("general-settings-form"),
  generalSave: document.getElementById("general-save"),
  generalSaveStatus: document.getElementById("general-save-status"),
  customThemeColors: document.getElementById("custom-theme-colors"),
  themeColorFields: document.getElementById("theme-color-fields"),
  themeColorsReset: document.getElementById("theme-colors-reset"),
  themeLightBackground: document.getElementById("theme-light-background"),
  themeLightAccent: document.getElementById("theme-light-accent"),
  themeDarkBackground: document.getElementById("theme-dark-background"),
  themeDarkAccent: document.getElementById("theme-dark-accent"),
  themeSettingsForm: document.getElementById("theme-settings-form"),
  themeSettingsSave: document.getElementById("theme-settings-save"),
  themeSettingsSaveStatus: document.getElementById("theme-settings-save-status"),
  themeSettingsReset: document.getElementById("theme-settings-reset"),
  themeSettingsLock: document.getElementById("theme-settings-lock"),
  themeSettingsControls: document.getElementById("theme-settings-controls"),
  stopGlobeRotation: document.getElementById("stop-globe-rotation"),
  backgroundEnabled: document.getElementById("background-enabled"),
  backgroundType: document.getElementById("background-type"),
  backgroundSourceFields: document.getElementById("background-source-fields"),
  lightBackgroundSource: document.getElementById("light-background-source"),
  lightBackgroundFile: document.getElementById("light-background-file"),
  lightBackgroundUpload: document.getElementById("light-background-upload"),
  lightBackgroundDelete: document.getElementById("light-background-delete"),
  lightBackgroundStatus: document.getElementById("light-background-status"),
  darkBackgroundSource: document.getElementById("dark-background-source"),
  darkBackgroundFile: document.getElementById("dark-background-file"),
  darkBackgroundUpload: document.getElementById("dark-background-upload"),
  darkBackgroundDelete: document.getElementById("dark-background-delete"),
  darkBackgroundStatus: document.getElementById("dark-background-status"),
  backgroundBlur: document.getElementById("background-blur"),
  backgroundBlurValue: document.getElementById("background-blur-value"),
  backgroundOverlay: document.getElementById("background-overlay"),
  backgroundOverlayValue: document.getElementById("background-overlay-value"),
  glassBlur: document.getElementById("glass-blur"),
  glassBlurValue: document.getElementById("glass-blur-value"),
  glassOpacity: document.getElementById("glass-opacity"),
  glassOpacityValue: document.getElementById("glass-opacity-value"),
  glassBorder: document.getElementById("glass-border"),
  glassBorderValue: document.getElementById("glass-border-value"),
  cornerRadius: document.getElementById("corner-radius"),
  cornerRadiusValue: document.getElementById("corner-radius-value"),
  siteForm: document.getElementById("site-settings-form"),
  siteName: document.getElementById("site-name-input"),
  siteDescription: document.getElementById("site-description-input"),
  descriptionCount: document.getElementById("description-count"),
  komariApiKeyInput: document.getElementById("komari-api-key-input"),
  komariApiKeySave: document.getElementById("komari-api-key-save"),
  komariApiKeyClear: document.getElementById("komari-api-key-clear"),
  komariApiKeyStatus: document.getElementById("komari-api-key-status"),
  autoTheme: document.getElementById("auto-theme-beijing"),
  warningLatencyThreshold: document.getElementById("warning-latency-threshold"),
  degradedLatencyThreshold: document.getElementById("degraded-latency-threshold"),
  warningLossThreshold: document.getElementById("warning-loss-threshold"),
  degradedLossThreshold: document.getElementById("degraded-loss-threshold"),
  geoIpEnabled: document.getElementById("geoip-enabled"),
  geoIpUpdate: document.getElementById("geoip-update"),
  geoIpStatus: document.getElementById("geoip-status"),
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

function updateSiteIdentity(site, { syncVisualTheme = true } = {}) {
  if (!site) return;
  const siteName = site.siteName || "TopoMari";
  document.querySelectorAll("#login-site-name, #admin-site-name").forEach((element) => {
    element.textContent = siteName;
  });
  document.title = `${siteName} · ${t("admin.consoleTitle")}`;
  if (syncVisualTheme) {
    applySiteTheme(site);
    applyThemeSettings(site);
    setAutoThemeBeijing(site.autoThemeBeijing === true);
  }
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
  const requested = window.location.hash.slice(1);
  return ["routes", "theme", "general", "site"].includes(requested) ? requested : "routes";
}

function activateView(view, { updateHash = true } = {}) {
  const resolved = ["theme", "general", "site"].includes(view) ? view : "routes";
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== resolved;
  });
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    const active = button.dataset.adminView === resolved;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const settingsActive = resolved === "general" || resolved === "site";
  elements.settingsToggle.classList.toggle("is-active", settingsActive);
  if (settingsActive) {
    elements.settingsToggle.setAttribute("aria-expanded", "true");
    elements.settingsSubmenu.hidden = false;
  }
  const breadcrumbKey = resolved === "theme"
    ? "admin.themeSettings"
    : resolved === "general"
      ? "admin.general"
      : resolved === "site"
        ? "admin.site"
        : "admin.routes";
  elements.breadcrumb.textContent = t(breadcrumbKey);
  if (updateHash) {
    history.replaceState(null, "", `#${resolved}`);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }
  closeSidebar();
}

function selectedVisualTheme() {
  return document.querySelector('input[name="visual-theme"]:checked')?.value || "topomari";
}

function glassmorphismSettingsActive(site = siteState) {
  return normalizeVisualThemeSettings(site || {}).visualTheme === "glassmorphism";
}

function syncThemeSettingsAvailability(site = siteState) {
  const locked = !glassmorphismSettingsActive(site);
  elements.themeSettingsLock.hidden = !locked;
  elements.themeSettingsControls.disabled = locked;
  elements.themeSettingsForm.dataset.locked = String(locked);
}

function setThemeColorInputs(colors) {
  const pairs = [
    [elements.themeLightBackground, colors.lightBackground],
    [elements.themeLightAccent, colors.lightAccent],
    [elements.themeDarkBackground, colors.darkBackground],
    [elements.themeDarkAccent, colors.darkAccent],
  ];
  pairs.forEach(([input, color]) => {
    input.value = color;
    const output = input.parentElement.querySelector("output");
    if (output) output.value = color;
  });
}

function generalThemeDraft() {
  return normalizeVisualThemeSettings({
    visualTheme: selectedVisualTheme(),
    customThemeColors: elements.customThemeColors.checked,
    themeColors: {
      lightBackground: elements.themeLightBackground.value,
      lightAccent: elements.themeLightAccent.value,
      darkBackground: elements.themeDarkBackground.value,
      darkAccent: elements.themeDarkAccent.value,
    },
  });
}

function healthThresholdDraft() {
  return {
    warning_latency_ms: Number(elements.warningLatencyThreshold.value),
    degraded_latency_ms: Number(elements.degradedLatencyThreshold.value),
    warning_loss_percent: Number(elements.warningLossThreshold.value),
    degraded_loss_percent: Number(elements.degradedLossThreshold.value),
  };
}

function validateHealthThresholdInputs() {
  const thresholds = healthThresholdDraft();
  const latencyError = thresholds.warning_latency_ms >= thresholds.degraded_latency_ms
    ? t("healthThresholds.latencyOrderError")
    : "";
  const lossError = thresholds.warning_loss_percent >= thresholds.degraded_loss_percent
    ? t("healthThresholds.lossOrderError")
    : "";
  elements.degradedLatencyThreshold.setCustomValidity(latencyError);
  elements.degradedLossThreshold.setCustomValidity(lossError);
  return !latencyError && !lossError;
}

function previewGeneralTheme() {
  elements.themeColorFields.hidden = !elements.customThemeColors.checked;
  applySiteTheme(generalThemeDraft());
  applyThemeSettings(themeSettingsDraft());
}

function geoIpStatusText(site) {
  const status = site?.geoIpStatus || {};
  if (!status.komariConfigured) return t("geoIp.statusKomariMissing");
  if (!status.apiKeyConfigured) return t("geoIp.statusApiKeyMissing");
  if (status.error === "api-key-rejected") return t("geoIp.statusApiKeyRejected");
  if (status.error === "api-unsupported") return t("geoIp.statusUnsupported");
  if (status.error === "komari-unavailable") return t("geoIp.statusUnavailable");
  if (!status.ready) return t("geoIp.statusNeedsUpdate");

  const updatedAt = site?.geoIp?.lastUpdatedAt;
  if (updatedAt && Number.isFinite(Date.parse(updatedAt))) {
    const date = new Intl.DateTimeFormat(getLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(updatedAt));
    return t("geoIp.statusLastUpdated", { date });
  }
  if (Number(status.locatedNodes) > 0) {
    return t("geoIp.statusReadyWithNodes", { count: status.locatedNodes });
  }
  return t("geoIp.statusReady");
}

function updateGeoIpStatus(site = siteState) {
  if (!elements.geoIpStatus || !elements.geoIpUpdate) return;
  elements.geoIpStatus.textContent = geoIpStatusText(site);
  const status = site?.geoIpStatus || {};
  elements.geoIpUpdate.disabled = !status.komariConfigured || !status.apiKeyConfigured;
}

function updateKomariApiKeyStatus(site = siteState) {
  const state = site?.komariApiKey || {};
  elements.komariApiKeyInput.value = "";
  elements.komariApiKeyStatus.textContent = t(
    state.managed
      ? "komariApiKey.statusManaged"
      : state.configured
        ? "komariApiKey.statusEnvironment"
        : "komariApiKey.statusMissing",
  );
  elements.komariApiKeyStatus.dataset.configured = String(state.configured === true);
  elements.komariApiKeyClear.disabled = state.managed !== true;
}

function fillGeneralForm(site) {
  const settings = normalizeVisualThemeSettings(site);
  document.querySelectorAll('input[name="visual-theme"]').forEach((input) => {
    input.checked = input.value === settings.visualTheme;
  });
  elements.customThemeColors.checked = settings.customThemeColors;
  setThemeColorInputs(settings.themeColors);
  elements.themeColorFields.hidden = !settings.customThemeColors;
  const thresholds = site.healthThresholds || {};
  elements.warningLatencyThreshold.value = String(thresholds.warning_latency_ms ?? 150);
  elements.degradedLatencyThreshold.value = String(thresholds.degraded_latency_ms ?? 250);
  elements.warningLossThreshold.value = String(thresholds.warning_loss_percent ?? 0);
  elements.degradedLossThreshold.value = String(thresholds.degraded_loss_percent ?? 20);
  validateHealthThresholdInputs();
  elements.geoIpEnabled.checked = site.geoIp?.enabled === true;
  updateGeoIpStatus(site);
  elements.generalSaveStatus.textContent = "";
}

function themeBackgroundControls(mode) {
  const prefix = mode === "dark" ? "dark" : "light";
  return {
    source: elements[`${prefix}BackgroundSource`],
    file: elements[`${prefix}BackgroundFile`],
    upload: elements[`${prefix}BackgroundUpload`],
    delete: elements[`${prefix}BackgroundDelete`],
    status: elements[`${prefix}BackgroundStatus`],
  };
}

function humanFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function updateThemeRangeOutputs(settings = themeSettingsDraft()) {
  elements.backgroundBlurValue.value = `${settings.backgroundBlur} px`;
  elements.backgroundOverlayValue.value = String(settings.backgroundOverlay);
  elements.glassBlurValue.value = `${settings.glassBlur} px`;
  elements.glassOpacityValue.value = `${settings.glassOpacity}%`;
  elements.glassBorderValue.value = `${settings.glassBorder}%`;
  elements.cornerRadiusValue.value = `${settings.cornerRadius} px`;
}

function updateThemeAssetStatus() {
  for (const mode of ["light", "dark"]) {
    const controls = themeBackgroundControls(mode);
    const asset = siteState?.backgroundAssets?.[mode];
    controls.delete.disabled = !asset?.exists;
    controls.status.textContent = asset?.exists
      ? t("themeSettings.localReady", {
        type: t(asset.type === "video" ? "themeSettings.video" : "themeSettings.image"),
        size: humanFileSize(asset.size),
      })
      : t("themeSettings.noLocal");
  }
}

function themeSettingsDraft() {
  return normalizeThemeSettings({
    stopGlobeRotation: elements.stopGlobeRotation.checked,
    backgroundEnabled: elements.backgroundEnabled.checked,
    backgroundType: elements.backgroundType.value,
    lightBackground: elements.lightBackgroundSource.value,
    darkBackground: elements.darkBackgroundSource.value,
    backgroundBlur: elements.backgroundBlur.value,
    backgroundOverlay: elements.backgroundOverlay.value,
    glassBlur: elements.glassBlur.value,
    glassOpacity: elements.glassOpacity.value,
    glassBorder: elements.glassBorder.value,
    cornerRadius: elements.cornerRadius.value,
  });
}

function previewThemeSettings() {
  const settings = themeSettingsDraft();
  elements.backgroundSourceFields.dataset.enabled = String(settings.backgroundEnabled);
  updateThemeRangeOutputs(settings);
  applyThemeSettings(settings);
}

function setThemeSettingsForm(settingsValue) {
  const settings = normalizeThemeSettings(settingsValue);
  elements.stopGlobeRotation.checked = settings.stopGlobeRotation;
  elements.backgroundEnabled.checked = settings.backgroundEnabled;
  elements.backgroundType.value = settings.backgroundType;
  elements.lightBackgroundSource.value = settings.lightBackground;
  elements.darkBackgroundSource.value = settings.darkBackground;
  elements.backgroundBlur.value = String(settings.backgroundBlur);
  elements.backgroundOverlay.value = String(settings.backgroundOverlay);
  elements.glassBlur.value = String(settings.glassBlur);
  elements.glassOpacity.value = String(settings.glassOpacity);
  elements.glassBorder.value = String(settings.glassBorder);
  elements.cornerRadius.value = String(settings.cornerRadius);
  elements.backgroundSourceFields.dataset.enabled = String(settings.backgroundEnabled);
  updateThemeRangeOutputs(settings);
  elements.themeSettingsSaveStatus.textContent = "";
  updateThemeAssetStatus();
}

function siteSavePayload({
  siteName = siteState.siteName,
  description = siteState.description,
  autoThemeBeijing = siteState.autoThemeBeijing,
  visualSettings = normalizeVisualThemeSettings(siteState),
  themeSettings = normalizeThemeSettings(siteState),
  healthThresholds = siteState.healthThresholds,
  geoIp = { enabled: siteState.geoIp?.enabled === true },
} = {}) {
  return {
    siteName,
    description,
    autoThemeBeijing,
    ...visualSettings,
    themeSettings,
    healthThresholds,
    geoIp,
  };
}

function fillSiteForm(site) {
  siteState = site;
  elements.siteName.value = site.siteName || "TopoMari";
  elements.siteDescription.value = site.description || "";
  elements.descriptionCount.textContent = String(elements.siteDescription.value.length);
  elements.autoTheme.checked = site.autoThemeBeijing === true;
  elements.siteSaveStatus.textContent = "";
  fillGeneralForm(site);
  setThemeSettingsForm(site);
  syncThemeSettingsAvailability(site);
  updateFaviconStatus();
  updateKomariApiKeyStatus(site);
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

document.querySelectorAll('input[name="visual-theme"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!elements.customThemeColors.checked) {
      setThemeColorInputs(defaultVisualThemeColors(selectedVisualTheme()));
    }
    previewGeneralTheme();
  });
});

elements.customThemeColors.addEventListener("change", previewGeneralTheme);

[
  elements.themeLightBackground,
  elements.themeLightAccent,
  elements.themeDarkBackground,
  elements.themeDarkAccent,
].forEach((input) => {
  input.addEventListener("input", () => {
    const output = input.parentElement.querySelector("output");
    if (output) output.value = input.value;
    if (elements.customThemeColors.checked) previewGeneralTheme();
  });
});

elements.themeColorsReset.addEventListener("click", () => {
  setThemeColorInputs(defaultVisualThemeColors(selectedVisualTheme()));
  previewGeneralTheme();
});

[
  elements.warningLatencyThreshold,
  elements.degradedLatencyThreshold,
  elements.warningLossThreshold,
  elements.degradedLossThreshold,
].forEach((input) => input.addEventListener("input", validateHealthThresholdInputs));

[
  elements.stopGlobeRotation,
  elements.backgroundEnabled,
  elements.backgroundType,
].forEach((input) => input.addEventListener("change", previewThemeSettings));

[
  elements.lightBackgroundSource,
  elements.darkBackgroundSource,
].forEach((input) => input.addEventListener("change", previewThemeSettings));

[
  elements.backgroundBlur,
  elements.backgroundOverlay,
  elements.glassBlur,
  elements.glassOpacity,
  elements.glassBorder,
  elements.cornerRadius,
].forEach((input) => input.addEventListener("input", previewThemeSettings));

elements.themeSettingsReset.addEventListener("click", () => {
  setThemeSettingsForm(DEFAULT_THEME_SETTINGS);
  previewThemeSettings();
});

async function persistThemeSettings(noticeKey = "themeSettings.saved") {
  if (!siteState) return null;
  elements.themeSettingsSave.disabled = true;
  elements.themeSettingsSaveStatus.textContent = t("site.saving");
  try {
    const site = await adminApi.saveSite(siteSavePayload({
      themeSettings: themeSettingsDraft(),
    }), siteState.revision, session.csrfToken);
    fillSiteForm(site);
    editorController?.syncSiteSettings?.(site, site.revision);
    elements.themeSettingsSaveStatus.textContent = t(noticeKey);
    showNotice(t(noticeKey));
    return site;
  } catch (error) {
    if (await handleUnauthorized(error)) return null;
    elements.themeSettingsSaveStatus.textContent = error.message;
    showNotice(error.message, "error");
    if (error.status === 409) await loadSiteSettings();
    return null;
  } finally {
    elements.themeSettingsSave.disabled = false;
  }
}

elements.themeSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await persistThemeSettings();
});

async function uploadThemeBackground(mode) {
  if (!glassmorphismSettingsActive()) {
    showNotice(t("themeSettings.exclusiveNotice"), "error");
    return;
  }
  const controls = themeBackgroundControls(mode);
  const file = controls.file.files?.[0];
  if (!file) {
    showNotice(t("themeSettings.chooseFile"), "error");
    return;
  }
  if (file.size > 32 * 1024 * 1024) {
    showNotice(t("themeSettings.fileTooLarge"), "error");
    return;
  }

  const type = file.type.startsWith("video/") ? "video" : "image";
  controls.upload.disabled = true;
  try {
    const uploaded = await adminApi.uploadThemeBackground(mode, type, file, session.csrfToken);
    siteState = { ...siteState, backgroundAssets: uploaded.backgroundAssets };
    controls.source.value = uploaded.source;
    controls.file.value = "";
    elements.backgroundType.value = type;
    elements.backgroundEnabled.checked = true;
    updateThemeAssetStatus();
    previewThemeSettings();
    await persistThemeSettings("themeSettings.uploaded");
  } catch (error) {
    if (!await handleUnauthorized(error)) showNotice(error.message, "error");
  } finally {
    controls.upload.disabled = false;
  }
}

async function deleteThemeBackground(mode) {
  if (!glassmorphismSettingsActive()) {
    showNotice(t("themeSettings.exclusiveNotice"), "error");
    return;
  }
  const controls = themeBackgroundControls(mode);
  if (!siteState?.backgroundAssets?.[mode]?.exists || !window.confirm(t("themeSettings.deleteConfirm"))) return;
  controls.delete.disabled = true;
  try {
    const deleted = await adminApi.deleteThemeBackground(mode, session.csrfToken);
    siteState = { ...siteState, backgroundAssets: deleted.backgroundAssets };
    if (controls.source.value.trim() === `local:${mode}`) controls.source.value = "";
    updateThemeAssetStatus();
    previewThemeSettings();
    await persistThemeSettings("themeSettings.deleted");
  } catch (error) {
    if (!await handleUnauthorized(error)) showNotice(error.message, "error");
  } finally {
    controls.delete.disabled = !siteState?.backgroundAssets?.[mode]?.exists;
  }
}

elements.lightBackgroundUpload.addEventListener("click", () => uploadThemeBackground("light"));
elements.darkBackgroundUpload.addEventListener("click", () => uploadThemeBackground("dark"));
elements.lightBackgroundDelete.addEventListener("click", () => deleteThemeBackground("light"));
elements.darkBackgroundDelete.addEventListener("click", () => deleteThemeBackground("dark"));

elements.generalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!siteState) return;
  if (!validateHealthThresholdInputs()) {
    elements.generalForm.reportValidity();
    return;
  }
  elements.generalSave.disabled = true;
  elements.generalSaveStatus.textContent = t("site.saving");
  try {
    const site = await adminApi.saveSite(siteSavePayload({
      autoThemeBeijing: elements.autoTheme.checked,
      visualSettings: generalThemeDraft(),
      healthThresholds: healthThresholdDraft(),
      geoIp: { enabled: elements.geoIpEnabled.checked },
    }), siteState.revision, session.csrfToken);
    fillSiteForm(site);
    editorController?.syncSiteSettings?.(site, site.revision);
    elements.generalSaveStatus.textContent = t("general.saved");
    showNotice(t("general.saved"));
  } catch (error) {
    if (await handleUnauthorized(error)) return;
    elements.generalSaveStatus.textContent = error.message;
    showNotice(error.message, "error");
    if (error.status === 409) await loadSiteSettings();
  } finally {
    elements.generalSave.disabled = false;
  }
});

elements.geoIpUpdate.addEventListener("click", async () => {
  const enabledDraft = elements.geoIpEnabled.checked;
  let updateFailed = false;
  elements.geoIpUpdate.disabled = true;
  elements.geoIpStatus.textContent = t("geoIp.updating");
  try {
    const site = await adminApi.updateGeoIp(session.csrfToken);
    fillSiteForm(site);
    elements.geoIpEnabled.checked = enabledDraft;
    editorController?.syncSiteSettings?.(site, site.revision);
    showNotice(t("geoIp.updated"));
  } catch (error) {
    updateFailed = true;
    if (await handleUnauthorized(error)) return;
    elements.geoIpStatus.textContent = error.message;
    showNotice(error.message, "error");
  } finally {
    if (updateFailed) {
      const status = siteState?.geoIpStatus || {};
      elements.geoIpUpdate.disabled = !status.komariConfigured || !status.apiKeyConfigured;
    } else {
      updateGeoIpStatus(siteState);
    }
  }
});

elements.siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!siteState) return;
  elements.siteSave.disabled = true;
  elements.siteSaveStatus.textContent = t("site.saving");
  try {
    const site = await adminApi.saveSite(siteSavePayload({
      siteName: elements.siteName.value.trim(),
      description: elements.siteDescription.value.trim(),
    }), siteState.revision, session.csrfToken);
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

elements.komariApiKeySave.addEventListener("click", async () => {
  const apiKey = elements.komariApiKeyInput.value.trim();
  if (!apiKey) {
    showNotice(t("komariApiKey.required"), "error");
    elements.komariApiKeyInput.focus();
    return;
  }
  elements.komariApiKeySave.disabled = true;
  elements.komariApiKeyStatus.textContent = t("komariApiKey.saving");
  try {
    const site = await adminApi.saveKomariApiKey(apiKey, session.csrfToken);
    fillSiteForm(site);
    editorController?.syncSiteSettings?.(site, site.revision);
    const inventoryReady = await editorController?.refreshInventory?.();
    showNotice(
      t(inventoryReady === false ? "komariApiKey.savedInventoryUnavailable" : "komariApiKey.saved"),
      inventoryReady === false ? "error" : "success",
    );
  } catch (error) {
    if (!await handleUnauthorized(error)) showNotice(error.message, "error");
    updateKomariApiKeyStatus(siteState);
  } finally {
    elements.komariApiKeySave.disabled = false;
  }
});

elements.komariApiKeyClear.addEventListener("click", async () => {
  if (!siteState?.komariApiKey?.managed || !window.confirm(t("komariApiKey.clearConfirm"))) return;
  elements.komariApiKeyClear.disabled = true;
  try {
    const site = await adminApi.clearKomariApiKey(session.csrfToken);
    fillSiteForm(site);
    editorController?.syncSiteSettings?.(site, site.revision);
    const inventoryReady = await editorController?.refreshInventory?.();
    showNotice(
      t(inventoryReady === false ? "komariApiKey.clearedInventoryUnavailable" : "komariApiKey.cleared"),
      inventoryReady === false ? "error" : "success",
    );
  } catch (error) {
    if (!await handleUnauthorized(error)) showNotice(error.message, "error");
    updateKomariApiKeyStatus(siteState);
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
  updateThemeAssetStatus();
  updateGeoIpStatus();
  updateKomariApiKeyStatus();
  validateHealthThresholdInputs();
  if (siteState) updateSiteIdentity(siteState, { syncVisualTheme: false });
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
