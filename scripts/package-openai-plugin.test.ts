import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createPackage, validatePackage } from "./package-openai-plugin.ts";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "leadmagic-package-test-"));
  temporaryDirectories.push(directory);
  for (const filename of ["plugin.json", "mcp.json", "package.json", "icon.png", "chatgpt-composer-icon.png", "skills"]) cpSync(path.join(root, filename), path.join(directory, filename), { recursive: true });
  return directory;
}

test("credentials and reviewer instructions cannot enter the public package", () => {
  const directory = fixture();
  const original = readFileSync(path.join(directory, "plugin.json"), "utf8");
  writeFileSync(path.join(directory, "plugin.json"), original.replace('"commerce": false', '"commerce": false, "test_credentials": {"password": "synthetic-test-only"}'));
  assert.ok(validatePackage(directory).some(error => error.includes("secure portal")));
});

test("authored JavaScript and credential headers fail validation", () => {
  const directory = fixture();
  writeFileSync(path.join(directory, "unsafe.mjs"), "export {};\n");
  writeFileSync(path.join(directory, "mcp.json"), JSON.stringify({ mcpServers: { leadmagic: { type: "streamable-http", url: "https://mcp.leadmagic.io/mcp", headers: { Authorization: "synthetic-test-only" } } } }));
  const errors = validatePackage(directory);
  assert.ok(errors.some(error => error.includes("TypeScript")));
  assert.ok(errors.some(error => error.includes("credential headers")));
});

test("assets cannot link outside the public package", () => {
  const directory = fixture();
  const external = path.join(path.dirname(directory), `${path.basename(directory)}-private.png`);
  writeFileSync(external, "synthetic-test-only");
  try {
    rmSync(path.join(directory, "icon.png"));
    symlinkSync(external, path.join(directory, "icon.png"));
    assert.ok(validatePackage(directory).some(error => error.includes("leaves the public package")));
  } finally { rmSync(external); }
});

test("ZIP generation replaces stale archives and excludes repository and registry files", () => {
  const directory = fixture();
  const output = path.join(path.dirname(directory), `${path.basename(directory)}.zip`);
  writeFileSync(path.join(directory, "private-note.txt"), "synthetic-test-only");
  writeFileSync(path.join(directory, "server.json"), "{}\n");
  try {
    assert.equal(spawnSync("zip", ["-q", output, "private-note.txt"], { cwd: directory }).status, 0);
    createPackage(directory, output);
    const archive = spawnSync("unzip", ["-Z1", output], { encoding: "utf8" });
    assert.equal(archive.status, 0);
    assert.deepEqual(archive.stdout.trim().split("\n").sort(), ["plugin.json", "mcp.json", "icon.png", "chatgpt-composer-icon.png", "skills/leadmagic-tables/SKILL.md"].sort());
  } finally { rmSync(output, { force: true }); }
});
