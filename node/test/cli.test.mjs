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
  return await mkdtemp(join(tmpdir(), "pmsec-"));
}

function envFor(home, overrides = {}) {
  // Hide the host pnpm by default so version-aware extras (pnpm 11 default
  // enforcement) don't depend on what's installed on the test machine.
  return { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PMSEC_PNPM_VERSION: "none", ...overrides };
}

async function runCli(argv, home, platform = "linux", envOverrides = {}) {
  const out = sink(), err = sink();
  const code = await run(argv, { env: envFor(home, envOverrides), home, platform, out, err });
  return { code, out: out.text(), err: err.text() };
}

test("enable writes the bundle (cooldown + extras) for every tool", async () => {
  const home = await setupHome();
  const { code } = await runCli(["enable"], home);
  assert.equal(code, 0);
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(npmrc, /^min-release-age=3$/m);
  assert.match(npmrc, /^audit-level=high$/m);
  assert.doesNotMatch(npmrc, /minimum-release-age/, "pnpm keys must not leak into .npmrc");
  const pnpmrc = await readFile(join(home, ".config", "pnpm", "rc"), "utf8");
  assert.match(pnpmrc, /^minimum-release-age=4320$/m);
  assert.match(pnpmrc, /^trust-policy=no-downgrade$/m);
  assert.match(pnpmrc, /^block-exotic-subdeps=true$/m);
  assert.match(pnpmrc, /^strict-dep-builds=true$/m);
  const uvtoml = await readFile(join(home, ".config", "uv", "uv.toml"), "utf8");
  assert.match(uvtoml, /^exclude-newer = "3 days"$/m);
  const bunfig = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(bunfig, /^\[install\]$/m);
  assert.match(bunfig, /^minimumReleaseAge = 259200$/m);
  const yarnrc = await readFile(join(home, ".yarnrc.yml"), "utf8");
  assert.match(yarnrc, /^npmMinimalAgeGate: "3d"$/m);
  assert.match(yarnrc, /^enableHardenedMode: true$/m);
  const mise = await readFile(join(home, ".config", "mise", "config.toml"), "utf8");
  assert.match(mise, /^\[settings\]$/m);
  assert.match(mise, /^minimum_release_age = "3d"$/m);
  assert.match(mise, /^paranoid = true$/m);
});

test("check passes after enable across all tools", async () => {
  const home = await setupHome();
  await runCli(["enable"], home);
  const { code } = await runCli(["check"], home);
  assert.equal(code, 0);
});

test("check fails when the bundle is missing", async () => {
  const home = await setupHome();
  const { code, out } = await runCli(["check"], home);
  assert.equal(code, 1);
  for (const t of ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv"]) {
    assert.match(out, new RegExp(`MISSING ${t}`));
  }
});

test("disable preserves unrelated keys per file", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "registry=https://r/\nmin-release-age=3\n");
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  await writeFile(join(home, ".config", "pnpm", "rc"), "minimum-release-age=4320\nstore-dir=/tmp/pstore\n");
  await mkdir(join(home, ".config", "uv"), { recursive: true });
  await writeFile(join(home, ".config", "uv", "uv.toml"), 'exclude-newer = "3 days"\nindex-strategy = "unsafe-best-match"\n');
  await writeFile(join(home, ".bunfig.toml"), "[install]\nminimumReleaseAge = 259200\nregistry = \"https://x/\"\n");
  await writeFile(join(home, ".yarnrc.yml"), "npmMinimalAgeGate: \"3d\"\nnpmRegistryServer: \"https://r/\"\n");
  await runCli(["disable"], home);
  assert.equal(await readFile(join(home, ".npmrc"), "utf8"), "registry=https://r/\n");
  assert.equal(await readFile(join(home, ".config", "pnpm", "rc"), "utf8"), "store-dir=/tmp/pstore\n");
  assert.equal(await readFile(join(home, ".config", "uv", "uv.toml"), "utf8"), 'index-strategy = "unsafe-best-match"\n');
  assert.equal(await readFile(join(home, ".bunfig.toml"), "utf8"), "[install]\nregistry = \"https://x/\"\n");
  assert.equal(await readFile(join(home, ".yarnrc.yml"), "utf8"), "npmRegistryServer: \"https://r/\"\n");
});

test("enable upgrades values that are weaker than the request", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=1\nregistry=https://r/\n");
  await runCli(["enable", "--tool", "npm"], home);
  assert.equal(
    await readFile(join(home, ".npmrc"), "utf8"),
    "min-release-age=3\nregistry=https://r/\naudit-level=high\n"
  );
});

test("enable preserves stricter existing cooldowns", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=99\nregistry=https://r/\n");
  const { code, out } = await runCli(["enable", "--tool", "npm"], home);
  assert.equal(code, 0);
  assert.match(out, /^keep\s+npm\s/m);
  assert.equal(
    await readFile(join(home, ".npmrc"), "utf8"),
    "min-release-age=99\nregistry=https://r/\naudit-level=high\n"
  );
});

test("enable --force overwrites stricter existing values", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=99\n");
  const { code } = await runCli(["enable", "--tool", "npm", "--days", "1", "--force"], home);
  assert.equal(code, 0);
  const text = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(text, /^min-release-age=1$/m);
});

test("enable --days upgrades when request exceeds existing", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=3\n");
  await runCli(["enable", "--tool", "npm", "--days", "14"], home);
  const text = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(text, /^min-release-age=14$/m);
});

test("--tool restricts which tools get written", async () => {
  const home = await setupHome();
  await runCli(["enable", "--tool", "npm,bun"], home);
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
  await run(["enable", "--tool", "uv"], { env: { APPDATA: appdata }, home, platform: "win32", out, err });
  const text = await readFile(join(appdata, "uv", "uv.toml"), "utf8");
  assert.match(text, /^exclude-newer = "3 days"$/m);
});

test("--json emits parseable JSON for check", async () => {
  const home = await setupHome();
  const { out } = await runCli(["check", "--json"], home);
  const data = JSON.parse(out);
  assert.equal(data.ok, false);
  assert.equal(data.bundleDays, 3);
  assert.equal(data.rows.length, 7);
  assert.deepEqual(data.rows.map(r => r.tool), ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv"]);
});

test("bun enable inserts key inside existing [install] section", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".bunfig.toml"), "[install]\nregistry = \"https://x/\"\n");
  await runCli(["enable", "--tool", "bun"], home);
  const text = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(text, /^\[install\]\nminimumReleaseAge = 259200\nregistry = "https:\/\/x\/"$/m);
});

test("bun enable creates [install] section if missing", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".bunfig.toml"), "telemetry = false\n");
  await runCli(["enable", "--tool", "bun"], home);
  const text = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(text, /^telemetry = false\n\n\[install\]\nminimumReleaseAge = 259200\n$/);
});

test("yarn check parses npmMinimalAgeGate days correctly", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".yarnrc.yml"), "npmMinimalAgeGate: \"14d\"\nenableHardenedMode: true\n");
  const { out } = await runCli(["check", "--json", "--tool", "yarn"], home);
  const data = JSON.parse(out);
  assert.equal(data.ok, true);
  assert.equal(data.rows[0].days, 14);
});

test("pnpm check normalizes minutes to days", async () => {
  const home = await setupHome();
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  await writeFile(join(home, ".config", "pnpm", "rc"), "minimum-release-age=20160\n");
  const { out } = await runCli(["check", "--json", "--tool", "pnpm"], home);
  const data = JSON.parse(out);
  assert.equal(data.rows[0].days, 14);
});

test(".bak is created once and never overwritten", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "registry=https://original/\n");
  await runCli(["enable", "--tool", "npm"], home);
  await runCli(["disable", "--tool", "npm"], home);
  await runCli(["enable", "--tool", "npm"], home);
  const bak = await readFile(join(home, ".npmrc.bak"), "utf8");
  assert.equal(bak, "registry=https://original/\n");
});

test("hardening extras: check fails when extras missing, enable fixes them, disable removes them", async () => {
  const home = await setupHome();
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  const pnpmrc = join(home, ".config", "pnpm", "rc");
  await writeFile(pnpmrc, "minimum-release-age=20160\n");
  const r1 = await runCli(["check", "--json", "--tool", "pnpm"], home);
  const d1 = JSON.parse(r1.out);
  assert.equal(r1.code, 1, "extras missing should fail check");
  assert.equal(d1.rows[0].extras.length, 3);
  assert.equal(d1.rows[0].extras.every(e => !e.ok), true);

  await runCli(["enable", "--tool", "pnpm"], home);
  const after1 = await readFile(pnpmrc, "utf8");
  assert.match(after1, /^trust-policy=no-downgrade$/m);
  assert.match(after1, /^block-exotic-subdeps=true$/m);
  assert.match(after1, /^strict-dep-builds=true$/m);

  const r2 = await runCli(["check", "--json", "--tool", "pnpm"], home);
  assert.equal(r2.code, 0);
  assert.equal(JSON.parse(r2.out).ok, true);

  await runCli(["disable", "--tool", "pnpm"], home);
  const after2 = await readFile(pnpmrc, "utf8");
  assert.doesNotMatch(after2, /trust-policy/);
  assert.doesNotMatch(after2, /block-exotic-subdeps/);
  assert.doesNotMatch(after2, /strict-dep-builds/);
  assert.doesNotMatch(after2, /minimum-release-age/);
});

test("pnpm 11 treats missing block-exotic-subdeps as default-enforced (ok=true)", async () => {
  const home = await setupHome();
  // Cooldown present, but extras lines absent. Under pnpm 11 the runtime still
  // blocks exotic subdeps by default, so check must report it as OK rather
  // than MISSING (trust-policy stays MISSING — no default change there).
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  await writeFile(join(home, ".config", "pnpm", "rc"), "minimum-release-age=4320\n");
  const { code, out } = await runCli(["check", "--json", "--tool", "pnpm"], home, "linux", { PMSEC_PNPM_VERSION: "11.0.0" });
  const data = JSON.parse(out);
  const beSub = data.rows[0].extras.find(e => e.key === "block-exotic-subdeps");
  const trust = data.rows[0].extras.find(e => e.key === "trust-policy");
  assert.equal(beSub.ok, true);
  assert.equal(beSub.defaultEnforced, true);
  assert.equal(beSub.configured, null);
  assert.equal(trust.ok, false);
  assert.equal(code, 1, "trust-policy still missing — overall check fails");
});

test("pnpm <11 still flags missing block-exotic-subdeps as STALE", async () => {
  const home = await setupHome();
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  await writeFile(join(home, ".config", "pnpm", "rc"), "minimum-release-age=4320\n");
  const { out } = await runCli(["check", "--json", "--tool", "pnpm"], home, "linux", { PMSEC_PNPM_VERSION: "10.26.0" });
  const beSub = JSON.parse(out).rows[0].extras.find(e => e.key === "block-exotic-subdeps");
  assert.equal(beSub.ok, false);
  assert.equal(beSub.defaultEnforced ?? false, false);
});

test("--days N overrides bundle cooldown for enable and check", async () => {
  const home = await setupHome();
  const { code: enableCode } = await runCli(["enable", "--days", "7"], home);
  assert.equal(enableCode, 0);
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(npmrc, /^min-release-age=7$/m);
  const uvtoml = await readFile(join(home, ".config", "uv", "uv.toml"), "utf8");
  assert.match(uvtoml, /^exclude-newer = "7 days"$/m);
  const bunfig = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(bunfig, /^minimumReleaseAge = 604800$/m);
  // pnpm uses minutes: 7 * 1440 = 10080, in its own rc file.
  const pnpmrc = await readFile(join(home, ".config", "pnpm", "rc"), "utf8");
  assert.match(pnpmrc, /^minimum-release-age=10080$/m);

  const r = await runCli(["check", "--json", "--days", "7"], home);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).bundleDays, 7);

  // Default check (3 days) still passes since 7 >= 3.
  const r2 = await runCli(["check", "--json"], home);
  assert.equal(r2.code, 0);

  // But raising the bar above the configured value flips check to fail.
  const r3 = await runCli(["check", "--days", "30"], home);
  assert.equal(r3.code, 1);
});

test("--days rejects non-positive integers with exit 2", async () => {
  const home = await setupHome();
  for (const bad of ["0", "-1", "abc", ""]) {
    const { code } = await runCli(["enable", "--days", bad], home);
    assert.equal(code, 2, `expected exit 2 for --days ${JSON.stringify(bad)}`);
  }
});

test("enable rejects positional arguments with exit 2", async () => {
  const home = await setupHome();
  const { code, err } = await runCli(["enable", "7"], home);
  assert.equal(code, 2);
  assert.match(err, /unexpected argument: 7/);
});

test("--version prints package.json version and exits 0", async () => {
  const home = await setupHome();
  const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf8"));
  for (const flag of ["--version", "-V"]) {
    const { code, out, err } = await runCli([flag], home);
    assert.equal(code, 0);
    assert.equal(out, `pmsec ${pkg.version}\n`);
    assert.equal(err, "");
  }
});
