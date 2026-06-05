import { homedir } from "node:os";
import { join } from "node:path";

export function npmrcPath(env = process.env, home = homedir()) {
  return env.NPM_CONFIG_USERCONFIG || join(home, ".npmrc");
}

// pnpm reads its global rc from a dedicated location separate from ~/.npmrc.
// Writing pnpm-only keys here keeps npm from warning (and, in npm 12, erroring)
// about unknown user config. pnpm itself respects XDG_CONFIG_HOME on every OS.
export function pnpmRcPath(env = process.env, home = homedir(), platform = process.platform) {
  if (env.PMSEC_PNPM_CONFIG_FILE) return env.PMSEC_PNPM_CONFIG_FILE;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "pnpm", "rc");
  if (platform === "darwin") return join(home, "Library", "Preferences", "pnpm", "rc");
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return join(base, "pnpm", "config", "rc");
  }
  return join(home, ".config", "pnpm", "rc");
}

export function uvConfigPath(env = process.env, home = homedir(), platform = process.platform) {
  if (env.UV_CONFIG_FILE) return env.UV_CONFIG_FILE;
  if (platform === "win32") {
    const base = env.APPDATA || join(home, "AppData", "Roaming");
    return join(base, "uv", "uv.toml");
  }
  const base = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "uv", "uv.toml");
}

export function bunConfigPath(env = process.env, home = homedir()) {
  return env.BUN_CONFIG_FILE || join(home, ".bunfig.toml");
}

export function yarnrcPath(env = process.env, home = homedir()) {
  return env.YARN_RC_FILENAME || join(home, ".yarnrc.yml");
}

export function cargoConfigPath(env = process.env, home = homedir()) {
  if (env.CARGO_HOME) return join(env.CARGO_HOME, "config.toml");
  return join(home, ".cargo", "config.toml");
}

// Bundler's global config. BUNDLE_USER_CONFIG points at the file directly;
// BUNDLE_USER_HOME points at the home dir (config lives at <home>/config).
// Both default to ~/.bundle, matching bundler's own resolution order.
export function bundleConfigPath(env = process.env, home = homedir()) {
  if (env.BUNDLE_USER_CONFIG) return env.BUNDLE_USER_CONFIG;
  if (env.BUNDLE_USER_HOME) return join(env.BUNDLE_USER_HOME, "config");
  return join(home, ".bundle", "config");
}

export function miseConfigPath(env = process.env, home = homedir(), platform = process.platform) {
  if (env.MISE_GLOBAL_CONFIG_FILE) return env.MISE_GLOBAL_CONFIG_FILE;
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return join(base, "mise", "config.toml");
  }
  const base = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "mise", "config.toml");
}
