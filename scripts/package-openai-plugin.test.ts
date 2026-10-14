import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { deflateSync } from "node:zlib";
import { createPackage, validatePackage } from "./package-openai-plugin.ts";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
type JsonRecord = Record<string, unknown>;
function listing(manifest: JsonRecord): JsonRecord { return ((manifest.extensions as JsonRecord)["com.openai"] as JsonRecord).interface as JsonRecord; }
function editManifest(directory: string, edit: (manifest: JsonRecord) => void): void {
  const filename = path.join(directory, "plugin.json");
  const manifest = JSON.parse(readFileSync(filename, "utf8")) as JsonRecord;
  edit(manifest);
  writeFileSync(filename, JSON.stringify(manifest));
}
function assets(directory: string): string[] {
  const ui = listing(JSON.parse(readFileSync(path.join(directory, "plugin.json"), "utf8")) as JsonRecord);
  return [ui.logo, ui.composerIcon, ui.logoDark, ui.composerIconDark, ...(Array.isArray(ui.screenshots) ? ui.screenshots : [])]
    .filter((value): value is string => typeof value === "string").map(value => value.slice(2));
}
function fixture(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "leadmagic-package-test-"));
  temporaryDirectories.push(directory);
  for (const filename of ["plugin.json", "mcp.json", "package.json", "icon.png", "chatgpt-composer-icon.png", "skills"]) cpSync(path.join(root, filename), path.join(directory, filename), { recursive: true });
  for (const filename of assets(root)) {
    mkdirSync(path.dirname(path.join(directory, filename)), { recursive: true });
    cpSync(path.join(root, filename), path.join(directory, filename));
  }
  return directory;
}

function png(width: number, height: number, color = 6): Buffer {
  function chunk(type: string, bytes: Buffer): Buffer {
    const body = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = color;
  const palette = color === 3 ? [chunk("PLTE", Buffer.alloc(0))] : [];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...palette, chunk("IDAT", deflateSync(Buffer.alloc((width * (color === 3 ? 1 : 4) + 1) * height))), chunk("IEND", Buffer.alloc(0))]);
}

function addScreenshots(directory: string, width = 706, height = 400): string[] {
  mkdirSync(path.join(directory, "assets"), { recursive: true });
  const paths = [1, 2, 3].map(index => `./assets/starter-${index}.png`);
  for (const filename of paths) writeFileSync(path.join(directory, filename), png(width, height));
  editManifest(directory, manifest => { listing(manifest).screenshots = paths; });
  return paths;
}

test("valid package metadata and a complete supplied review-tool catalog pass", () => {
  const directory = fixture();
  const manifest = JSON.parse(readFileSync(path.join(directory, "plugin.json"), "utf8")) as JsonRecord;
  const review = ((manifest.extensions as JsonRecord)["com.openai"] as JsonRecord).review as JsonRecord;
  const positive = (review.test_cases as JsonRecord).positive as JsonRecord[];
  const tools = new Set(positive.flatMap(test => (test.tools_triggered as string).split(",").map(value => value.trim())));
  assert.deepEqual(validatePackage(directory, tools), []);
  assert.ok(validatePackage(directory, new Set(["preview_cost"])).some(error => error.includes("absent from the supplied catalog")));
});

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
    assert.deepEqual(archive.stdout.trim().split("\n").sort(), [...new Set(["plugin.json", "mcp.json", "skills/leadmagic-tables/SKILL.md", ...assets(directory)])].sort());
  } finally { rmSync(output, { force: true }); }
});

test("only one public MCP and no lifecycle hooks or app references are accepted", () => {
  const directory = fixture();
  editManifest(directory, manifest => { ((manifest.extensions as JsonRecord)["com.openai"] as JsonRecord).hooks = "./hooks.json"; });
  writeFileSync(path.join(directory, "mcp.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: {
    leadmagic: { type: "streamable-http", url: "https://mcp.leadmagic.io/mcp", extensions: { "com.openai": { auth: {} } } },
    extra: { type: "streamable-http", url: "https://user:password@example.test/mcp" },
  } }));
  const errors = validatePackage(directory);
  assert.ok(errors.some(error => error.includes("unsupported field hooks")));
  assert.ok(errors.some(error => error.includes("exactly one MCP")));
  assert.ok(errors.some(error => error.includes("auth override")));
  assert.ok(errors.some(error => error.includes("embedded credentials")));
});

test("public review cases cannot advertise unknown or withheld tools", () => {
  const directory = fixture();
  editManifest(directory, manifest => {
    const review = ((manifest.extensions as JsonRecord)["com.openai"] as JsonRecord).review as JsonRecord;
    ((review.test_cases as JsonRecord).positive as JsonRecord[])[0]!.tools_triggered = "push_cloud_rows";
  });
  assert.ok(validatePackage(directory).some(error => error.includes("unreviewed public tool")));
});

test("listing limits, duplicate starter prompts, and unsafe asset paths fail", () => {
  const directory = fixture();
  editManifest(directory, manifest => {
    const ui = listing(manifest);
    ui.shortDescription = "x".repeat(31);
    ui.defaultPrompt = ["Research Acme.", " Research   Acme. "];
    ui.logo = "./../private.png";
  });
  const errors = validatePackage(directory);
  assert.ok(errors.some(error => error.includes("exceeds 30 characters")));
  assert.ok(errors.some(error => error.includes("starter prompts must be unique")));
  assert.ok(errors.some(error => error.includes("unsafe package path")));
});

test("declared starter screenshots are validated and included, unrelated assets excluded", () => {
  const directory = fixture();
  const screenshots = addScreenshots(directory);
  const output = path.join(path.dirname(directory), `${path.basename(directory)}.zip`);
  writeFileSync(path.join(directory, "assets/unreferenced.png"), png(706, 400));
  assert.deepEqual(validatePackage(directory), []);
  try {
    createPackage(directory, output);
    const files = spawnSync("unzip", ["-Z1", output], { encoding: "utf8" }).stdout.trim().split("\n");
    for (const filename of screenshots) assert.ok(files.includes(filename.slice(2)));
    assert.ok(!files.includes("assets/unreferenced.png"));
  } finally { rmSync(output, { force: true }); }
  editManifest(directory, manifest => { listing(manifest).screenshots = screenshots.slice(0, 2); });
  assert.ok(validatePackage(directory).some(error => error.includes("one image per starter")));
});

test("screenshot dimensions, size, and extension must meet final submission limits", () => {
  const directory = fixture();
  const screenshots = addScreenshots(directory, 705, 399);
  assert.ok(validatePackage(directory).some(error => error.includes("706 pixels wide")));
  writeFileSync(path.join(directory, screenshots[0]!), Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.ok(validatePackage(directory).some(error => error.includes("exceeds 5 MiB")));
  const wrongExtension = "./assets/wrong.jpg";
  writeFileSync(path.join(directory, wrongExtension), png(706, 400));
  editManifest(directory, manifest => { listing(manifest).screenshots = [wrongExtension, ...screenshots.slice(1)]; });
  assert.ok(validatePackage(directory).some(error => error.includes("valid PNG image")));
});

test("skill symlinks and obsolete automatic-paid-run instructions fail", () => {
  const directory = fixture();
  const skill = path.join(directory, "skills/leadmagic-tables/SKILL.md");
  const original = readFileSync(skill, "utf8");
  writeFileSync(skill, `${original}\nSmall runs within the automatic limit may start immediately.\n`);
  assert.ok(validatePackage(directory).some(error => error.includes("automatic paid runs")));
  const target = path.join(directory, "linked-skill.md");
  writeFileSync(target, original);
  rmSync(skill);
  symlinkSync(target, skill);
  assert.ok(validatePackage(directory).some(error => error.includes("symbolic link")));
});

test("a truncated or corrupt PNG cannot pass as a listing image", () => {
  const directory = fixture();
  const complete = png(48, 48);
  writeFileSync(path.join(directory, "icon.png"), complete.subarray(0, 33));
  assert.ok(validatePackage(directory).some(error => error.includes("valid PNG image")));
  const corrupt = Buffer.from(complete);
  corrupt[40] = corrupt[40]! ^ 1;
  writeFileSync(path.join(directory, "icon.png"), corrupt);
  assert.ok(validatePackage(directory).some(error => error.includes("valid PNG image")));
});

test("JPEG headers without image data cannot pass as a listing image", () => {
  const directory = fixture();
  const filename = "./fake.jpg";
  writeFileSync(path.join(directory, filename), Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x30, 0x00, 0x30, 0x03, 0xff, 0xd9]));
  editManifest(directory, manifest => { listing(manifest).logo = filename; });
  assert.ok(validatePackage(directory).some(error => error.includes("valid PNG image")));
});

test("an indexed PNG with an empty palette cannot pass as a listing image", () => {
  const directory = fixture();
  writeFileSync(path.join(directory, "icon.png"), png(48, 48, 3));
  assert.ok(validatePackage(directory).some(error => error.includes("valid PNG image")));
});

test("ZIP output cannot use symlinks or an alias back inside the source package", () => {
  const directory = fixture();
  const parent = mkdtempSync(path.join(os.tmpdir(), "leadmagic-output-test-"));
  temporaryDirectories.push(parent);
  symlinkSync(directory, path.join(parent, "source-alias"));
  assert.throws(() => createPackage(directory, path.join(parent, "source-alias/plugin.zip")), /outside the source/);
  writeFileSync(path.join(parent, "existing.zip"), "synthetic-test-only");
  symlinkSync(path.join(parent, "existing.zip"), path.join(parent, "symlink.zip"));
  assert.throws(() => createPackage(directory, path.join(parent, "symlink.zip")), /symbolic link/);
});
