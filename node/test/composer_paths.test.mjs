import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
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

test("composer path defaults to Application Support on macOS without XDG", () => {
  assert.equal(
    composerConfigPath({}, "/Users/user", "darwin"),
    join("/Users/user", "Library", "Application Support", "composer", "config.json"),
  );
});

test("composer path defaults to .config on linux and APPDATA on Windows", () => {
  assert.equal(
    composerConfigPath({}, "/home/user", "linux"),
    join("/home/user", ".config", "composer", "config.json"),
  );
  assert.equal(
    composerConfigPath({ APPDATA: "C:\\Users\\user\\AppData\\Roaming" }, "C:\\Users\\user", "win32"),
    join("C:\\Users\\user\\AppData\\Roaming", "Composer", "config.json"),
  );
});
