import { miseConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
export const name = "mise";
export const key = "minimum_release_age";
export const section = "settings";
export const docs = "https://mise.jdx.dev/configuration/settings.html#minimum_release_age";

export function path(env, home, platform) { return miseConfigPath(env, home, platform); }

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"?\s*(\d+)\s*(d|days?|w|weeks?|m|months?|y|years?)\s*"?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (/^(w|weeks?)$/.test(unit)) return n * 7;
  if (/^(m|months?)$/.test(unit)) return n * 30;
  if (/^(y|years?)$/.test(unit)) return n * 365;
  return n;
}

export async function read(env, home, platform) {
  const p = path(env, home, platform);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  return { path: p, configured: value, days: parseDays(value) };
}

export async function write(days, env, home, platform) {
  const p = path(env, home, platform);
  const before = await readSafe(p);
  const after = setKey(before, key, `${key} = "${days}d"`, { section });
  await writeAtomic(p, after);
  return { path: p, before, after };
}

export async function unset(env, home, platform) {
  const p = path(env, home, platform);
  const before = await readSafe(p);
  const { text: after, removed } = removeKey(before, key, { section });
  if (removed) await writeAtomic(p, after);
  return { path: p, removed };
}
