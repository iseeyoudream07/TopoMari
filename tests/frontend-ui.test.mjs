import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { getLanguage, setLanguage, t } from "../public/frontend/i18n.js";

const indexUrl = new URL("../public/index.html", import.meta.url);
const stylesUrl = new URL("../public/styles.css", import.meta.url);
const themeUrl = new URL("../public/frontend/theme.css", import.meta.url);
const iconUrl = new URL("../public/favicon.png", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);
const editorUrl = new URL("../public/editor.js", import.meta.url);
const apiUrl = new URL("../public/frontend/api-client.js", import.meta.url);
const serverUrl = new URL("../server.mjs", import.meta.url);

test("ships persistent Chinese, English, light, and dark preferences", async () => {
  const [html, theme] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(themeUrl, "utf8"),
  ]);

  assert.match(html, /data-language-value="zh-CN"/);
  assert.match(html, /data-language-value="en"/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /topomari-language/);
  assert.match(html, /topomari-theme/);
  assert.match(theme, /:root\[data-theme="light"\]/);
  assert.match(theme, /:root\[data-theme="dark"\]/);
});

test("uses browser preferences when storage is unavailable during bootstrap", async () => {
  const html = await readFile(indexUrl, "utf8");
  const bootstrap = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap, "expected an inline preference bootstrap script");

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

test("uses the TopoMari icon and requested interface fonts", async () => {
  const [html, styles, icon, server] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(iconUrl),
    readFile(serverUrl, "utf8"),
  ]);

  assert.match(html, /rel="icon" href="\/favicon\.png"/);
  assert.match(html, /<img src="\/favicon\.png" alt=""/);
  assert.match(html, /family=Arimo/);
  assert.match(html, /family=Noto\+Serif\+TC/);
  assert.match(styles, /--font-ui: "Arimo", "Noto Serif TC"/);
  assert.match(styles, /font-optical-sizing: auto/);
  assert.match(server, /style-src 'self' https:\/\/fonts\.googleapis\.com/);
  assert.match(server, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("keeps the main dashboard copy concise", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.doesNotMatch(html, /section-kicker|page-subtitle|legend-note/);
  assert.doesNotMatch(html, /<footer[\s>]/);
  assert.match(html, /id="last-updated"/);
  assert.match(html, /data-i18n="deploy\.help"/);
});

test("keeps browser requests behind the frontend API client", async () => {
  const [app, editor, api] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(editorUrl, "utf8"),
    readFile(apiUrl, "utf8"),
  ]);

  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch(editor, /\bfetch\s*\(/);
  assert.match(api, /\bfetch\s*\(/);
  assert.match(app, /dashboardApi\.snapshot/);
  assert.match(editor, /editorApi\.saveTopology/);
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
