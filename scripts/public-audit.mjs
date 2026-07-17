#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const requiredFiles = [
  ".env.example",
  ".github/workflows/ci.yml",
  "config/agents.example.json",
  "config/topology.example.json",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
];
const forbiddenExact = new Set([
  ".env",
  "config/agents.json",
  "config/topology.json",
]);
const forbiddenSuffixes = [
  ".db",
  ".db-shm",
  ".db-wal",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".zip",
  ".zip.sha256",
];
const ignoredDirectories = new Set([".git", "node_modules"]);
const scannerPath = "scripts/public-audit.mjs";
const findings = [];
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    const path = relative(rootDir, absolute).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (entry.isSymbolicLink()) {
      findings.push(`${path}: symbolic links require manual review`);
      continue;
    }
    if (entry.isFile()) files.push(path);
  }
}

try {
  const output = execFileSync("git", ["-C", rootDir, "ls-files", "-co", "--exclude-standard"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  files.push(...output.split("\n").map((path) => path.trim()).filter(Boolean));
} catch {
  await walk(rootDir);
}

for (let index = files.length - 1; index >= 0; index -= 1) {
  try {
    await lstat(resolve(rootDir, files[index]));
  } catch (error) {
    if (error?.code === "ENOENT") {
      files.splice(index, 1);
      continue;
    }
    throw error;
  }
}

files.sort();

for (const path of requiredFiles) {
  if (!files.includes(path)) findings.push(`${path}: required public repository file is missing`);
}

for (const path of files) {
  const info = await lstat(resolve(rootDir, path));
  if (info.isSymbolicLink()) {
    findings.push(`${path}: symbolic links require manual review`);
    continue;
  }
  if (forbiddenExact.has(path)) findings.push(`${path}: runtime configuration must not be published`);
  if (path.startsWith("data/") && path !== "data/.gitkeep") {
    findings.push(`${path}: runtime data must not be published`);
  }
  if (forbiddenSuffixes.some((suffix) => path.toLowerCase().endsWith(suffix))) {
    findings.push(`${path}: archive, credential, or database file must not be published`);
  }
}

const secretPatterns = [
  ["private key", new RegExp(`-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----`)],
  ["AWS access key", new RegExp(`(?:AKIA|ASIA)[0-9A-Z]{16}`)],
  ["GitHub token", new RegExp(`(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}`)],
  ["OpenAI-style key", new RegExp(`sk-[A-Za-z0-9_-]{20,}`)],
  ["Slack token", new RegExp(`xox[baprs]-[A-Za-z0-9-]{10,}`)],
  ["user home path", new RegExp(`(?:/Users/[^/\\s]+|/home/[A-Za-z0-9._-]+/)`)],
];

for (const path of files) {
  if (path === scannerPath) continue;
  const absolute = resolve(rootDir, path);
  if ((await lstat(absolute)).size > 1_000_000) continue;
  let content;
  try {
    content = await readFile(absolute, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) findings.push(`${path}: possible ${label}`);
  }
}

if (findings.length) {
  console.error("Public repository audit failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Public repository audit passed (${files.length} files scanned).`);
