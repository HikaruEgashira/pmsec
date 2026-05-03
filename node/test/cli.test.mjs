import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { run } from "../src/cli.mjs";

function sink() {
  const chunks = [];
  const w = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
  w.text = () => Buffer.concat(chunks).toString("utf8");
  return w;
}

async function setupHome() {
  const home = await mkdtemp(join(tmpdir(), "pmsec-"));
  return home;
}

function envFor(home) {
  return { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
}

async function runCli(argv, home, platform = "linux") {
  const out = sink(), err = sink();
  const code = await run(argv, { env: envFor(home), home, platform, out, err });
  return { code, out: out.text(), err: err.text() };
}

test("set writes every supported tool config", async () => {
  const home = await setupHome();
  const { code } = await runCli(["set", "7"], home);
  assert.equal(code, 0);
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(npmrc, /^min-release-age=7$/m);
  assert.match(npmrc, /^minimum-release-age=10080$/m);
  const uvtoml = await readFile(join(home, ".config", "uv", "uv.toml"), "utf8");
  assert.match(uvtoml, /^exclude-newer = "7 days"$/m);
  const bunfig = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(bunfig, /^\[install\]$/m);
  assert.match(bunfig, /^minimumReleaseAge = 604800$/m);
  const yarnrc = await readFile(join(home, ".yarnrc.yml"), "utf8");
  assert.match(yarnrc, /^npmMinimalAgeGate: "7d"$/m);
  const mise = await readFile(join(home, ".config", "mise", "config.toml"), "utf8");
  assert.match(mise, /^\[settings\]$/m);
  assert.match(mise, /^minimum_release_age = "7d"$/m);
});

test("check passes after set across all tools", async () => {
  const home = await setupHome();
  await runCli(["set", "7"], home);
  const { code } = await runCli(["check", "--min", "7"], home);
  assert.equal(code, 0);
});

test("check fails when missing or stale", async () => {
  const home = await setupHome();
  const { code, out } = await runCli(["check"], home);
  assert.equal(code, 1);
  for (const t of ["npm", "pnpm", "yarn", "bun", "mise", "uv"]) {
    assert.match(out, new RegExp(`MISSING ${t}`));
  }
});

test("unset preserves unrelated keys per file", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "registry=https://r/\nmin-release-age=7\nminimum-release-age=10080\n");
  await mkdir(join(home, ".config", "uv"), { recursive: true });
  await writeFile(join(home, ".config", "uv", "uv.toml"), 'exclude-newer = "7 days"\nindex-strategy = "unsafe-best-match"\n');
  await writeFile(join(home, ".bunfig.toml"), "[install]\nminimumReleaseAge = 604800\nregistry = \"https://x/\"\n");
  await writeFile(join(home, ".yarnrc.yml"), "npmMinimalAgeGate: \"7d\"\nnpmRegistryServer: \"https://r/\"\n");
  await runCli(["unset"], home);
  assert.equal(await readFile(join(home, ".npmrc"), "utf8"), "registry=https://r/\n");
  assert.equal(await readFile(join(home, ".config", "uv", "uv.toml"), "utf8"), 'index-strategy = "unsafe-best-match"\n');
  const bunfig = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.equal(bunfig, "[install]\nregistry = \"https://x/\"\n");
  assert.equal(await readFile(join(home, ".yarnrc.yml"), "utf8"), "npmRegistryServer: \"https://r/\"\n");
});

test("set replaces existing values in place", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=3\nregistry=https://r/\n");
  await runCli(["set", "10", "--tool", "npm"], home);
  assert.equal(await readFile(join(home, ".npmrc"), "utf8"), "min-release-age=10\nregistry=https://r/\n");
});

test("--tool restricts which tools get written", async () => {
  const home = await setupHome();
  await runCli(["set", "7", "--tool", "npm,bun"], home);
  await readFile(join(home, ".npmrc"), "utf8");
  await readFile(join(home, ".bunfig.toml"), "utf8");
  let threw = false;
  try { await readFile(join(home, ".config", "uv", "uv.toml"), "utf8"); } catch { threw = true; }
  assert.equal(threw, true);
});

test("Windows uv path uses APPDATA", async () => {
  const home = await mkdtemp(join(tmpdir(), "pmsec-win-"));
  const appdata = join(home, "AppData", "Roaming");
  const out = sink(), err = sink();
  await run(["set", "7", "--tool", "uv"], { env: { APPDATA: appdata }, home, platform: "win32", out, err });
  const text = await readFile(join(appdata, "uv", "uv.toml"), "utf8");
  assert.match(text, /^exclude-newer = "7 days"$/m);
});

test("--json emits parseable JSON for check", async () => {
  const home = await setupHome();
  const { out } = await runCli(["check", "--json"], home);
  const data = JSON.parse(out);
  assert.equal(data.ok, false);
  assert.equal(data.rows.length, 6);
  assert.deepEqual(data.rows.map(r => r.tool), ["npm", "pnpm", "yarn", "bun", "mise", "uv"]);
});

test("bun set inserts key inside existing [install] section", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".bunfig.toml"), "[install]\nregistry = \"https://x/\"\n");
  await runCli(["set", "7", "--tool", "bun"], home);
  const text = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(text, /^\[install\]\nminimumReleaseAge = 604800\nregistry = "https:\/\/x\/"$/m);
});

test("bun set creates [install] section if missing", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".bunfig.toml"), "telemetry = false\n");
  await runCli(["set", "7", "--tool", "bun"], home);
  const text = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(text, /^telemetry = false\n\n\[install\]\nminimumReleaseAge = 604800\n$/);
});

test("yarn check parses npmMinimalAgeGate days correctly", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".yarnrc.yml"), "npmMinimalAgeGate: \"14d\"\n");
  const { out } = await runCli(["check", "--json", "--tool", "yarn", "--min", "7"], home);
  const data = JSON.parse(out);
  assert.equal(data.ok, true);
  assert.equal(data.rows[0].days, 14);
});

test("pnpm check normalizes minutes to days", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "minimum-release-age=20160\n");
  const { out } = await runCli(["check", "--json", "--tool", "pnpm"], home);
  const data = JSON.parse(out);
  assert.equal(data.rows[0].days, 14);
});

test(".bak is created once and never overwritten", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "registry=https://original/\n");
  await runCli(["set", "7", "--tool", "npm"], home);
  await runCli(["set", "10", "--tool", "npm"], home);
  const bak = await readFile(join(home, ".npmrc.bak"), "utf8");
  assert.equal(bak, "registry=https://original/\n");
});
