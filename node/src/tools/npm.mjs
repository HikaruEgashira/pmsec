import { npmrcPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "npm";
export const key = "min-release-age";
export const docs = "https://docs.npmjs.com/cli/v11/using-npm/config#min-release-age";
export const minBin = [11, 10, 0];
export const extras = [
  { key: "audit-level", expected: "high", line: "audit-level=high" }
];

export function path(env, home) { return npmrcPath(env, home); }

export function preflight() {
  const v = detectVersion("npm");
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `npm ${v.raw} < ${minBin.join(".")}: min-release-age is silently ignored. Upgrade npm to enforce the cooldown.` };
}

export async function read(env, home) {
  const p = path(env, home);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  return {
    path: p, configured: value,
    days: value === null ? null : Number(value),
    extras: readExtras(raw, extras)
  };
}

export async function write(days, env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  let after = setKey(before, key, `${key}=${days}`);
  after = applyExtras(after, extras);
  await writeAtomic(p, after);
  return { path: p, before, after };
}

export async function unset(env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key);
  const ex = removeExtras(cooldown.text, extras);
  const removed = cooldown.removed || ex.removed;
  if (removed) await writeAtomic(p, ex.text);
  return { path: p, removed };
}
