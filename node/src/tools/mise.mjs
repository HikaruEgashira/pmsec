import { miseConfigPath, miseLayerPaths, miseSupportsNewMode } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { buildPreflight, detectVersion } from "../util/version.mjs";
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
  { key: "locked_verify_provenance", expected: "true", line: "locked_verify_provenance = true", section },
  { key: "ruby.github_attestations", expected: "true", line: "ruby.github_attestations = true", section },
  { key: "python.github_attestations", expected: "true", line: "python.github_attestations = true", section },
  { key: "provenance_api_failures_fatal", expected: "true", line: "provenance_api_failures_fatal = true", section },
  { key: "aqua.github_attestations", expected: "true", line: "aqua.github_attestations = true", section },
  { key: "aqua.cosign", expected: "true", line: "aqua.cosign = true", section },
  { key: "aqua.minisign", expected: "true", line: "aqua.minisign = true", section },
  { key: "aqua.slsa", expected: "true", line: "aqua.slsa = true", section },
  { key: "github.github_attestations", expected: "true", line: "github.github_attestations = true", section },
  { key: "github.slsa", expected: "true", line: "github.slsa = true", section },
  { key: "node.gpg_verify", expected: "true", line: "node.gpg_verify = true", section },
  { key: "swift.gpg_verify", expected: "true", line: "swift.gpg_verify = true", section },
  { key: "not_found_system_fallback", expected: "false", line: "not_found_system_fallback = false", section },
];

// New mode (#194): managed keys live in config.pmsec.toml, loaded through
// `env = ["pmsec"]` in miserc.local.toml, instead of the user's config.toml.
function newMode(ctx) {
  const v = detectVersion("mise", ["--version"], { env: ctx.env, overrideKey: "PMSEC_MISE_VERSION" });
  return miseSupportsNewMode(v, ctx.env);
}

function layers(ctx) { return miseLayerPaths(ctx.env, ctx.home, ctx.platform); }

export function path(ctx) {
  return newMode(ctx) ? layers(ctx).pmsecConfig : miseConfigPath(ctx.env, ctx.home, ctx.platform);
}

// Add "pmsec" to the top-level `env` of a miserc file, keeping other entries.
export function addMiseEnv(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break;
    const m = lines[i].match(/^(\s*env\s*=\s*)(\[[^\]]*\]|"[^"]*"|'[^']*')(.*)$/);
    if (!m) continue;
    const items = [...m[2].matchAll(/"([^"]*)"|'([^']*)'/g)].map(x => x[1] ?? x[2]);
    if (items.includes("pmsec")) return text;
    items.push("pmsec");
    lines[i] = `${m[1]}[${items.map(x => JSON.stringify(x)).join(", ")}]${m[3]}`;
    return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
  }
  return setKey(text, "env", 'env = ["pmsec"]', {});
}

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

function readLayer(raw) {
  const value = readKey(raw, key, { section });
  return { configured: value, days: parseDays(value), extras: readExtras(raw, extras) };
}

function stripManaged(text) {
  const cooldown = removeKey(text, key, { section });
  const ex = removeExtras(cooldown.text, extras);
  return { text: ex.text, removed: cooldown.removed || ex.removed };
}

export async function read(ctx) {
  const p = path(ctx);
  const cur = readLayer(await readSafe(p));
  if (!newMode(ctx)) return { path: p, ...cur };
  // Before migration the managed keys still sit in config.toml; report the
  // strictest cooldown so enable carries it into config.pmsec.toml.
  const old = readLayer(await readSafe(layers(ctx).baseConfig));
  const useOld = old.days !== null && (cur.days === null || old.days > cur.days);
  const merged = cur.extras.map((e, i) => (e.configured === null ? old.extras[i] : e));
  return { path: p, configured: useOld ? old.configured : cur.configured,
    days: useOld ? old.days : cur.days, extras: merged };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key} = "${days}d"`, { section });
  text = applyExtras(text, extras, ctx);
  await writeAtomic(p, text, { home: ctx.home });
  if (newMode(ctx)) {
    const l = layers(ctx);
    const rc = await readSafe(l.localMiserc);
    const nextRc = addMiseEnv(rc);
    if (nextRc !== rc) await writeAtomic(l.localMiserc, nextRc, { home: ctx.home });
    const base = stripManaged(await readSafe(l.baseConfig));
    if (base.removed) await writeAtomic(l.baseConfig, base.text, { home: ctx.home });
  }
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const r = stripManaged(await readSafe(p));
  if (r.removed) await writeAtomic(p, r.text, { home: ctx.home });
  let removed = r.removed;
  if (newMode(ctx)) {
    const base = layers(ctx).baseConfig;
    const b = stripManaged(await readSafe(base));
    if (b.removed) await writeAtomic(base, b.text, { home: ctx.home });
    removed = removed || b.removed;
  }
  return { path: p, removed };
}
