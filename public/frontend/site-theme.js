const VISUAL_THEMES = new Set(["topomari", "glassmorphism"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const VISUAL_THEME_DEFAULTS = Object.freeze({
  topomari: Object.freeze({
    lightBackground: "#eeede5",
    lightAccent: "#a7622d",
    darkBackground: "#1c1b19",
    darkAccent: "#e4a35f",
  }),
  glassmorphism: Object.freeze({
    lightBackground: "#e8edf4",
    lightAccent: "#059669",
    darkBackground: "#0b1020",
    darkAccent: "#34d399",
  }),
});

function validColor(value, fallback) {
  const color = String(value || "").trim().toLowerCase();
  return HEX_COLOR.test(color) ? color : fallback;
}

export function defaultVisualThemeColors(visualTheme) {
  const resolved = VISUAL_THEMES.has(visualTheme) ? visualTheme : "topomari";
  return { ...VISUAL_THEME_DEFAULTS[resolved] };
}

export function normalizeVisualThemeSettings(value = {}) {
  const visualTheme = VISUAL_THEMES.has(value.visualTheme) ? value.visualTheme : "topomari";
  const defaults = defaultVisualThemeColors(visualTheme);
  const colors = value.themeColors || {};
  return {
    visualTheme,
    customThemeColors: value.customThemeColors === true,
    themeColors: {
      lightBackground: validColor(colors.lightBackground, defaults.lightBackground),
      lightAccent: validColor(colors.lightAccent, defaults.lightAccent),
      darkBackground: validColor(colors.darkBackground, defaults.darkBackground),
      darkAccent: validColor(colors.darkAccent, defaults.darkAccent),
    },
  };
}

let activeSettings = normalizeVisualThemeSettings();

export function syncSiteThemeColor() {
  if (typeof document === "undefined") return;
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const presetColors = VISUAL_THEME_DEFAULTS[activeSettings.visualTheme];
  const colors = activeSettings.customThemeColors ? activeSettings.themeColors : presetColors;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute("content", theme === "dark" ? colors.darkBackground : colors.lightBackground);
}

export function applySiteTheme(value = {}) {
  activeSettings = normalizeVisualThemeSettings(value);
  if (typeof document === "undefined") return activeSettings;

  const root = document.documentElement;
  root.dataset.visualTheme = activeSettings.visualTheme;
  root.dataset.customThemeColors = String(activeSettings.customThemeColors);
  const propertyMap = {
    "--site-light-background": activeSettings.themeColors.lightBackground,
    "--site-light-accent": activeSettings.themeColors.lightAccent,
    "--site-dark-background": activeSettings.themeColors.darkBackground,
    "--site-dark-accent": activeSettings.themeColors.darkAccent,
  };
  for (const [property, color] of Object.entries(propertyMap)) {
    if (activeSettings.customThemeColors) root.style.setProperty(property, color);
    else root.style.removeProperty(property);
  }
  syncSiteThemeColor();
  return activeSettings;
}
