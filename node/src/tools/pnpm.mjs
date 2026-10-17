import { pnpmRcPath, pnpmConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { detectVersion, gte } from "../util/version.mjs";

export const name = "pnpm";
export const key = "minimum-release-age";
export const docs = "https://pnpm.io/settings#minimumreleaseage";
export const minBin = [10, 6, 0];
// pnpm >= 11 only reads pnpm-specific settings from the camelCase YAML config.
// We keep writing the kebab-case rc file for pnpm 10 and mirror every setting
// into config.yaml for pnpm 11+. `read()` switches files based on the detected
// major version so `--check` validates the config the running pnpm actually
// reads.
const yamlKey = "minimumReleaseAge";
// `defaultSinceMajor`: pnpm major version where the value became the default.
// Once detected, an absent line in the active config is still effectively in
// force, so `read()` reports it as ok with `defaultEnforced: true`.
export const extras = [
  { key: "trust-policy", yamlKey: "trustPolicy", expected: "no-downgrade", line: "trust-policy=no-downgrade", yamlLine: "trustPolicy: no-downgrade" },
  { key: "block-exotic-subdeps", yamlKey: "blockExoticSubdeps", expected: "true", line: "block-exotic-subdeps=true", yamlLine: "blockExoticSubdeps: true", defaultSinceMajor: 11 },
  { key: "strict-dep-builds", yamlKey: "strictDepBuilds", expected: "true", line: "strict-dep-builds=true", yamlLine: "strictDepBuilds: true" },
  { key: "verify-deps-before-run", yamlKey: "verifyDepsBeforeRun", expected: "error", line: "verify-deps-before-run=error", yamlLine: "verifyDepsBeforeRun: error" },
  { key: "minimum-release-age-strict", yamlKey: "minimumReleaseAgeStrict", expected: "true", line: "minimum-release-age-strict=true", yamlLine: "minimumReleaseAgeStrict: true" },
  { key: "dangerously-allow-all-builds", yamlKey: "dangerouslyAllowAllBuilds", expected: "false", line: "dangerously-allow-all-builds=false", yamlLine: "dangerouslyAllowAllBuilds: false" },
  { key: "trust-lockfile", yamlKey: "trustLockfile", expected: "false", line: "trust-lockfile=false", yamlLine: "trustLockfile: false" },
  { key: "minimum-release-age-ignore-missing-time", yamlKey: "minimumReleaseAgeIgnoreMissingTime", expected: "false", line: "minimum-release-age-ignore-missing-time=false", yamlLine: "minimumReleaseAgeIgnoreMissingTime: false" },
];

function yamlExtras() {
  return extras.map(e => ({
    key: e.yamlKey,
    expected: e.expected,
    line: e.yamlLine,
    sep: ":",
    ...(e.defaultSinceMajor ? { defaultSinceMajor: e.defaultSinceMajor } : {}),
  }));
}

export function path(ctx) { return pnpmRcPath(ctx.env, ctx.home, ctx.platform); }
export function configPath(ctx) { return pnpmConfigPath(ctx.env, ctx.home, ctx.platform); }

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

function activeConfig(ctx) {
  const v = pnpmVersion(ctx);
  if (v && v.major >= 11) {
    return { path: configPath(ctx), key: yamlKey, sep: ":", extras: yamlExtras() };
  }
  return { path: path(ctx), key, sep: "=", extras };
}

export function preflight(ctx) {
  const v = pnpmVersion(ctx);
  if (v === null) return { ok: true, message: null };
  if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
  return { ok: true, warn: true, version: v.raw, message: `pnpm ${v.raw} < ${minBin.join(".")}: minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown.` };
}

export async function read(ctx) {
  const active = activeConfig(ctx);
  const raw = await readSafe(active.path);
  const value = readKey(raw, active.key, { sep: active.sep });
  const minutes = value === null ? null : Number(value);
  const v = pnpmVersion(ctx);
  const defaults = new Map(active.extras.filter(x => x.defaultSinceMajor).map(x => [x.key, x.defaultSinceMajor]));
  const evaluated = readExtras(raw, active.extras).map(e => {
    const def = defaults.get(e.key);
    if (e.configured === null && def && v && v.major >= def) {
      return { ...e, ok: true, defaultEnforced: true };
    }
    return e;
  });
  return {
    path: active.path, key: active.key, configured: value,
    days: minutes === null || Number.isNaN(minutes) ? null : Math.floor(minutes / (60 * 24)),
    extras: evaluated
  };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key}=${days * 24 * 60}`);
  text = applyExtras(text, extras);
  await writeAtomic(p, text);

  const cp = configPath(ctx);
  let yaml = setKey(await readSafe(cp), yamlKey, `${yamlKey}: ${days * 24 * 60}`, { sep: ":" });
  yaml = applyExtras(yaml, yamlExtras());
  await writeAtomic(cp, yaml);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key);
  const ex = removeExtras(cooldown.text, extras);
  let removed = cooldown.removed || ex.removed;
  if (removed) await writeAtomic(p, ex.text);

  const cp = configPath(ctx);
  const yamlBefore = await readSafe(cp);
  const yamlCooldown = removeKey(yamlBefore, yamlKey, { sep: ":" });
  const yamlEx = removeExtras(yamlCooldown.text, yamlExtras());
  if (yamlCooldown.removed || yamlEx.removed) {
    removed = true;
    await writeAtomic(cp, yamlEx.text);
  }
  return { path: p, removed };
}
