import { homedir } from "node:os";
import { join } from "node:path";

export function npmrcPath(env = process.env, home = homedir()) {
  return env.NPM_CONFIG_USERCONFIG || join(home, ".npmrc");
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

export function miseConfigPath(env = process.env, home = homedir(), platform = process.platform) {
  if (env.MISE_GLOBAL_CONFIG_FILE) return env.MISE_GLOBAL_CONFIG_FILE;
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return join(base, "mise", "config.toml");
  }
  const base = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "mise", "config.toml");
}
