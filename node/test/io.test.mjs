import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink, lstat, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../src/util/io.mjs";

const posix = process.platform !== "win32";

async function tmp() { return await mkdtemp(join(tmpdir(), "pmsec-io-")); }

test("root guard refuses a dir inside home that resolves outside it", { skip: !posix }, async () => {
  const home = await tmp();
  const outside = await tmp();
  await symlink(outside, join(home, ".config"));
  const p = join(home, ".config", "pnpm", "rc");
  await assert.rejects(writeAtomic(p, "x\n", { home, euid: 0, warn: () => {} }), /refusing to write under .* outside/);
  assert.equal(existsSync(join(outside, "pnpm")), false);
});

test("root guard lets paths outside the home through", { skip: !posix }, async () => {
  const home = await tmp();
  const other = await tmp();
  const p = join(other, "config.toml");
  await writeAtomic(p, "x\n", { home, euid: 0, warn: () => {} });
  assert.equal(await readFile(p, "utf8"), "x\n");
});

test("non-root writes skip the guard", { skip: !posix }, async () => {
  const home = await tmp();
  const outside = await tmp();
  await symlink(outside, join(home, ".config"));
  await writeAtomic(join(home, ".config", "a"), "x\n", { home, euid: 1000 });
  assert.equal(await readFile(join(outside, "a"), "utf8"), "x\n");
});

test("root handback chowns file, .bak and created dirs to the home owner", { skip: !posix }, async () => {
  const home = await tmp();
  const owner = await stat(home);
  await writeFile(join(home, ".npmrc"), "a=1\n");
  const warnings = [];
  await writeAtomic(join(home, ".npmrc"), "a=2\n", { home, euid: 0, warn: s => warnings.push(s) });
  await writeAtomic(join(home, "d1", "d2", "f"), "x\n", { home, euid: 0, warn: s => warnings.push(s) });
  // Running unprivileged, lchown to our own uid succeeds; as real root it
  // hands the files to the home owner. Either way no warning is emitted.
  assert.deepEqual(warnings, []);
  for (const p of [".npmrc", ".npmrc.bak", "d1", join("d1", "d2"), join("d1", "d2", "f")]) {
    const st = await lstat(join(home, p));
    assert.equal(st.uid, owner.uid, p);
  }
  assert.equal((await stat(join(home, "d1", "d2", "f"))).mode & 0o777, 0o644);
});

test("handback failures warn instead of failing the write", { skip: !posix || process.geteuid?.() === 0 }, async () => {
  const home = await tmp();
  const root = "/";
  // Home owned by root (uid 0): an unprivileged lchown to it fails with EPERM.
  const p = join(home, "f");
  const warnings = [];
  await writeAtomic(p, "x\n", { home: root, euid: 0, warn: s => warnings.push(s) });
  assert.equal(await readFile(p, "utf8"), "x\n");
  assert.match(warnings.join(""), /chown 0:0 .* failed/);
});
