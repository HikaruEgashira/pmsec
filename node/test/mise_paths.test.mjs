import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { miseLayerPaths } from "../src/util/paths.mjs";
import { supportsNewMode } from "../src/tools/mise.mjs";

const v = (major, minor, patch) => ({ major, minor, patch, raw: `${major}.${minor}.${patch}` });

test("mise layer paths use XDG_CONFIG_HOME on POSIX", () => {
  for (const platform of ["linux", "darwin"]) {
    const dir = join("/xdg", "mise");
    assert.deepEqual(miseLayerPaths({ XDG_CONFIG_HOME: "/xdg" }, "/home/user", platform), {
      miseDir: dir,
      baseConfig: join(dir, "config.toml"),
      pmsecConfig: join(dir, "config.pmsec.toml"),
      localMiserc: join(dir, "miserc.toml"),
    });
  }
});

test("mise layer paths default to ~/.config/mise on POSIX", () => {
  const p = miseLayerPaths({}, "/home/user", "linux");
  assert.equal(p.miseDir, join("/home/user", ".config", "mise"));
  assert.equal(p.pmsecConfig, join("/home/user", ".config", "mise", "config.pmsec.toml"));
});

test("mise layer paths use LOCALAPPDATA on win32", () => {
  const base = "C:\\Users\\user\\AppData\\Local";
  const p = miseLayerPaths({ LOCALAPPDATA: base, XDG_CONFIG_HOME: "/xdg" }, "C:\\Users\\user", "win32");
  assert.equal(p.miseDir, join(base, "mise"));
  assert.equal(p.baseConfig, join(base, "mise", "config.toml"));
  assert.equal(p.pmsecConfig, join(base, "mise", "config.pmsec.toml"));
  assert.equal(p.localMiserc, join(base, "mise", "miserc.toml"));
  assert.equal(miseLayerPaths({}, "C:\\Users\\user", "win32").miseDir, join("C:\\Users\\user", "AppData", "Local", "mise"));
});

test("mise layer paths honor MISE_CONFIG_DIR on every platform", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    assert.equal(miseLayerPaths({ MISE_CONFIG_DIR: "/m" }, "/home/user", platform).pmsecConfig, join("/m", "config.pmsec.toml"));
  }
});

test("mise new mode requires >= 2026.11.0", () => {
  assert.equal(supportsNewMode(v(2026, 11, 0), {}), true);
  assert.equal(supportsNewMode(v(2027, 1, 0), {}), true);
  assert.equal(supportsNewMode(v(2026, 10, 9), {}), false);
  assert.equal(supportsNewMode(null, {}), false);
});

test("mise new mode is disabled by MISE_GLOBAL_CONFIG_FILE", () => {
  assert.equal(supportsNewMode(v(2026, 11, 0), { MISE_GLOBAL_CONFIG_FILE: "/x/config.toml" }), false);
});
