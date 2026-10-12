#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const packageFiles = ["plugin.json", "mcp.json", "icon.png", "chatgpt-composer-icon.png", "skills/leadmagic-tables/SKILL.md"];
const hiddenCredentialKeys = new Set(["test_credentials", "reviewer_instructions", "password", "clientSecret", "access_token", "refresh_token", "api_key"]);
const unsupportedHttpTools = /http request|http integration|(?:test|save|update|draft|parse)_sheet_http/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readJson(directory: string, filename: string): unknown {
  return JSON.parse(readFileSync(path.join(directory, filename), "utf8"));
}

function containsCredentials(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentials);
  return isRecord(value) && Object.entries(value).some(([key, child]) => hiddenCredentialKeys.has(key) || containsCredentials(child));
}

function authoredJavaScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "artifacts"].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return authoredJavaScript(filename);
    return /\.(?:js|mjs|cjs)$/.test(entry.name) ? [filename] : [];
  });
}

export function validatePackage(directory: string): string[] {
  const errors: string[] = [];
  let manifest: Record<string, unknown>;
  let mcp: Record<string, unknown>;
  try {
    manifest = record(readJson(directory, "plugin.json"));
    mcp = record(readJson(directory, "mcp.json"));
  } catch {
    return ["plugin.json and mcp.json must contain valid JSON"];
  }
  const packageMetadata = record(readJson(directory, "package.json"));
  const openai = record(record(manifest.extensions)["com.openai"]);
  const ui = record(openai.interface);
  const review = record(openai.review);
  const cases = record(review.test_cases);
  const positive = Array.isArray(cases.positive) ? cases.positive : [];
  const negative = Array.isArray(cases.negative) ? cases.negative : [];
  const servers = record(mcp.mcpServers);

  if (manifest.name !== "app-69eb2710b3748191b3eac40b5218144c") errors.push("plugin identity changed");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version !== packageMetadata.version) errors.push("plugin and package versions must match and use semantic versioning");
  if (!isRecord(openai.interface)) errors.push("OpenAI listing interface is missing");
  if (positive.length !== 5) errors.push("exactly five positive review cases are required");
  if (negative.length !== 3) errors.push("exactly three negative review cases are required");
  if (Object.keys(servers).length !== 1) errors.push("exactly one MCP server must be declared");
  if (containsCredentials(manifest) || containsCredentials(mcp)) errors.push("reviewer credentials and secret values belong in the secure portal, never the public package");

  for (const [index, value] of positive.entries()) {
    const test = record(value);
    for (const field of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
      if (typeof test[field] !== "string" || !test[field].trim()) errors.push(`positive case ${index + 1} is missing ${field}`);
    }
    if (unsupportedHttpTools.test(JSON.stringify(test))) errors.push(`positive case ${index + 1} must not describe HTTP request integrations`);
  }
  for (const [index, value] of negative.entries()) {
    const test = record(value);
    for (const field of ["description", "prompt"]) {
      if (typeof test[field] !== "string" || !test[field].trim()) errors.push(`negative case ${index + 1} is missing ${field}`);
    }
  }

  const skillPath = path.join(directory, "skills/leadmagic-tables/SKILL.md");
  if (!existsSync(skillPath)) errors.push("packaged LeadMagic Tables skill is missing");
  else if (unsupportedHttpTools.test(`${manifest.description} ${ui.longDescription} ${JSON.stringify(ui.capabilities)} ${readFileSync(skillPath, "utf8")}`)) errors.push("public listing and skill must not describe HTTP request integrations");

  for (const asset of [ui.composerIcon, ui.logo]) {
    if (typeof asset !== "string" || !["./icon.png", "./chatgpt-composer-icon.png"].includes(asset)) {
      errors.push("composer icon and logo must use packaged asset paths");
      continue;
    }
    const filename = path.join(directory, asset);
    if (!existsSync(filename) || !statSync(filename).isFile()) errors.push(`missing listing asset: ${asset}`);
    else if (!realpathSync(filename).startsWith(`${realpathSync(directory)}${path.sep}`)) errors.push(`listing asset leaves the public package: ${asset}`);
  }

  for (const [name, value] of Object.entries(servers)) {
    const server = record(value);
    if (server.type !== "streamable-http" || server.url !== "https://mcp.leadmagic.io/mcp") errors.push(`${name} must use the public Streamable HTTP MCP endpoint`);
    if (record(record(server.extensions)["com.openai"]).auth !== undefined) errors.push(`${name} must preserve the existing portal authentication without an auth override`);
    if (server.headers !== undefined) errors.push(`${name} must not contain credential headers`);
  }
  if (authoredJavaScript(directory).length > 0) errors.push("authored source and build scripts must use TypeScript");
  return errors;
}

export function createPackage(directory: string, output: string): void {
  const errors = validatePackage(directory);
  if (errors.length) throw new Error(errors.join("\n"));
  const destination = path.resolve(output);
  if (destination === directory || destination.startsWith(`${directory}${path.sep}`)) throw new Error("write the generated ZIP outside the source package directory");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "leadmagic-plugin-"));
  try {
    const archive = path.join(temporary, "plugin.zip");
    const zip = spawnSync("zip", ["-q", "-X", archive, ...packageFiles], { cwd: directory, encoding: "utf8" });
    if (zip.error || zip.status !== 0) throw new Error(zip.error?.message ?? zip.stderr ?? "zip command failed");
    renameSync(archive, destination);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validatePackage(root);
  if (errors.length) {
    console.error(errors.map((error) => `ERROR: ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    const manifest = record(readJson(root, "plugin.json"));
    const outArg = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
    if (outArg) {
      createPackage(root, outArg);
      console.log(`Created ${path.resolve(outArg)}`);
    } else {
      console.log(`Manifest valid: ${manifest.name}@${manifest.version}; 5 positive and 3 negative cases; one hosted OAuth MCP server.`);
      console.log("Pass --out=/absolute/path/plugin.zip to create the upload ZIP.");
    }
  }
}
