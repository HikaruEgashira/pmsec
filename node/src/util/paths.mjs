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
