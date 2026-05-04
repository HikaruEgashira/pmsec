import { miseConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { detectVersion, gte } from "../util/version.mjs";
export const name = "mise";
export const key = "minimum_release_age";
export const section = "settings";
export const docs = "https://mise.jdx.dev/configuration/settings.html#minimum_release_age";
export const minBin = [2026, 4, 22];
export const extras = [
  { key: "paranoid", expected: "true", line: "paranoid = true", section }
];

export function path(env, home, platform) { return miseConfigPath(env, home, platform); }

export function preflight() {
  const v = detectVersion("mise");
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `mise ${v.raw} < ${minBin.join(".")}: setting was named install_before before 2026.4.22 and minimum_release_age is silently ignored on older mise. Upgrade mise (\`mise self-update\`) to enforce the cooldown.` };
}

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"?\s*(\d+)\s*(d|days?|w|weeks?|m|months?|y|years?)\s*"?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (/^(w|weeks?)$/.test(unit)) return n * 7;
  if (/^(m|months?)$/.test(unit)) return n * 30;
  if (/^(y|years?)$/.test(unit)) return n * 365;
  return n;
}

export async function read(env, home, platform) {
  const p = path(env, home, platform);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  return {
    path: p, configured: value, days: parseDays(value),
    extras: readExtras(raw, extras)
  };
}

export async function write(days, env, home, platform) {
  const p = path(env, home, platform);
  const before = await readSafe(p);
  let after = setKey(before, key, `${key} = "${days}d"`, { section });
  after = applyExtras(after, extras);
  await writeAtomic(p, after);
  return { path: p, before, after };
}

export async function unset(env, home, platform) {
  const p = path(env, home, platform);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key, { section });
  const ex = removeExtras(cooldown.text, extras);
  const removed = cooldown.removed || ex.removed;
  if (removed) await writeAtomic(p, ex.text);
  return { path: p, removed };
}
