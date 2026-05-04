import { cargoConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";

export const name = "cargo";
export const key = "minimum-release-age";
export const section = "install";
export const docs = "https://rust-lang.github.io/rfcs/3801-package-cooldown.html";
export const extras = [];

export function path(env, home) { return cargoConfigPath(env, home); }

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(w|weeks?)$/i.test(m[2]) ? n * 7 : n;
}

export async function read(env, home) {
  const p = path(env, home);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  return { path: p, configured: value, days: parseDays(value), extras: [] };
}

export async function write(days, env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const after = setKey(before, key, `${key} = "${days}d"`, { section });
  await writeAtomic(p, after);
  return { path: p, before, after };
}

export async function unset(env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const { text: after, removed } = removeKey(before, key, { section });
  if (removed) await writeAtomic(p, after);
  return { path: p, removed };
}
