import { bundleConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { buildPreflight } from "../util/version.mjs";

export const name = "bundler";
export const key = "BUNDLE_COOLDOWN";
export const docs = "https://bundler.io/man/bundle-config.1.html";
export const minBin = [4, 0, 13];
export const extras = [];
const SEP = ":";

export function path(ctx) { return bundleConfigPath(ctx.env, ctx.home); }

export const preflight = buildPreflight(name, minBin,
  "BUNDLE_COOLDOWN is silently ignored. Upgrade bundler (v4.0.13+) to enforce the cooldown.");

// bundler stores the cooldown as a plain integer number of days, quoted in the
// YAML config (e.g. `BUNDLE_COOLDOWN: "7"`). Accept it with or without quotes.
function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"?\s*(\d+)\s*"?$/);
  return m ? Number(m[1]) : null;
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { sep: SEP });
  return { path: p, configured: value, days: parseDays(value), extras: [] };
}

export async function write(days, ctx) {
  const p = path(ctx);
  const text = setKey(await readSafe(p), key, `${key}: "${days}"`, { sep: SEP });
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const { text: after, removed } = removeKey(before, key, { sep: SEP });
  if (removed) await writeAtomic(p, after);
  return { path: p, removed };
}
