import { cargoConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";

export const name = "cargo";
export const key = "minimum-release-age";
export const section = "install";
export const docs = "https://rust-lang.github.io/rfcs/3801-package-cooldown.html";
export const extras = [];

// Stabilized resolver cooldown (cargo >= 1.100). It tracks `--days` like the
// primary key, so it is handled here rather than as a fixed-value extra.
const publishAge = { key: "global-min-publish-age", section: "registry" };

export function path(ctx) { return cargoConfigPath(ctx.env, ctx.home); }

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(w|weeks?)$/i.test(m[2]) ? n * 7 : n;
}

function parsePublishAgeDays(value) {
  if (value === null) return null;
  const m = value.match(/^"\s*(\d+)\s*(days?|weeks?|months?)\s*"$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (/^weeks?$/i.test(m[2])) return n * 7;
  if (/^months?$/i.test(m[2])) return n * 30;
  return n;
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  const days = parseDays(value);
  const cur = readKey(raw, publishAge.key, { section: publishAge.section });
  const want = days ?? 1;
  const curDays = parsePublishAgeDays(cur);
  return {
    path: p, configured: value, days,
    extras: [{ key: publishAge.key, configured: cur, expected: `"${want} days"`, ok: curDays !== null && curDays >= want }],
  };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key} = "${days}d"`, { section });
  text = setKey(text, publishAge.key, `${publishAge.key} = "${days} days"`, { section: publishAge.section });
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key, { section });
  const age = removeKey(cooldown.text, publishAge.key, { section: publishAge.section });
  const removed = cooldown.removed || age.removed;
  if (removed) await writeAtomic(p, age.text);
  return { path: p, removed };
}
