import { getLanguage, initI18n, setLanguage, t } from "./i18n.js?v=2.8.4-ui5";
import { nextBeijingSolarTransition, themeForBeijingInstant } from "./solar-theme.js";
import { syncSiteThemeColor } from "./site-theme.js";

const THEME_KEY = "topomari-theme";
const THEMES = new Set(["light", "dark"]);

let followsSystemTheme = false;
let autoThemeBeijing = false;
let autoThemeTimer = null;
let manualOverrideUntil = 0;

function systemTheme() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (THEMES.has(value)) return value;
  } catch {
    // Use the system preference when storage is unavailable.
  }
  followsSystemTheme = true;
  return systemTheme();
}

function currentTheme() {
  const value = document.documentElement.dataset.theme;
  return THEMES.has(value) ? value : systemTheme();
}

function syncThemeControl() {
  const button = document.getElementById("theme-toggle");
  if (!button) return;
  const theme = currentTheme();
  const isDark = theme === "dark";
  const action = t(isDark ? "theme.switchToLight" : "theme.switchToDark");
  button.dataset.theme = theme;
  button.dataset.autoThemeBeijing = String(autoThemeBeijing);
  button.setAttribute("aria-label", action);
  button.setAttribute("title", autoThemeBeijing ? `${action} · ${t("theme.autoBeijingActive")}` : action);
}

function syncLanguageControls() {
  const language = getLanguage();
  document.querySelectorAll("[data-language-value]").forEach((button) => {
    const selected = button.dataset.languageValue === language;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function applyTheme(theme, { persist = false } = {}) {
  const resolved = THEMES.has(theme) ? theme : systemTheme();
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  syncSiteThemeColor();
  if (persist) {
    followsSystemTheme = false;
    try {
      localStorage.setItem(THEME_KEY, resolved);
    } catch {
      // The theme still applies for the current page.
    }
  }
  syncThemeControl();
}

function scheduleBeijingTheme({ apply = true } = {}) {
  window.clearTimeout(autoThemeTimer);
  if (!autoThemeBeijing) return;
  const now = new Date();
  const transition = nextBeijingSolarTransition(now);
  if (apply && Date.now() >= manualOverrideUntil) {
    manualOverrideUntil = 0;
    applyTheme(themeForBeijingInstant(now));
  }
  const delay = Math.min(2_147_000_000, Math.max(1_000, transition.getTime() - now.getTime() + 1_000));
  autoThemeTimer = window.setTimeout(() => {
    manualOverrideUntil = 0;
    scheduleBeijingTheme();
  }, delay);
}

export function setAutoThemeBeijing(enabled) {
  const next = enabled === true;
  if (autoThemeBeijing === next) {
    if (next) scheduleBeijingTheme({ apply: Date.now() >= manualOverrideUntil });
    return;
  }
  autoThemeBeijing = next;
  manualOverrideUntil = 0;
  if (next) scheduleBeijingTheme();
  else {
    window.clearTimeout(autoThemeTimer);
    applyTheme(storedTheme());
  }
  syncThemeControl();
}

export function initPreferences() {
  initI18n();
  applyTheme(storedTheme());
  syncLanguageControls();

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    if (autoThemeBeijing) {
      manualOverrideUntil = nextBeijingSolarTransition(new Date()).getTime();
      applyTheme(next);
      scheduleBeijingTheme({ apply: false });
      return;
    }
    applyTheme(next, { persist: true });
  });

  document.querySelectorAll("[data-language-value]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.languageValue));
  });

  document.addEventListener("topomari:languagechange", () => {
    syncLanguageControls();
    syncThemeControl();
  });

  if (window.matchMedia) {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", () => {
      if (followsSystemTheme) applyTheme(systemTheme());
    });
  }
}
