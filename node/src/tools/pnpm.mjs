import { npmrcPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "pnpm";
export const key = "minimum-release-age";
export const docs = "https://pnpm.io/settings#minimumreleaseage";
export const minBin = [10, 6, 0];
// `defaultSinceMajor`: pnpm major version where the value became the default.
// Once detected, an absent line in `.npmrc` is still effectively in force, so
// `read()` reports it as ok with `defaultEnforced: true`.
export const extras = [
  { key: "trust-policy", expected: "no-downgrade", line: "trust-policy=no-downgrade" },
  { key: "block-exotic-subdeps", expected: "true", line: "block-exotic-subdeps=true", defaultSinceMajor: 11 },
  { key: "strict-dep-builds", expected: "true", line: "strict-dep-builds=true" }
];

export function path(env, home) { return npmrcPath(env, home); }

function pnpmVersion(env) {
  return detectVersion("pnpm", ["--version"], { env, overrideKey: "PMSEC_PNPM_VERSION" });
}

export function preflight(env) {
  const v = pnpmVersion(env);
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `pnpm ${v.raw} < ${minBin.join(".")}: minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown.` };
}

export async function read(env, home) {
  const p = path(env, home);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  const minutes = value === null ? null : Number(value);
  const v = pnpmVersion(env);
  const defaults = new Map(extras.filter(x => x.defaultSinceMajor).map(x => [x.key, x.defaultSinceMajor]));
  const evaluated = readExtras(raw, extras).map(e => {
    const def = defaults.get(e.key);
    if (e.configured === null && def && v && v.major >= def) {
      return { ...e, ok: true, defaultEnforced: true };
    }
    return e;
  });
  return {
    path: p, configured: value,
    days: minutes === null || Number.isNaN(minutes) ? null : Math.floor(minutes / (60 * 24)),
    extras: evaluated
  };
}

export async function write(days, env, home) {
  const p = path(env, home);
  const before = await readSafe(p);
  let after = setKey(before, key, `${key}=${days * 24 * 60}`);
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
