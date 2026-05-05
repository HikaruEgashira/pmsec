import { cargoConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";

export const name = "cargo";
export const key = "minimum-release-age";
export const section = "install";
export const docs = "https://rust-lang.github.io/rfcs/3801-package-cooldown.html";
export const extras = [];

export function path(ctx) { return cargoConfigPath(ctx.env, ctx.home); }

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(w|weeks?)$/i.test(m[2]) ? n * 7 : n;
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  return { path: p, configured: value, days: parseDays(value), extras: [] };
}

export async function write(days, ctx) {
  const p = path(ctx);
  const text = setKey(await readSafe(p), key, `${key} = "${days}d"`, { section });
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
