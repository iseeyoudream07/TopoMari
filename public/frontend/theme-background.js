const BACKGROUND_TYPES = new Set(["image", "video"]);

export const DEFAULT_THEME_SETTINGS = Object.freeze({
  backgroundEnabled: false,
  backgroundType: "image",
  lightBackground: "",
  darkBackground: "",
  backgroundBlur: 0,
  backgroundOverlay: 0,
  glassBlur: 18,
  glassOpacity: 78,
  glassBorder: 18,
  cornerRadius: 18,
});

function finiteNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, number)));
}

function safeBackgroundSource(value, mode) {
  const source = String(value ?? "").trim().slice(0, 1_000);
  if (!source) return "";
  if (source === `local:${mode}`) return source;
  if (source.startsWith("/") && !source.startsWith("//")) return source;
  try {
    const parsed = new URL(source);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

export function normalizeThemeSettings(value) {
  const source = value?.themeSettings ?? value?.theme_settings ?? value ?? {};
  const requestedType = String(source.backgroundType ?? source.background_type ?? "image").toLowerCase();
  return {
    backgroundEnabled: source.backgroundEnabled === undefined
      ? source.background_enabled === true
      : source.backgroundEnabled === true,
    backgroundType: BACKGROUND_TYPES.has(requestedType) ? requestedType : DEFAULT_THEME_SETTINGS.backgroundType,
    lightBackground: safeBackgroundSource(source.lightBackground ?? source.light_background, "light"),
    darkBackground: safeBackgroundSource(source.darkBackground ?? source.dark_background, "dark"),
    backgroundBlur: finiteNumber(
      source.backgroundBlur ?? source.background_blur,
      DEFAULT_THEME_SETTINGS.backgroundBlur,
      0,
      40,
    ),
    backgroundOverlay: finiteNumber(
      source.backgroundOverlay ?? source.background_overlay,
      DEFAULT_THEME_SETTINGS.backgroundOverlay,
      -100,
      100,
    ),
    glassBlur: finiteNumber(source.glassBlur ?? source.glass_blur, DEFAULT_THEME_SETTINGS.glassBlur, 0, 30),
    glassOpacity: finiteNumber(
      source.glassOpacity ?? source.glass_opacity,
      DEFAULT_THEME_SETTINGS.glassOpacity,
      45,
      100,
    ),
    glassBorder: finiteNumber(
      source.glassBorder ?? source.glass_border,
      DEFAULT_THEME_SETTINGS.glassBorder,
      0,
      100,
    ),
    cornerRadius: finiteNumber(
      source.cornerRadius ?? source.corner_radius,
      DEFAULT_THEME_SETTINGS.cornerRadius,
      8,
      28,
    ),
  };
}

export function resolveThemeBackgroundSource(source, mode) {
  return source === `local:${mode}` ? `/theme-background/${mode}` : source;
}

let currentSettings = normalizeThemeSettings({});
let observedRoot = null;
let themeObserver = null;
let imageLoader = null;
let mediaKey = "";

function backgroundElements() {
  return {
    container: document.getElementById("site-background"),
    media: document.getElementById("site-background-media"),
    image: document.getElementById("site-background-image"),
    video: document.getElementById("site-background-video"),
    overlay: document.getElementById("site-background-overlay"),
  };
}

function clearImageLoader() {
  if (!imageLoader) return;
  imageLoader.onload = null;
  imageLoader.onerror = null;
  imageLoader = null;
}

function resetVideo(video) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function syncBackgroundMedia() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const { container, media, image, video, overlay } = backgroundElements();
  if (!container || !media || !image || !video || !overlay) return;

  const mode = root.dataset.theme === "dark" ? "dark" : "light";
  const configuredSource = mode === "dark" ? currentSettings.darkBackground : currentSettings.lightBackground;
  const source = resolveThemeBackgroundSource(configuredSource, mode);
  const enabled = currentSettings.backgroundEnabled && Boolean(source);
  const nextMediaKey = enabled ? `${mode}:${currentSettings.backgroundType}:${source}` : "";

  root.dataset.customBackground = String(enabled);
  container.hidden = !enabled;
  media.style.filter = currentSettings.backgroundBlur > 0 ? `blur(${currentSettings.backgroundBlur}px)` : "none";
  media.style.opacity = currentSettings.backgroundOverlay < 0
    ? String(1 - Math.abs(currentSettings.backgroundOverlay) / 100)
    : "1";
  overlay.style.backgroundColor = currentSettings.backgroundOverlay > 0
    ? `rgba(0, 0, 0, ${currentSettings.backgroundOverlay / 100})`
    : "transparent";

  if (!enabled) {
    clearImageLoader();
    image.hidden = true;
    image.style.backgroundImage = "";
    video.hidden = true;
    resetVideo(video);
    mediaKey = "";
    return;
  }
  if (nextMediaKey === mediaKey) return;
  mediaKey = nextMediaKey;
  container.dataset.status = "loading";

  if (currentSettings.backgroundType === "video") {
    clearImageLoader();
    image.hidden = true;
    image.style.backgroundImage = "";
    video.hidden = false;
    video.src = source;
    video.load();
    video.play().catch(() => {});
    return;
  }

  video.hidden = true;
  resetVideo(video);
  image.hidden = false;
  clearImageLoader();
  imageLoader = new Image();
  imageLoader.onload = () => {
    image.style.backgroundImage = `url(${JSON.stringify(source)})`;
    container.dataset.status = "ready";
    clearImageLoader();
  };
  imageLoader.onerror = () => {
    image.style.backgroundImage = "";
    container.dataset.status = "error";
    clearImageLoader();
  };
  imageLoader.src = source;
}

function ensureThemeObserver() {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  const root = document.documentElement;
  if (observedRoot === root && themeObserver) return;
  themeObserver?.disconnect();
  observedRoot = root;
  themeObserver = new MutationObserver((records) => {
    if (records.some((record) => record.attributeName === "data-theme")) syncBackgroundMedia();
  });
  themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  const { container, video } = backgroundElements();
  video?.addEventListener("loadeddata", () => {
    if (container) container.dataset.status = "ready";
  });
  video?.addEventListener("error", () => {
    if (container) container.dataset.status = "error";
  });
}

export function applyThemeSettings(value) {
  currentSettings = normalizeThemeSettings(value);
  if (typeof document === "undefined") return currentSettings;
  const root = document.documentElement;
  root.style.setProperty("--site-glass-blur", `${currentSettings.glassBlur}px`);
  root.style.setProperty("--site-glass-opacity", `${currentSettings.glassOpacity}%`);
  root.style.setProperty("--site-glass-border-opacity", `${currentSettings.glassBorder}%`);
  root.style.setProperty("--site-corner-radius", `${currentSettings.cornerRadius}px`);
  ensureThemeObserver();
  syncBackgroundMedia();
  return currentSettings;
}
