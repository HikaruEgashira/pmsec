import { bunConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "bun";
export const key = "minimumReleaseAge";
export const section = "install";
export const docs = "https://bun.com/docs/runtime/bunfig#install";
export const minBin = [1, 3, 0];

export function path(env, home) { return bunConfigPath(env, home); }

export function preflight() {
  const v = detectVersion("bun");
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `bun ${v.raw} < ${minBin.join(".")}: minimumReleaseAge is silently ignored. Upgrade bun to enforce the cooldown.` };
}

export async function read(env, home) {
  const p = path(env, home);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  const seconds = value === null ? null : Number(value);
  return { path: p, configured: value, days: seconds === null || Number.isNaN(seconds) ? null : Math.floor(seconds / 86400) };
}

export async function write(days, env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const after = setKey(before, key, `${key} = ${days * 86400}`, { section });
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
