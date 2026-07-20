import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  KomariCredentialStore,
  normalizeKomariApiKey,
} from "../lib/komari-credential-store.mjs";

test("normalizes Komari bearer tokens without exposing them through state", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "topomari-komari-credential-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "komari-api-key");
  const store = new KomariCredentialStore(filePath, { fallbackApiKey: "environment-key" });

  assert.deepEqual(await store.reload(), { configured: true, managed: false });
  assert.equal(store.apiKey, "environment-key");

  assert.deepEqual(await store.set("Bearer dashboard-key"), { configured: true, managed: true });
  assert.equal(store.apiKey, "dashboard-key");
  assert.equal(await readFile(filePath, "utf8"), "dashboard-key\n");
  if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(store.state()), /dashboard-key|environment-key/);

  assert.deepEqual(await store.clear(), { configured: true, managed: false });
  assert.equal(store.apiKey, "environment-key");
});

test("rejects empty, multiline, and oversized managed API keys", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "topomari-komari-credential-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new KomariCredentialStore(join(directory, "komari-api-key"));

  await assert.rejects(store.set("   "), /required/);
  assert.throws(() => normalizeKomariApiKey("one\ntwo"), /single line/);
  assert.throws(() => normalizeKomariApiKey("x".repeat(4097)), /4096/);
});
