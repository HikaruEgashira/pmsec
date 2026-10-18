import { cargoConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "cargo";
export const key = "global-min-publish-age";
export const section = "registry";
export const docs = "https://doc.rust-lang.org/nightly/cargo/reference/config.html#registryglobal-min-publish-age";
export const minBin = [1, 100, 0];
export const extras = [];

// pmsec <= 2026.10.1 wrote this key, but cargo never supported it. Remove it
// when we touch the file so users do not mistake it for an enforced setting.
const legacy = { key: "minimum-release-age", section: "install" };

export function path(ctx) { return cargoConfigPath(ctx.env, ctx.home); }

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"?\s*(\d+)\s*(d|days?|w|weeks?|months?)\s*"?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (/^(w|weeks?)$/i.test(m[2])) return n * 7;
  if (/^(months?)$/i.test(m[2])) return n * 30;
  return n;
}

export function preflight(ctx) {
  const v = detectVersion("cargo", ["--version"], { env: ctx.env, overrideKey: "PMSEC_CARGO_VERSION" });
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `cargo ${v.raw} < ${minBin.join(".")}: global-min-publish-age is silently ignored. Upgrade cargo to enforce the cooldown.` };
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  return { path: p, configured: value, days: parseDays(value), extras: [] };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key} = "${days} days"`, { section });
  text = removeKey(text, legacy.key, { section: legacy.section }).text;
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key, { section });
  const old = removeKey(cooldown.text, legacy.key, { section: legacy.section });
  const removed = cooldown.removed || old.removed;
  if (removed) await writeAtomic(p, old.text);
  return { path: p, removed };
}
