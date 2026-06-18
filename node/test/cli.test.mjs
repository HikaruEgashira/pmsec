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
  // Hide the host pnpm/bundler by default so version-aware behavior (pnpm 11
  // default enforcement, bundler preflight warnings) doesn't depend on what's
  // installed on the test machine.
  return { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PMSEC_PNPM_VERSION: "none", PMSEC_BUNDLER_VERSION: "none", ...overrides };
}

async function runCli(argv, home, platform = "linux", envOverrides = {}) {
  const out = sink(), err = sink();
  const code = await run(argv, { env: envFor(home, envOverrides), home, platform, out, err });
  return { code, out: out.text(), err: err.text() };
}

test("default invocation writes the bundle (cooldown + extras) for every tool", async () => {
  const home = await setupHome();
  const { code } = await runCli([], home);
  assert.equal(code, 0);
  const npmrc = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(npmrc, /^min-release-age=1$/m);
  assert.match(npmrc, /^audit-level=high$/m);
  assert.match(npmrc, /^allow-git=root$/m);
  assert.match(npmrc, /^allow-remote=root$/m);
  assert.match(npmrc, /^allow-file=root$/m);
  assert.match(npmrc, /^allow-directory=root$/m);
  assert.doesNotMatch(npmrc, /minimum-release-age/, "pnpm keys must not leak into .npmrc");
  const pnpmrc = await readFile(join(home, ".config", "pnpm", "rc"), "utf8");
  assert.match(pnpmrc, /^minimum-release-age=1440$/m);
  assert.match(pnpmrc, /^trust-policy=no-downgrade$/m);
  assert.match(pnpmrc, /^block-exotic-subdeps=true$/m);
  assert.match(pnpmrc, /^strict-dep-builds=true$/m);
  const uvtoml = await readFile(join(home, ".config", "uv", "uv.toml"), "utf8");
  assert.match(uvtoml, /^exclude-newer = "1 days"$/m);
  assert.match(uvtoml, /^index-strategy = "first-index"$/m);
  const bunfig = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(bunfig, /^\[install\]$/m);
  assert.match(bunfig, /^minimumReleaseAge = 86400$/m);
  assert.match(bunfig, /^ignoreScripts = true$/m);
  const yarnrc = await readFile(join(home, ".yarnrc.yml"), "utf8");
  assert.match(yarnrc, /^npmMinimalAgeGate: "1d"$/m);
  assert.match(yarnrc, /^enableHardenedMode: true$/m);
  assert.match(yarnrc, /^enableScripts: false$/m);
  const mise = await readFile(join(home, ".config", "mise", "config.toml"), "utf8");
  assert.match(mise, /^\[settings\]$/m);
  assert.match(mise, /^minimum_release_age = "1d"$/m);
  assert.match(mise, /^paranoid = true$/m);
  assert.match(mise, /^gpg_verify = true$/m);
  assert.match(mise, /^github_attestations = true$/m);
  assert.match(mise, /^slsa = true$/m);
  const bundle = await readFile(join(home, ".bundle", "config"), "utf8");
  assert.match(bundle, /^BUNDLE_COOLDOWN: "1"$/m);
});

test("--check passes after default enable across all tools", async () => {
  const home = await setupHome();
  await runCli([], home);
  const { code } = await runCli(["--check"], home);
  assert.equal(code, 0);
});

test("--check fails when the bundle is missing", async () => {
  const home = await setupHome();
  const { code, out } = await runCli(["--check"], home);
  assert.equal(code, 1);
  for (const t of ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv", "bundler"]) {
    assert.match(out, new RegExp(`MISSING ${t}`));
  }
});

test("--disable preserves unrelated keys per file", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "registry=https://r/\nmin-release-age=3\n");
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  await writeFile(join(home, ".config", "pnpm", "rc"), "minimum-release-age=4320\nstore-dir=/tmp/pstore\n");
  await mkdir(join(home, ".config", "uv"), { recursive: true });
  await writeFile(join(home, ".config", "uv", "uv.toml"), 'exclude-newer = "3 days"\nlink-mode = "copy"\n');
  await writeFile(join(home, ".bunfig.toml"), "[install]\nminimumReleaseAge = 259200\nregistry = \"https://x/\"\n");
  await writeFile(join(home, ".yarnrc.yml"), "npmMinimalAgeGate: \"3d\"\nnpmRegistryServer: \"https://r/\"\n");
  await runCli(["--disable"], home);
  assert.equal(await readFile(join(home, ".npmrc"), "utf8"), "registry=https://r/\n");
  assert.equal(await readFile(join(home, ".config", "pnpm", "rc"), "utf8"), "store-dir=/tmp/pstore\n");
  assert.equal(await readFile(join(home, ".config", "uv", "uv.toml"), "utf8"), 'link-mode = "copy"\n');
  assert.equal(await readFile(join(home, ".bunfig.toml"), "utf8"), "[install]\nregistry = \"https://x/\"\n");
  assert.equal(await readFile(join(home, ".yarnrc.yml"), "utf8"), "npmRegistryServer: \"https://r/\"\n");
});

test("enable upgrades values that are weaker than the request", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=3\nregistry=https://r/\n");
  await runCli(["--tool", "npm", "--days", "7"], home);
  assert.equal(
    await readFile(join(home, ".npmrc"), "utf8"),
    "min-release-age=7\nregistry=https://r/\naudit-level=high\nallow-git=root\nallow-remote=root\nallow-file=root\nallow-directory=root\n"
  );
});

// Catches a class of formatting bug where the human-readable output
// leaks unresolved placeholders ({N}) because of a string-construction
// mistake. Walks every code path that emits a formatted line.
test("human output never leaks unresolved placeholders", async () => {
  const scenarios = [
    { name: "enable", setup: async () => {}, args: ["--tool", "npm", "--days", "7"] },
    { name: "keep", setup: async (h) => writeFile(join(h, ".npmrc"), "min-release-age=99\n"), args: ["--tool", "npm"] },
    { name: "upgrade", setup: async (h) => writeFile(join(h, ".npmrc"), "min-release-age=3\n"), args: ["--tool", "npm", "--days", "7"] },
    { name: "check_fail", setup: async () => {}, args: ["--check"] },
    { name: "check_pass", setup: async (h, runCli) => { await runCli([], h); }, args: ["--check"] },
    { name: "disable", setup: async (h, runCli) => { await runCli(["--tool", "npm"], h); }, args: ["--disable", "--tool", "npm"] },
  ];
  for (const s of scenarios) {
    const home = await setupHome();
    await s.setup(home, runCli);
    const { out, err } = await runCli(s.args, home);
    assert.doesNotMatch(out + err, /\{[0-9]+\}/, `${s.name} leaked placeholder: ${out}${err}`);
  }
});

test("enable preserves stricter existing cooldowns", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=99\nregistry=https://r/\n");
  const { code, out } = await runCli(["--tool", "npm"], home);
  assert.equal(code, 0);
  assert.match(out, /^keep\s+npm\s+\[[^\]]+\]\s+\(kept existing 99d \S+ \d+d\)/m);
  assert.equal(
    await readFile(join(home, ".npmrc"), "utf8"),
    "min-release-age=99\nregistry=https://r/\naudit-level=high\nallow-git=root\nallow-remote=root\nallow-file=root\nallow-directory=root\n"
  );
});

test("--force overwrites stricter existing values", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=99\n");
  const { code } = await runCli(["--tool", "npm", "--days", "1", "--force"], home);
  assert.equal(code, 0);
  const text = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(text, /^min-release-age=1$/m);
});

test("--days upgrades when request exceeds existing", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "min-release-age=3\n");
  await runCli(["--tool", "npm", "--days", "14"], home);
  const text = await readFile(join(home, ".npmrc"), "utf8");
  assert.match(text, /^min-release-age=14$/m);
});

test("--tool restricts which tools get written", async () => {
  const home = await setupHome();
  await runCli(["--tool", "npm,bun"], home);
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
  await run(["--tool", "uv"], { env: { APPDATA: appdata }, home, platform: "win32", out, err });
  const text = await readFile(join(appdata, "uv", "uv.toml"), "utf8");
  assert.match(text, /^exclude-newer = "1 days"$/m);
});

test("--json emits parseable JSON for --check", async () => {
  const home = await setupHome();
  const { out } = await runCli(["--check", "--json"], home);
  const data = JSON.parse(out);
  assert.equal(data.ok, false);
  assert.equal(data.bundleDays, 1);
  assert.equal(data.rows.length, 8);
  assert.deepEqual(data.rows.map(r => r.tool), ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv", "bundler"]);
});

test("bun enable inserts key inside existing [install] section", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".bunfig.toml"), "[install]\nregistry = \"https://x/\"\n");
  await runCli(["--tool", "bun"], home);
  const text = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(text, /^\[install\]\nignoreScripts = true\nminimumReleaseAge = 86400\nregistry = "https:\/\/x\/"$/m);
});

test("bun enable creates [install] section if missing", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".bunfig.toml"), "telemetry = false\n");
  await runCli(["--tool", "bun"], home);
  const text = await readFile(join(home, ".bunfig.toml"), "utf8");
  assert.match(text, /^telemetry = false\n\n\[install\]\nignoreScripts = true\nminimumReleaseAge = 86400\n$/);
});

test("yarn check parses npmMinimalAgeGate days correctly", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".yarnrc.yml"), "npmMinimalAgeGate: \"14d\"\nenableHardenedMode: true\nenableScripts: false\n");
  const { out } = await runCli(["--check", "--json", "--tool", "yarn"], home);
  const data = JSON.parse(out);
  assert.equal(data.ok, true);
  assert.equal(data.rows[0].days, 14);
});

test("bundler enable writes quoted integer days and preserves unrelated keys", async () => {
  const home = await setupHome();
  await mkdir(join(home, ".bundle"), { recursive: true });
  await writeFile(join(home, ".bundle", "config"), "---\nBUNDLE_PATH: \"vendor/bundle\"\n");
  await runCli(["--tool", "bundler", "--days", "7"], home);
  const text = await readFile(join(home, ".bundle", "config"), "utf8");
  assert.match(text, /^BUNDLE_COOLDOWN: "7"$/m);
  assert.match(text, /^BUNDLE_PATH: "vendor\/bundle"$/m);
});

test("bundler check parses BUNDLE_COOLDOWN days (quoted)", async () => {
  const home = await setupHome();
  await mkdir(join(home, ".bundle"), { recursive: true });
  await writeFile(join(home, ".bundle", "config"), "---\nBUNDLE_COOLDOWN: \"14\"\n");
  const { out } = await runCli(["--check", "--json", "--tool", "bundler"], home);
  const data = JSON.parse(out);
  assert.equal(data.ok, true);
  assert.equal(data.rows[0].days, 14);
});

test("bundler honors BUNDLE_USER_CONFIG override", async () => {
  const home = await setupHome();
  const cfg = join(home, "custom-bundle-config");
  await runCli(["--tool", "bundler"], home, "linux", { BUNDLE_USER_CONFIG: cfg });
  const text = await readFile(cfg, "utf8");
  assert.match(text, /^BUNDLE_COOLDOWN: "1"$/m);
});

test("bundler disable removes the cooldown", async () => {
  const home = await setupHome();
  await runCli(["--tool", "bundler"], home);
  await runCli(["--disable", "--tool", "bundler"], home);
  const { out } = await runCli(["--check", "--tool", "bundler"], home);
  assert.match(out, /MISSING bundler/);
});

test("pnpm check normalizes minutes to days", async () => {
  const home = await setupHome();
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  await writeFile(join(home, ".config", "pnpm", "rc"), "minimum-release-age=20160\n");
  const { out } = await runCli(["--check", "--json", "--tool", "pnpm"], home);
  const data = JSON.parse(out);
  assert.equal(data.rows[0].days, 14);
});

test(".bak is created once and never overwritten", async () => {
  const home = await setupHome();
  await writeFile(join(home, ".npmrc"), "registry=https://original/\n");
  await runCli(["--tool", "npm"], home);
  await runCli(["--disable", "--tool", "npm"], home);
  await runCli(["--tool", "npm"], home);
  const bak = await readFile(join(home, ".npmrc.bak"), "utf8");
  assert.equal(bak, "registry=https://original/\n");
});

test("hardening extras: --check fails when extras missing, default enable fixes them, --disable removes them", async () => {
  const home = await setupHome();
  await mkdir(join(home, ".config", "pnpm"), { recursive: true });
  const pnpmrc = join(home, ".config", "pnpm", "rc");
  await writeFile(pnpmrc, "minimum-release-age=20160\n");
  const r1 = await runCli(["--check", "--json", "--tool", "pnpm"], home);
  const d1 = JSON.parse(r1.out);
  assert.equal(r1.code, 1, "extras missing should fail check");
  assert.equal(d1.rows[0].extras.length, 3);
  assert.equal(d1.rows[0].extras.every(e => !e.ok), true);

  await runCli(["--tool", "pnpm"], home);
  const after1 = await readFile(pnpmrc, "utf8");
  assert.match(after1, /^trust-policy=no-downgrade$/m);
  assert.match(after1, /^block-exotic-subdeps=true$/m);
  assert.match(after1, /^strict-dep-builds=true$/m);

  const r2 = await runCli(["--check", "--json", "--tool", "pnpm"], home);
  assert.equal(r2.code, 0);
  assert.equal(JSON.parse(r2.out).ok, true);

  await runCli(["--disable", "--tool", "pnpm"], home);
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
  const { code, out } = await runCli(["--check", "--json", "--tool", "pnpm"], home, "linux", { PMSEC_PNPM_VERSION: "11.0.0" });
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
  const { out } = await runCli(["--check", "--json", "--tool", "pnpm"], home, "linux", { PMSEC_PNPM_VERSION: "10.26.0" });
  const beSub = JSON.parse(out).rows[0].extras.find(e => e.key === "block-exotic-subdeps");
  assert.equal(beSub.ok, false);
  assert.equal(beSub.defaultEnforced ?? false, false);
});

test("--days N overrides bundle cooldown for enable and check", async () => {
  const home = await setupHome();
  const { code: enableCode } = await runCli(["--days", "7"], home);
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

  const r = await runCli(["--check", "--json", "--days", "7"], home);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).bundleDays, 7);

  // Default check (1 day) still passes since 7 >= 1.
  const r2 = await runCli(["--check", "--json"], home);
  assert.equal(r2.code, 0);

  // But raising the bar above the configured value flips check to fail.
  const r3 = await runCli(["--check", "--days", "30"], home);
  assert.equal(r3.code, 1);
});

test("--days rejects non-positive integers with exit 2", async () => {
  const home = await setupHome();
  for (const bad of ["0", "-1", "abc", ""]) {
    const { code } = await runCli(["--days", bad], home);
    assert.equal(code, 2, `expected exit 2 for --days ${JSON.stringify(bad)}`);
  }
});

test("rejects positional arguments with exit 2", async () => {
  const home = await setupHome();
  const { code, err } = await runCli(["enable"], home);
  assert.equal(code, 2);
  assert.match(err, /unexpected argument: enable/);
});

test("--check and --disable are mutually exclusive", async () => {
  const home = await setupHome();
  const { code, err } = await runCli(["--check", "--disable"], home);
  assert.equal(code, 2);
  assert.match(err, /mutually exclusive/);
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

test("--doctor --json reports per-tool writability and exits 0 on a fresh home", async () => {
  const home = await setupHome();
  const { code, out } = await runCli(["--doctor", "--json"], home);
  const data = JSON.parse(out);
  assert.equal(data.doctor, true);
  assert.equal(data.ok, true);
  assert.equal(code, 0);
  assert.deepEqual(data.tools.map(t => t.tool), ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv", "bundler"]);
  for (const t of data.tools) {
    for (const key of ["path", "parent", "exists", "writable", "parentExists", "parentWritable", "owner"]) {
      assert.ok(key in t, `${t.tool} missing ${key}`);
    }
    assert.equal(t.parentWritable, true, `${t.tool} parent should be writable in fresh tmp`);
  }
  assert.equal(data.pmsecHomeSource, "HOME");
});

test("--doctor blocks when the parent directory is not writable", { skip: process.platform === "win32" ? "POSIX permission semantics; Windows ignores chmod for non-execute bits" : false }, async () => {
  const { chmod, mkdir: mk } = await import("node:fs/promises");
  const home = await setupHome();
  const ro = join(home, "ro");
  await mk(ro);
  await chmod(ro, 0o500);
  try {
    const { code, out } = await runCli(
      ["--doctor", "--json", "--tool", "npm"],
      ro,
      "linux",
      { NPM_CONFIG_USERCONFIG: join(ro, ".npmrc") },
    );
    const data = JSON.parse(out);
    assert.equal(data.ok, false);
    assert.equal(code, 1);
    assert.equal(data.tools[0].parentWritable, false);
  } finally {
    await chmod(ro, 0o700);
  }
});
