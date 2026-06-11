import { bunConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { buildPreflight } from "../util/version.mjs";

export const name = "bun";
export const key = "minimumReleaseAge";
export const section = "install";
export const docs = "https://bun.com/docs/runtime/bunfig#install";
export const minBin = [1, 3, 0];
export const extras = [
  { key: "ignoreScripts", expected: "true", line: "ignoreScripts = true", section },
];

export function path(ctx) { return bunConfigPath(ctx.env, ctx.home); }

export const preflight = buildPreflight(name, minBin,
  "minimumReleaseAge is silently ignored. Upgrade bun to enforce the cooldown.");

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  const seconds = value === null ? null : Number(value);
  return {
    path: p, configured: value,
    days: seconds === null || Number.isNaN(seconds) ? null : Math.floor(seconds / 86400),
    extras: readExtras(raw, extras),
  };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key} = ${days * 86400}`, { section });
  text = applyExtras(text, extras);
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key, { section });
  const ex = removeExtras(cooldown.text, extras);
  const removed = cooldown.removed || ex.removed;
  if (removed) await writeAtomic(p, ex.text);
  return { path: p, removed };
}
