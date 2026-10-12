#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (filename) => JSON.parse(readFileSync(path.join(root, filename), "utf8"));
const manifest = readJson("plugin.json");
const mcp = readJson("mcp.json");
const openai = manifest.extensions?.["com.openai"];
const review = openai?.review;
const positive = review?.test_cases?.positive;
const negative = review?.test_cases?.negative;
const servers = mcp.mcpServers;
const errors = [];

if (manifest.name !== "app-69eb2710b3748191b3eac40b5218144c") errors.push("plugin identity changed");
if (manifest.version !== "1.0.1") errors.push("expected prepared package version 1.0.1");
if (!openai?.interface) errors.push("OpenAI listing interface is missing");
if (!Array.isArray(positive) || positive.length !== 5) errors.push("exactly five positive review cases are required");
if (!Array.isArray(negative) || negative.length !== 3) errors.push("exactly three negative review cases are required");
if (!servers || Object.keys(servers).length !== 1) errors.push("exactly one MCP server must be declared");

for (const [index, test] of (positive ?? []).entries()) {
  for (const field of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
    if (typeof test[field] !== "string" || !test[field].trim()) errors.push(`positive case ${index + 1} is missing ${field}`);
  }
  if (/http request|http integration|test_sheet_http|list_sheet_http/i.test(`${test.description} ${test.prompt} ${test.tools_triggered}`)) {
    errors.push(`positive case ${index + 1} must not describe HTTP request integrations`);
  }
}
for (const [index, test] of (negative ?? []).entries()) {
  for (const field of ["description", "prompt"]) {
    if (typeof test[field] !== "string" || !test[field].trim()) errors.push(`negative case ${index + 1} is missing ${field}`);
  }
}
if (/http request|http integration|test_sheet_http|list_sheet_http/i.test(`${manifest.description} ${openai?.interface?.longDescription} ${JSON.stringify(openai?.interface?.capabilities)} ${readFileSync(path.join(root, "skills/leadmagic-tables/SKILL.md"), "utf8")}`)) {
  errors.push("public listing and skill must not describe HTTP request integrations");
}

for (const asset of [openai?.interface?.composerIcon, openai?.interface?.logo]) {
  if (!asset) { errors.push("composer icon and logo are required"); continue; }
  const file = asset.startsWith("./") ? asset.slice(2) : asset;
  if (!existsSync(path.join(root, file)) || !statSync(path.join(root, file)).isFile()) errors.push(`missing listing asset: ${asset}`);
}
if (!existsSync(path.join(root, "skills/leadmagic-tables/SKILL.md"))) errors.push("packaged LeadMagic Tables skill is missing");

for (const [name, server] of Object.entries(servers ?? {})) {
  if (server.type !== "streamable-http" || server.url !== "https://mcp.leadmagic.io/mcp") errors.push(`${name} must use the public Streamable HTTP MCP endpoint`);
  const auth = server.extensions?.["com.openai"]?.auth;
  if (auth?.type !== "oauth" || auth?.client?.mode !== "dcr") errors.push(`${name} must configure OAuth Dynamic Client Registration`);
}

if (errors.length) {
  console.error(errors.map((error) => `ERROR: ${error}`).join("\n"));
  process.exit(1);
}

const outArg = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
if (!outArg) {
  console.log(`Manifest valid: ${manifest.name}@${manifest.version}; 5 positive and 3 negative cases; one OAuth DCR MCP server.`);
  console.log("Pass --out=/absolute/path/plugin.zip to create the upload ZIP.");
  process.exit(0);
}
const output = path.resolve(outArg);
if (output.startsWith(`${root}${path.sep}`)) {
  console.error("ERROR: write the generated ZIP outside the source package directory.");
  process.exit(1);
}
const zip = spawnSync("zip", ["-q", "-X", "-r", output, "plugin.json", "mcp.json", "icon.png", "chatgpt-composer-icon.png", "skills/leadmagic-tables/SKILL.md"], { cwd: root, encoding: "utf8" });
if (zip.error || zip.status !== 0) {
  console.error(zip.error?.message ?? zip.stderr ?? "zip command failed");
  process.exit(zip.status ?? 1);
}
console.log(`Created ${output}`);
