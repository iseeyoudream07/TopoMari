import { getLanguage, initI18n, setLanguage, t } from "./i18n.js";

const THEME_KEY = "topomari-theme";
const THEMES = new Set(["light", "dark"]);

let followsSystemTheme = false;

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
  button.setAttribute("aria-label", action);
  button.setAttribute("title", action);
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
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", resolved === "dark" ? "#1c1b19" : "#eeede5");
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

export function initPreferences() {
  initI18n();
  applyTheme(storedTheme());
  syncLanguageControls();

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark", { persist: true });
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
