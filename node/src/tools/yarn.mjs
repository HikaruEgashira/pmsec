import { yarnrcPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "yarn";
export const key = "npmMinimalAgeGate";
export const docs = "https://yarnpkg.com/configuration/yarnrc#npmMinimalAgeGate";
export const minBin = [4, 10, 0];
const SEP = ":";

export function path(env, home) { return yarnrcPath(env, home); }

export function preflight() {
  const v = detectVersion("yarn");
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `yarn ${v.raw} < ${minBin.join(".")}: npmMinimalAgeGate is silently ignored. Upgrade yarn (v4.10+) to enforce the cooldown.` };
}

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
  const value = readKey(raw, key, { sep: SEP });
  return { path: p, configured: value, days: parseDays(value) };
}

export async function write(days, env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const after = setKey(before, key, `${key}: "${days}d"`, { sep: SEP });
  await writeAtomic(p, after);
  return { path: p, before, after };
}

export async function unset(env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const { text: after, removed } = removeKey(before, key, { sep: SEP });
  if (removed) await writeAtomic(p, after);
  return { path: p, removed };
}
