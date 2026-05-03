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
  const home = await mkdtemp(join(tmpdir(), "cooldown-"));
  await mkdir(join(home, ".config", "uv"), { recursive: true });
  return home;
}

function envFor(home) {
  return { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
}

test("set writes both configs and check passes", async () => {
  const home = await setupHome();
  const out = sink(), err = sink();
  const code = await run(["set", "7"], { env: envFor(home), home, platform: "linux", out, err });
  assert.equal(code, 0);
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  const uvtoml = await readFile(join(home, ".config", "uv", "uv.toml"), "utf8");
  assert.match(npmrc, /^min-release-age=7$/m);
  assert.match(uvtoml, /^exclude-newer = "7 days"$/m);
  const out2 = sink(), err2 = sink();
  const code2 = await run(["check", "--min", "7"], { env: envFor(home), home, platform: "linux", out: out2, err: err2 });
  assert.equal(code2, 0);
});

test("check fails when missing or stale", async () => {
  const home = await setupHome();
  const out = sink(), err = sink();
  const code = await run(["check"], { env: envFor(home), home, platform: "linux", out, err });
  assert.equal(code, 1);
  assert.match(out.text(), /MISSING npm/);
  assert.match(out.text(), /MISSING uv/);
});

test("unset removes the keys but preserves other config", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "registry=https://registry.npmjs.org/\nmin-release-age=7\n");
  await writeFile(join(home, ".config", "uv", "uv.toml"), "exclude-newer = \"7 days\"\nindex-strategy = \"unsafe-best-match\"\n");
  const out = sink(), err = sink();
  await run(["unset"], { env: envFor(home), home, platform: "linux", out, err });
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  const uvtoml = await readFile(join(home, ".config", "uv", "uv.toml"), "utf8");
  assert.equal(npmrc, "registry=https://registry.npmjs.org/\n");
  assert.equal(uvtoml, "index-strategy = \"unsafe-best-match\"\n");
});

test("set is idempotent and replaces an existing value", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=3\nregistry=https://r/\n");
  const out = sink(), err = sink();
  await run(["set", "10"], { env: envFor(home), home, platform: "linux", out, err });
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  assert.equal(npmrc, "min-release-age=10\nregistry=https://r/\n");
});

test("--tool restricts the set", async () => {
  const home = await setupHome();
  const out = sink(), err = sink();
  await run(["set", "7", "--tool", "npm"], { env: envFor(home), home, platform: "linux", out, err });
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(npmrc, /^min-release-age=7$/m);
  let threw = false;
  try { await readFile(join(home, ".config", "uv", "uv.toml"), "utf8"); }
  catch { threw = true; }
  assert.equal(threw, true);
});

test("Windows uv path uses APPDATA", async () => {
  const home = await mkdtemp(join(tmpdir(), "cooldown-win-"));
  const appdata = join(home, "AppData", "Roaming");
  const out = sink(), err = sink();
  await run(["set", "7", "--tool", "uv"], { env: { APPDATA: appdata }, home, platform: "win32", out, err });
  const text = await readFile(join(appdata, "uv", "uv.toml"), "utf8");
  assert.match(text, /^exclude-newer = "7 days"$/m);
});

test("--json emits parseable JSON for check", async () => {
  const home = await setupHome();
  const out = sink(), err = sink();
  await run(["check", "--json"], { env: envFor(home), home, platform: "linux", out, err });
  const data = JSON.parse(out.text());
  assert.equal(data.ok, false);
  assert.equal(data.rows.length, 2);
});
