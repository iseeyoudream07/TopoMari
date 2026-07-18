import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { getLanguage, setLanguage, t } from "../public/frontend/i18n.js";
import {
  defaultVisualThemeColors,
  normalizeVisualThemeSettings,
} from "../public/frontend/site-theme.js";
import {
  normalizeThemeSettings,
  resolveThemeBackgroundSource,
  supportsThemeDetails,
} from "../public/frontend/theme-background.js";

const indexUrl = new URL("../public/index.html", import.meta.url);
const adminIndexUrl = new URL("../public/admin/index.html", import.meta.url);
const stylesUrl = new URL("../public/styles.css", import.meta.url);
const themeUrl = new URL("../public/frontend/theme.css", import.meta.url);
const iconUrl = new URL("../public/favicon.png", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);
const adminUrl = new URL("../public/admin.js", import.meta.url);
const adminStylesUrl = new URL("../public/admin.css", import.meta.url);
const editorUrl = new URL("../public/editor.js", import.meta.url);
const apiUrl = new URL("../public/frontend/api-client.js", import.meta.url);
const preferenceBootstrapUrl = new URL("../public/frontend/preference-bootstrap.js", import.meta.url);
const siteThemeUrl = new URL("../public/frontend/site-theme.js", import.meta.url);
const themeBackgroundUrl = new URL("../public/frontend/theme-background.js", import.meta.url);
const routeGlobeUrl = new URL("../public/frontend/route-globe.js", import.meta.url);
const serverUrl = new URL("../server.mjs", import.meta.url);

test("ships persistent Chinese, English, light, and dark preferences", async () => {
  const [html, adminHtml, bootstrap, theme] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(adminIndexUrl, "utf8"),
    readFile(preferenceBootstrapUrl, "utf8"),
    readFile(themeUrl, "utf8"),
  ]);

  assert.match(adminHtml, /data-language-value="zh-CN"/);
  assert.match(adminHtml, /data-language-value="en"/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(bootstrap, /topomari-language/);
  assert.match(bootstrap, /topomari-theme/);
  assert.match(theme, /:root\[data-theme="light"\]/);
  assert.match(theme, /:root\[data-theme="dark"\]/);
});

test("uses browser preferences when storage is unavailable during bootstrap", async () => {
  const bootstrap = await readFile(preferenceBootstrapUrl, "utf8");

  const root = { dataset: {}, style: {}, lang: "" };
  const themeColor = {
    content: "#eeede5",
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  runInNewContext(bootstrap, {
    document: {
      documentElement: root,
      querySelector: (selector) => selector === 'meta[name="theme-color"]' ? themeColor : null,
    },
    localStorage: {
      getItem() {
        throw new Error("storage blocked");
      },
    },
    matchMedia: () => ({ matches: true }),
    navigator: { language: "zh-CN" },
  });

  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.lang, "zh-CN");
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(themeColor.content, "#1c1b19");
});

test("uses the circular TopoMari icon and requested interface fonts", async () => {
  const [html, styles, icon, server] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(iconUrl),
    readFile(serverUrl, "utf8"),
  ]);

  assert.match(html, /rel="icon" href="\/favicon"/);
  assert.match(html, /<img src="\/favicon" alt=""/);
  assert.match(html, /family=Arimo/);
  assert.match(html, /family=Noto\+Serif\+SC/);
  assert.match(styles, /--font-ui: "Arimo", "Noto Serif SC", serif/);
  assert.match(styles, /font-optical-sizing: auto/);
  assert.match(server, /style-src 'self' https:\/\/fonts\.googleapis\.com/);
  assert.match(server, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon[25], 6, "favicon must retain an alpha channel for transparent corners");
});

test("keeps TopoMari defaults while allowing admin-controlled site settings", async () => {
  const [html, adminHtml, app, admin, api, server, siteTheme, themeBackground] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(adminIndexUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(adminUrl, "utf8"),
    readFile(apiUrl, "utf8"),
    readFile(serverUrl, "utf8"),
    readFile(siteThemeUrl, "utf8"),
    readFile(themeBackgroundUrl, "utf8"),
  ]);

  assert.match(html, /<title>TopoMari<\/title>/);
  assert.match(html, /<h1 id="page-title">TopoMari<\/h1>/);
  assert.match(app, /document\.title = meta\.siteName \|\| "TopoMari"/);
  assert.match(app, /meta\.mainTitle \|\| meta\.title \|\| "TopoMari"/);
  assert.match(adminHtml, /id="site-name-input"/);
  assert.match(adminHtml, /id="site-description-input"/);
  assert.match(adminHtml, /id="favicon-file"/);
  assert.match(adminHtml, /id="auto-theme-beijing"/);
  assert.match(adminHtml, /data-admin-view="general"/);
  assert.match(adminHtml, /name="visual-theme" value="glassmorphism"/);
  assert.match(adminHtml, /id="custom-theme-colors"/);
  assert.match(adminHtml, /id="theme-light-background"/);
  assert.match(adminHtml, /data-admin-view="theme"/);
  assert.match(adminHtml, /data-admin-panel="theme"/);
  assert.match(adminHtml, /id="background-enabled"/);
  assert.match(adminHtml, /id="light-background-file"/);
  assert.match(adminHtml, /id="glass-opacity"/);
  assert.match(adminHtml, /sanrokamlan-prog\/komari-theme-Glassmorphism/);
  assert.match(html, /id="site-background"/);
  assert.match(admin, /adminApi\.saveSite/);
  assert.match(admin, /applySiteTheme/);
  assert.match(app, /applySiteTheme\(meta\)/);
  assert.match(app, /applyThemeSettings\(meta\)/);
  assert.match(api, /saveSite\(settings, revision, csrfToken\)/);
  assert.match(siteTheme, /VISUAL_THEME_DEFAULTS/);
  assert.match(themeBackground, /theme-background\/\$\{mode\}/);
  assert.match(server, /\/api\/admin\/site/);
  assert.match(api, /\/api\/admin\/theme\/background/);
  assert.match(server, /sanitizeSiteSettings/);
});

test("keeps the admin login page concise", async () => {
  const adminHtml = await readFile(adminIndexUrl, "utf8");
  assert.match(adminHtml, /id="login-title"[^>]*>登录<\/h1>/);
  assert.match(adminHtml, /class="back-home-link"[^>]*>返回<\/a>/);
  assert.doesNotMatch(adminHtml, /登录后台管理|公开面板无需登录|返回公开面板/);
});

test("normalizes visual theme presets and custom colors in the frontend", () => {
  assert.deepEqual(defaultVisualThemeColors("glassmorphism"), {
    lightBackground: "#e8edf4",
    lightAccent: "#059669",
    darkBackground: "#0b1020",
    darkAccent: "#34d399",
  });
  assert.deepEqual(normalizeVisualThemeSettings({
    visualTheme: "glassmorphism",
    customThemeColors: true,
    themeColors: { lightBackground: "#ABCDEF", lightAccent: "bad" },
  }), {
    visualTheme: "glassmorphism",
    customThemeColors: true,
    themeColors: {
      lightBackground: "#abcdef",
      lightAccent: "#059669",
      darkBackground: "#0b1020",
      darkAccent: "#34d399",
    },
  });
});

test("normalizes public background and glass controls without unsafe URLs", () => {
  assert.deepEqual(normalizeThemeSettings({
    backgroundEnabled: true,
    backgroundType: "video",
    lightBackground: "local:light",
    darkBackground: "javascript:alert(1)",
    backgroundBlur: 14,
    backgroundOverlay: 35,
    glassBlur: 24,
    glassOpacity: 67,
    glassBorder: 44,
    cornerRadius: 22,
  }), {
    backgroundEnabled: true,
    backgroundType: "video",
    lightBackground: "local:light",
    darkBackground: "",
    backgroundBlur: 14,
    backgroundOverlay: 35,
    glassBlur: 24,
    glassOpacity: 67,
    glassBorder: 44,
    cornerRadius: 22,
  });
  assert.equal(resolveThemeBackgroundSource("local:dark", "dark"), "/theme-background/dark");
  assert.equal(supportsThemeDetails("glassmorphism"), true);
  assert.equal(supportsThemeDetails("topomari"), false);
});

test("ships the compact route-globe overview and Glassmorphism-only detail controls", async () => {
  const [html, app, globe, adminHtml, admin, themeBackground, server] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(routeGlobeUrl, "utf8"),
    readFile(adminIndexUrl, "utf8"),
    readFile(adminUrl, "utf8"),
    readFile(themeBackgroundUrl, "utf8"),
    readFile(serverUrl, "utf8"),
  ]);

  assert.equal([...html.matchAll(/class="stat-card"/g)].length, 6);
  assert.match(html, /id="route-globe-canvas"/);
  assert.match(html, /id="stat-alerts"/);
  assert.match(app, /createRouteGlobe/);
  assert.match(app, /routeGlobe\?\.update\(routes \|\| \[\]\)/);
  assert.match(globe, /buildRouteLinks/);
  assert.match(globe, /requestAnimationFrame/);
  assert.doesNotMatch(globe, /\bfetch\s*\(/);
  assert.match(adminHtml, /id="theme-settings-lock"/);
  assert.match(adminHtml, /id="theme-settings-controls"/);
  assert.match(admin, /glassmorphismSettingsActive/);
  assert.match(admin, /themeSettings\.exclusiveNotice/);
  assert.match(themeBackground, /supportsThemeDetails\(root\.dataset\.visualTheme\)/);
  assert.match(server, /Theme backgrounds are available only while Glassmorphism is active/);
});

test("keeps the public dashboard concise and moves management into the admin page", async () => {
  const [html, adminHtml, adminStyles] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(adminIndexUrl, "utf8"),
    readFile(adminStylesUrl, "utf8"),
  ]);

  assert.doesNotMatch(html, /section-kicker|page-subtitle|legend-note/);
  assert.doesNotMatch(html, /<footer[\s>]/);
  assert.doesNotMatch(html, /id="topology-manager"|id="manager-toggle"|id="refresh-button"/);
  assert.doesNotMatch(html, /data-language-value=/);
  assert.match(html, /id="last-updated"/);
  assert.match(html, /id="source-chip"/);
  assert.match(html, /Komari \+ 私有探针/);
  assert.match(html, /href="\/admin"/);
  assert.match(adminHtml, /data-admin-view="routes"/);
  assert.match(adminHtml, /data-admin-view="theme"/);
  assert.match(adminHtml, /id="settings-toggle"/);
  assert.match(adminHtml, /data-admin-panel="general"/);
  assert.match(adminHtml, /data-admin-view="site"/);
  assert.match(adminHtml, /data-i18n="deploy\.help"/);
  assert.match(adminStyles, /\.admin-callout\[hidden\]\s*\{\s*display:\s*none/s);
});

test("admin scripts only bind IDs shipped by the admin page", async () => {
  const [adminHtml, admin] = await Promise.all([
    readFile(adminIndexUrl, "utf8"),
    readFile(adminUrl, "utf8"),
  ]);
  const ids = new Set([...adminHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const referenced = [...admin.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(referenced.filter((id) => !ids.has(id)), []);
});

test("keeps browser requests behind the frontend API client", async () => {
  const [app, admin, editor, api] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(adminUrl, "utf8"),
    readFile(editorUrl, "utf8"),
    readFile(apiUrl, "utf8"),
  ]);

  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch(admin, /\bfetch\s*\(/);
  assert.doesNotMatch(editor, /\bfetch\s*\(/);
  assert.match(api, /\bfetch\s*\(/);
  assert.match(app, /dashboardApi\.snapshot/);
  assert.match(admin, /authApi\.login/);
  assert.match(editor, /editorApi\.saveTopology/);
});

test("serves the public dashboard without an authentication challenge and gates admin APIs", async () => {
  const server = await readFile(serverUrl, "utf8");

  assert.match(server, /url\.pathname === "\/api\/dashboard"/);
  assert.match(server, /const principal = requireAdmin\(request, response\)/);
  assert.match(server, /url\.pathname\.startsWith\("\/api\/admin\/"\)/);
  assert.match(server, /url\.pathname\.startsWith\("\/api\/editor\/"\)/);
  assert.equal(server.includes("theme-background\\/(light|dark)"), true);
  assert.match(server, /media-src 'self' blob: https: http:/);
  assert.doesNotMatch(server, /WWW-Authenticate/);
});

test("translates static and parameterized dashboard copy", () => {
  const initialLanguage = getLanguage();

  setLanguage("zh-CN");
  assert.equal(t("stats.routes"), "活动链路");
  assert.equal(t("stats.nodesOffline", { count: 2 }), "2 个节点离线");

  setLanguage("en");
  assert.equal(t("stats.routes"), "Active routes");
  assert.equal(t("stats.nodesOffline", { count: 2 }), "2 node(s) offline");

  setLanguage(initialLanguage);
});
