#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.resolve(import.meta.dirname, "..");
const basePackageFiles = ["plugin.json", "mcp.json", "skills/leadmagic-tables/SKILL.md"];
const hiddenCredentialKeys = new Set(["test_credentials", "reviewer_instructions", "password", "clientSecret", "access_token", "refresh_token", "api_key"]);
const unsupportedHttpTools = /http request|http integration|(?:test|save|update|draft|parse)_sheet_http/i;
const reviewedTools = new Set([
  "preview_cost", "check_credit_balance", "account_intel", "research_account", "enrich_company", "enrich_contact", "find_decision_makers",
  "find_jobs", "search_jobs", "get_company_hiring_signals", "list_sheets", "get_sheet", "get_sheet_stats", "read_sheet_rows", "create_sheet",
  "add_sheet_rows", "add_sheet_columns", "set_sheet_cells", "run_sheet_column", "list_sheet_runs", "get_sheet_run", "list_sheet_run_rows",
  "list_cloud_connections", "list_cloud_crm_objects", "list_cloud_crm_fields", "list_cloud_crm_filters", "import_cloud_crm",
]);
const maxImageBytes = 5 * 1024 * 1024;

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
  if (typeof value === "string") return /sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value);
  return isRecord(value) && Object.entries(value).some(([key, child]) => hiddenCredentialKeys.has(key) || containsCredentials(child));
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label} contains unsupported field ${key}`);
}

function textField(value: unknown, label: string, limit: number, errors: string[], multiline = false): void {
  if (typeof value !== "string" || !value.trim()) { errors.push(`${label} must be non-empty text`); return; }
  if (value.length > limit) errors.push(`${label} exceeds ${limit} characters`);
  const unsupported = multiline
    ? /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/u
    : /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/u;
  if (unsupported.test(value)) errors.push(`${label} contains unsupported characters`);
}

function httpsUrl(value: unknown, label: string, errors: string[]): void {
  textField(value, label, 1024, errors);
  if (typeof value !== "string") return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || /\s/.test(value)) errors.push(`${label} must be HTTPS without embedded credentials`);
  } catch { errors.push(`${label} must be a valid HTTPS URL`); }
}

function safeFile(directory: string, relative: string, errors: string[]): boolean {
  const parts = relative.split("/");
  if (!/^[A-Za-z0-9_./-]+$/.test(relative) || parts.some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
    errors.push(`unsafe package path: ${relative}`); return false;
  }
  try {
    let filename = realpathSync(directory);
    for (const part of parts) {
      filename = path.join(filename, part);
      if (lstatSync(filename).isSymbolicLink()) { errors.push(`symbolic link leaves the public package boundary: ${relative}`); return false; }
    }
    if (!lstatSync(filename).isFile() || !realpathSync(filename).startsWith(`${realpathSync(directory)}${path.sep}`)) {
      errors.push(`file leaves the public package: ${relative}`); return false;
    }
    return true;
  } catch { errors.push(`missing package file: ${relative}`); return false; }
}

function pngDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 33 || data.length > maxImageBytes || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString("ascii", 12, 16) !== "IHDR" || data.readUInt32BE(8) !== 13) return;
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  // pngjs bounds noninterlaced inflation by dimensions; its interlaced sync path
  // is unbounded. Keep this package's assets noninterlaced and bound before decode.
  if (!width || !height || width > 4096 || height > 4096 || data[28] !== 0) return;
  let offset = 8, ended = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) return;
    const type = data.toString("ascii", offset + 4, offset + 8);
    // A second IHDR could change the dimensions after the initial bounds check.
    if (type === "IHDR" && offset !== 8) return;
    offset += length + 12;
    if (type === "IEND") { if (length !== 0) return; ended = true; break; }
  }
  if (!ended || offset !== data.length) return;
  try {
    const decoded = PNG.sync.read(data, { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) return;
    return { width, height };
  } catch { return; }
}

function validateImage(directory: string, value: unknown, label: string, errors: string[], screenshot = false): void {
  if (typeof value !== "string" || !value.startsWith("./")) { errors.push(`${label} must use a ./-prefixed asset path`); return; }
  const relative = value.slice(2);
  if (!safeFile(directory, relative, errors)) return;
  if (lstatSync(path.join(directory, relative)).size > maxImageBytes) { errors.push(`${label} exceeds 5 MiB`); return; }
  const data = readFileSync(path.join(directory, relative));
  const dimensions = pngDimensions(data);
  if (!dimensions || !/\.png$/i.test(relative)) { errors.push(`${label} must contain a valid PNG image with a .png extension`); return; }
  if (screenshot) {
    if (dimensions.width !== 706 || dimensions.height < 400 || dimensions.height > 860) errors.push(`${label} must be 706 pixels wide and 400-860 pixels tall`);
  } else if (dimensions.width !== dimensions.height || dimensions.width < 48 || dimensions.width > 4096) errors.push(`${label} must be square and between 48 and 4096 pixels`);
}

function packageFiles(directory: string): string[] {
  const ui = record(record(record(readJson(directory, "plugin.json")).extensions)["com.openai"]);
  const listing = record(ui.interface);
  const images = [listing.logo, listing.composerIcon, listing.logoDark, listing.composerIconDark, ...(Array.isArray(listing.screenshots) ? listing.screenshots : [])];
  return [...new Set([...basePackageFiles, ...images.filter((value): value is string => typeof value === "string").map(value => value.slice(2))])].sort();
}

function authoredJavaScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "artifacts"].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return authoredJavaScript(filename);
    return /\.(?:js|mjs|cjs)$/.test(entry.name) ? [filename] : [];
  });
}

export function validatePackage(directory: string, toolNames?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  for (const filename of basePackageFiles) safeFile(directory, filename, errors);
  if (errors.length) return errors;
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

  onlyKeys(manifest, ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"], "plugin.json", errors);
  onlyKeys(record(manifest.extensions), ["com.openai"], "plugin extensions", errors);
  onlyKeys(openai, ["interface", "review", "publication", "onboardingSkill"], "OpenAI extension", errors);
  onlyKeys(ui, ["displayName", "shortDescription", "longDescription", "developerName", "category", "capabilities", "websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL", "defaultPrompt", "brandColor", "brandColorDark", "composerIcon", "composerIconDark", "logo", "logoDark", "screenshots"], "listing interface", errors);
  onlyKeys(review, ["test_cases", "demo_recording_url", "commerce", "commerce_description"], "review metadata", errors);
  onlyKeys(cases, ["positive", "negative"], "review test cases", errors);
  onlyKeys(record(openai.publication), ["release_notes", "countries", "translations"], "publication metadata", errors);
  onlyKeys(mcp, ["$schema", "mcpServers"], "mcp.json", errors);
  if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") errors.push("plugin.json must declare the Agent Plugins 1.0.0 schema");
  if (mcp.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json") errors.push("mcp.json must declare the Agent Plugins 1.0.0 schema");

  if (manifest.name !== "app-69eb2710b3748191b3eac40b5218144c") errors.push("plugin identity changed");
  if (record(manifest.author).name !== "LeadMagic Corporation") errors.push("author.name must be LeadMagic Corporation");
  if (ui.developerName !== "LeadMagic Corporation") errors.push("developerName must be LeadMagic Corporation");
  if (typeof manifest.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version) || manifest.version !== packageMetadata.version) errors.push("plugin and package versions must match and use semantic versioning");
  if (!isRecord(openai.interface)) errors.push("OpenAI listing interface is missing");
  if (positive.length !== 5) errors.push("exactly five positive review cases are required");
  if (negative.length !== 3) errors.push("exactly three negative review cases are required");
  if (Object.keys(servers).length !== 1 || !servers.leadmagic) errors.push("exactly one MCP server named leadmagic must be declared");
  if (containsCredentials(manifest) || containsCredentials(mcp)) errors.push("reviewer credentials and secret values belong in the secure portal, never the public package");
  for (const [field, limit, multiline] of [["displayName", 30, false], ["shortDescription", 30, false], ["longDescription", 4000, true], ["developerName", 80, false], ["category", 80, false]] as const) textField(ui[field], field, limit, errors, multiline);
  for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) httpsUrl(ui[field], field, errors);
  const prompts = typeof ui.defaultPrompt === "string" ? [ui.defaultPrompt] : ui.defaultPrompt;
  if (!Array.isArray(prompts) || prompts.length < 1 || prompts.length > 3) errors.push("provide one to three starter prompts");
  else {
    const normalized = new Set<string>();
    for (const [index, prompt] of prompts.entries()) {
      textField(prompt, `starter prompt ${index + 1}`, 128, errors);
      if (typeof prompt !== "string") continue;
      if (/@\S+/.test(prompt)) errors.push(`starter prompt ${index + 1} must omit app mentions`);
      const key = prompt.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
      if (normalized.has(key)) errors.push("starter prompts must be unique");
      normalized.add(key);
    }
  }
  if (!Array.isArray(ui.capabilities) || ui.capabilities.length > 20) errors.push("capabilities must be an array of at most 20 entries");
  else ui.capabilities.forEach((value, index) => textField(value, `capability ${index + 1}`, 120, errors));

  for (const [index, value] of positive.entries()) {
    const test = record(value);
    onlyKeys(test, ["description", "prompt", "tools_triggered", "expected_behavior", "file_attachment_urls", "expected_output_url"], `positive case ${index + 1}`, errors);
    for (const field of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
      textField(test[field], `positive case ${index + 1} ${field}`, 4000, errors, true);
    }
    if (typeof test.tools_triggered === "string") for (const name of test.tools_triggered.split(",").map(value => value.trim())) {
      if (!reviewedTools.has(name)) errors.push(`positive case ${index + 1} references an unreviewed public tool: ${name}`);
      if (toolNames && !toolNames.has(name)) errors.push(`positive case ${index + 1} tool is absent from the supplied catalog: ${name}`);
    }
    if (unsupportedHttpTools.test(JSON.stringify(test))) errors.push(`positive case ${index + 1} must not describe HTTP request integrations`);
  }
  for (const [index, value] of negative.entries()) {
    const test = record(value);
    onlyKeys(test, ["description", "prompt", "tools_triggered", "expected_behavior", "file_attachment_urls", "expected_output_url"], `negative case ${index + 1}`, errors);
    for (const field of ["description", "prompt"]) {
      textField(test[field], `negative case ${index + 1} ${field}`, 4000, errors, true);
    }
  }

  const skillPath = path.join(directory, "skills/leadmagic-tables/SKILL.md");
  if (!existsSync(skillPath)) errors.push("packaged LeadMagic Tables skill is missing");
  else {
    const skill = readFileSync(skillPath, "utf8");
    if (unsupportedHttpTools.test(`${manifest.description} ${ui.longDescription} ${JSON.stringify(ui.capabilities)} ${skill}`)) errors.push("public listing and skill must not describe HTTP request integrations");
    if (/push_cloud_rows|Small runs within|automatic limit/i.test(skill)) errors.push("skill must not advertise withheld outbound delivery or automatic paid runs");
    if (!/^---\r?\nname: leadmagic-tables\r?\ndescription: [^\r\n]+\r?\n---(?:\r?\n|$)/.test(skill)) errors.push("LeadMagic skill needs valid name and description frontmatter");
  }

  for (const field of ["composerIcon", "logo"]) validateImage(directory, ui[field], field, errors);
  for (const field of ["composerIconDark", "logoDark"]) if (ui[field] !== undefined) validateImage(directory, ui[field], field, errors);
  if (ui.screenshots !== undefined) {
    if (!Array.isArray(ui.screenshots) || !ui.screenshots.length || !Array.isArray(prompts) || ui.screenshots.length !== prompts.length) errors.push("screenshots must contain one image per starter prompt");
    else {
      if (new Set(ui.screenshots).size !== ui.screenshots.length) errors.push("starter screenshots must be distinct");
      ui.screenshots.forEach((value, index) => validateImage(directory, value, `screenshot ${index + 1}`, errors, true));
    }
  }

  for (const [name, value] of Object.entries(servers)) {
    const server = record(value);
    onlyKeys(server, ["type", "url"], `MCP server ${name}`, errors);
    httpsUrl(server.url, `MCP server ${name} URL`, errors);
    if (server.type !== "streamable-http" || server.url !== "https://mcp.leadmagic.io/mcp") errors.push(`${name} must use the public Streamable HTTP MCP endpoint`);
    if (record(record(server.extensions)["com.openai"]).auth !== undefined) errors.push(`${name} must preserve the existing portal authentication without an auth override`);
    if (server.headers !== undefined) errors.push(`${name} must not contain credential headers`);
  }
  if (openai.onboardingSkill !== undefined && openai.onboardingSkill !== "./skills/leadmagic-tables/SKILL.md") errors.push("onboarding must reference the bundled LeadMagic skill");
  if (review.demo_recording_url !== undefined) httpsUrl(review.demo_recording_url, "demo recording URL", errors);
  if (review.commerce !== false) errors.push("this package must declare commerce false");
  textField(record(openai.publication).release_notes, "release notes", 4000, errors, true);
  if (authoredJavaScript(directory).length > 0) errors.push("authored source and build scripts must use TypeScript");
  return errors;
}

export function createPackage(directory: string, output: string): void {
  const errors = validatePackage(directory);
  if (errors.length) throw new Error(errors.join("\n"));
  const source = realpathSync(directory);
  const destination = path.resolve(output);
  const parent = realpathSync(path.dirname(destination));
  if (destination === source || destination.startsWith(`${source}${path.sep}`) || parent === source || parent.startsWith(`${source}${path.sep}`)) throw new Error("write the generated ZIP outside the source package directory");
  if (!path.isAbsolute(output) || path.extname(destination).toLowerCase() !== ".zip") throw new Error("output must be an absolute .zip path");
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("existing output must be a regular file, not a symbolic link");
  const temporary = mkdtempSync(path.join(parent, ".leadmagic-plugin-"));
  try {
    const archive = path.join(temporary, "plugin.zip");
    const zip = spawnSync("zip", ["-q", "-X", archive, ...packageFiles(directory)], { cwd: directory, encoding: "utf8" });
    if (zip.error || zip.status !== 0) throw new Error(zip.error?.message ?? zip.stderr ?? "zip command failed");
    renameSync(archive, destination);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    const match = /^(--out|--tools)=(.+)$/.exec(argument);
    if (!match || options.has(match[1]!)) throw new Error(`unsupported or repeated option: ${argument.split("=")[0]}`);
    options.set(match[1]!, match[2]!);
  }
  let tools: Set<string> | undefined;
  if (options.has("--tools")) {
    const snapshot = JSON.parse(readFileSync(path.resolve(options.get("--tools")!), "utf8")) as unknown;
    const values = Array.isArray(snapshot) ? snapshot : record(snapshot).tools ?? record(record(snapshot).result).tools;
    if (!Array.isArray(values) || !values.length) throw new Error("--tools requires a saved non-empty MCP tools/list response or catalog");
    tools = new Set(values.map(value => typeof value === "string" ? value : record(value).name).filter((value): value is string => typeof value === "string"));
  }
  const errors = validatePackage(root, tools);
  if (errors.length) {
    console.error(errors.map((error) => `ERROR: ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    const manifest = record(readJson(root, "plugin.json"));
    const outArg = options.get("--out");
    if (outArg) {
      createPackage(root, outArg);
      console.log(`Created ${path.resolve(outArg)}`);
    } else {
      console.log(`Package valid: ${manifest.name}@${manifest.version}; 5 positive and 3 negative cases; one hosted MCP; ${packageFiles(root).length} declared files.`);
      console.log("Pass --out=/absolute/path/plugin.zip to create the upload ZIP.");
    }
    if (tools) console.log("Review tool names match the supplied catalog; freshness and authentication must be verified separately.");
    console.log("Portal OAuth, domain verification, current tool scan, reviewer access, demo recording, and live test results must be verified separately before submission.");
  }
}
