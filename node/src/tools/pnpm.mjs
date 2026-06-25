import { pnpmRcPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "pnpm";
export const key = "minimum-release-age";
export const docs = "https://pnpm.io/settings#minimumreleaseage";
export const minBin = [10, 6, 0];
// `defaultSinceMajor`: pnpm major version where the value became the default.
// Once detected, an absent line in the rc file is still effectively in force,
// so `read()` reports it as ok with `defaultEnforced: true`.
export const extras = [
  { key: "trust-policy", expected: "no-downgrade", line: "trust-policy=no-downgrade" },
  { key: "block-exotic-subdeps", expected: "true", line: "block-exotic-subdeps=true", defaultSinceMajor: 11 },
  { key: "strict-dep-builds", expected: "true", line: "strict-dep-builds=true" },
  { key: "verify-deps-before-run", expected: "error", line: "verify-deps-before-run=error" },
  { key: "minimum-release-age-strict", expected: "true", line: "minimum-release-age-strict=true" },
];

export function path(ctx) { return pnpmRcPath(ctx.env, ctx.home, ctx.platform); }

// Cache `pnpm --version` for the lifetime of the process. preflight() and
// read() both want it; without memoization a single `pmsec check` spawns
// pnpm twice. Cache key is the override env value so tests with different
// `PMSEC_PNPM_VERSION` settings invalidate naturally.
let _versionCache = null;
function pnpmVersion(ctx) {
  const override = ctx.env?.PMSEC_PNPM_VERSION ?? null;
  if (_versionCache && _versionCache.override === override) return _versionCache.value;
  const v = detectVersion("pnpm", ["--version"], { env: ctx.env, overrideKey: "PMSEC_PNPM_VERSION" });
  _versionCache = { override, value: v };
  return v;
}

export function preflight(ctx) {
  const v = pnpmVersion(ctx);
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `pnpm ${v.raw} < ${minBin.join(".")}: minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown.` };
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  const minutes = value === null ? null : Number(value);
  const v = pnpmVersion(ctx);
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

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key}=${days * 24 * 60}`);
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
