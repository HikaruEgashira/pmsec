import { npmrcPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "pnpm";
export const key = "minimum-release-age";
export const docs = "https://pnpm.io/settings#minimumreleaseage";
export const minBin = [10, 6, 0];

export function path(env, home) { return npmrcPath(env, home); }

export function preflight() {
  const v = detectVersion("pnpm");
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `pnpm ${v.raw} < ${minBin.join(".")}: minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown.` };
}

export async function read(env, home) {
  const p = path(env, home);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  const minutes = value === null ? null : Number(value);
  return { path: p, configured: value, days: minutes === null || Number.isNaN(minutes) ? null : Math.floor(minutes / (60 * 24)) };
}

export async function write(days, env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const after = setKey(before, key, `${key}=${days * 24 * 60}`);
  await writeAtomic(p, after);
  return { path: p, before, after };
}

export async function unset(env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const { text: after, removed } = removeKey(before, key);
  if (removed) await writeAtomic(p, after);
  return { path: p, removed };
}
