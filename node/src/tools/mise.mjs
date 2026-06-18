import { miseConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { buildPreflight } from "../util/version.mjs";
export const name = "mise";
export const key = "minimum_release_age";
export const section = "settings";
export const docs = "https://mise.jdx.dev/configuration/settings.html#minimum_release_age";
export const minBin = [2026, 4, 22];
export const extras = [
  { key: "paranoid", expected: "true", line: "paranoid = true", section },
  { key: "gpg_verify", expected: "true", line: "gpg_verify = true", section },
  { key: "github_attestations", expected: "true", line: "github_attestations = true", section },
  { key: "slsa", expected: "true", line: "slsa = true", section },
];

export function path(ctx) { return miseConfigPath(ctx.env, ctx.home, ctx.platform); }

export const preflight = buildPreflight(name, minBin,
  "setting was named install_before before 2026.4.22 and minimum_release_age is silently ignored on older mise. Upgrade mise (`mise self-update`) to enforce the cooldown.");

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

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { section });
  return {
    path: p, configured: value, days: parseDays(value),
    extras: readExtras(raw, extras)
  };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key} = "${days}d"`, { section });
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
