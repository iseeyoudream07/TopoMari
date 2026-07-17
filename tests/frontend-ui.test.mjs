import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getLanguage, setLanguage, t } from "../public/frontend/i18n.js";

const indexUrl = new URL("../public/index.html", import.meta.url);
const themeUrl = new URL("../public/frontend/theme.css", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);
const editorUrl = new URL("../public/editor.js", import.meta.url);
const apiUrl = new URL("../public/frontend/api-client.js", import.meta.url);

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
