import { uvConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "uv";
export const key = "exclude-newer";
export const docs = "https://docs.astral.sh/uv/reference/settings/#exclude-newer";
export const minBin = [0, 9, 17];

export function path(env, home, platform) { return uvConfigPath(env, home, platform); }

export function preflight() {
  const v = detectVersion("uv");
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: false, version: v.raw, message: `uv ${v.raw} < ${minBin.join(".")}: writing exclude-newer = "N days" will break this uv. Upgrade uv (uv self update) or rerun with --force.` };
}

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"\s*(\d+)\s*(day|days|d|week|weeks|w)\s*"$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(week|weeks|w)$/i.test(m[2]) ? n * 7 : n;
}

export async function read(env, home, platform) {
  const p = path(env, home, platform);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  return { path: p, configured: value, days: parseDays(value) };
}

export async function write(days, env, home, platform) {
  const p = path(env, home, platform);
  const before = await readSafe(p);
  const after = setKey(before, key, `${key} = "${days} days"`);
  await writeAtomic(p, after);
  return { path: p, before, after };
}

export async function unset(env, home, platform) {
  const p = path(env, home, platform);
  const before = await readSafe(p);
  const { text: after, removed } = removeKey(before, key);
  if (removed) await writeAtomic(p, after);
  return { path: p, removed };
}
