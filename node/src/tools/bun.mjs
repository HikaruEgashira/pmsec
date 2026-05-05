import { bunConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { buildPreflight } from "../util/version.mjs";

export const name = "bun";
export const key = "minimumReleaseAge";
export const section = "install";
export const docs = "https://bun.com/docs/runtime/bunfig#install";
export const minBin = [1, 3, 0];
export const extras = [];

export function path(ctx) { return bunConfigPath(ctx.env, ctx.home); }

export const preflight = buildPreflight(name, minBin,
  "minimumReleaseAge is silently ignored. Upgrade bun to enforce the cooldown.");

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  const seconds = value === null ? null : Number(value);
  return { path: p, configured: value, days: seconds === null || Number.isNaN(seconds) ? null : Math.floor(seconds / 86400), extras: [] };
}

export async function write(days, ctx) {
  const p = path(ctx);
  const text = setKey(await readSafe(p), key, `${key} = ${days * 86400}`, { section });
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const { text: after, removed } = removeKey(before, key, { section });
  if (removed) await writeAtomic(p, after);
  return { path: p, removed };
}
