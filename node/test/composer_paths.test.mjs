import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { composerConfigPath } from "../src/util/paths.mjs";

test("composer path honors COMPOSER_HOME on every platform", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    assert.equal(
      composerConfigPath({ COMPOSER_HOME: "/custom/composer" }, "/home/user", platform),
      join("/custom/composer", "config.json"),
    );
  }
});

test("composer path honors XDG_CONFIG_HOME on linux and macOS", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.equal(
      composerConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/user", platform),
      join("/xdg", "composer", "config.json"),
    );
  }
});

// Composer's Factory::getHomeDir switches to XDG when *any* XDG_* variable is
// present, and then prefers $XDG_CONFIG_HOME/composer (default ~/.config/composer).
test("composer path: any XDG_* variable selects ~/.config/composer", () => {
  assert.equal(
    composerConfigPath({ XDG_SESSION_TYPE: "tty" }, "/home/user", "linux"),
    join("/home/user", ".config", "composer", "config.json"),
  );
});

// Composer never uses Application Support on macOS, and macOS has no /etc/xdg.
test("composer path defaults to ~/.composer on macOS without XDG", () => {
  assert.equal(composerConfigPath({}, "/Users/user", "darwin"), join("/Users/user", ".composer", "config.json"));
});

test("composer path prefers whichever candidate directory already exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "pmsec-composer-"));
  await mkdir(join(home, ".composer"));
  assert.equal(
    composerConfigPath({ XDG_CONFIG_HOME: join(home, ".config") }, home, "linux"),
    join(home, ".composer", "config.json"),
  );
});

test("composer path uses APPDATA on Windows", () => {
  assert.equal(
    composerConfigPath({ APPDATA: "C:\\Users\\user\\AppData\\Roaming" }, "C:\\Users\\user", "win32"),
    join("C:\\Users\\user\\AppData\\Roaming", "Composer", "config.json"),
  );
});
