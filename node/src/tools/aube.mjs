import { aubeConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";

export const name = "aube";
export const key = "minimumReleaseAge";
export const docs = "https://aube.jdx.dev/";
export const extras = [
  { key: "paranoid", expected: "true", line: "paranoid = true" },
];

export function path(ctx) { return aubeConfigPath(ctx.env, ctx.home, ctx.platform); }

function parseDays(value) {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n / 1440);
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  return { path: p, configured: value, days: parseDays(value), extras: readExtras(raw, extras) };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key} = ${days * 1440}`);
  text = applyExtras(text, extras);
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key);
  const ex = removeExtras(cooldown.text, extras);
  const removed = cooldown.removed || ex.removed;
  if (removed) await writeAtomic(p, ex.text);
  return { path: p, removed };
}
