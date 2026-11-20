import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { miseLayerPaths, miseSupportsNewMode } from "../src/util/paths.mjs";

test("mise layer paths on POSIX honor XDG_CONFIG_HOME", () => {
  const d = join("/xdg", "mise");
  assert.deepEqual(miseLayerPaths({ XDG_CONFIG_HOME: "/xdg" }, "/home/user", "linux"), {
    miseDir: d,
    baseConfig: join(d, "config.toml"),
    pmsecConfig: join(d, "config.pmsec.toml"),
    localMiserc: join(d, "miserc.local.toml"),
  });
  assert.equal(miseLayerPaths({}, "/home/user", "darwin").miseDir, join("/home/user", ".config", "mise"));
});

test("mise layer paths on win32 use LOCALAPPDATA and ignore the global override", () => {
  const env = { LOCALAPPDATA: "/la", XDG_CONFIG_HOME: "/xdg", MISE_GLOBAL_CONFIG_FILE: "/x.toml" };
  const p = miseLayerPaths(env, "/home/user", "win32");
  assert.equal(p.miseDir, join("/la", "mise"));
  assert.equal(p.pmsecConfig, join("/la", "mise", "config.pmsec.toml"));
  assert.equal(miseLayerPaths({}, "/home/user", "win32").baseConfig, join("/home/user", "AppData", "Local", "mise", "config.toml"));
});

test("mise new mode requires >= 2026.11.0 and no MISE_GLOBAL_CONFIG_FILE", () => {
  const v = (major, minor, patch) => ({ major, minor, patch });
  assert.equal(miseSupportsNewMode(v(2026, 11, 0), {}), true);
  assert.equal(miseSupportsNewMode(v(2027, 1, 0), {}), true);
  assert.equal(miseSupportsNewMode(v(2026, 10, 9), {}), false);
  assert.equal(miseSupportsNewMode(v(2025, 12, 0), {}), false);
  assert.equal(miseSupportsNewMode(null, {}), false);
  assert.equal(miseSupportsNewMode(v(2026, 11, 0), { MISE_GLOBAL_CONFIG_FILE: "/x.toml" }), false);
});
