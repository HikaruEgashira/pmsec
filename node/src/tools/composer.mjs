import { composerConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readJsonKey, setJsonKey, removeJsonKey } from "../util/jsonconf.mjs";
import { buildPreflight } from "../util/version.mjs";

export const name = "composer";
// Composer's cooldown lives under the unified policy block (Composer >= 2.11):
//   { "config": { "policy": { "cooldown": { "period": "7 days" } } } }
// `config.minimum-release-age` was never a Composer key; earlier pmsec
// releases wrote it and Composer silently ignored it. It is removed on write.
export const key = "policy.cooldown.period";
export const section = "config";
export const docs = "https://getcomposer.org/doc/06-config.md#policy";
export const minBin = [2, 11, 0];
const COOLDOWN_PATH = ["config", "policy", "cooldown", "period"];
export const extras = [
  { key: "allow-plugins", expected: "false", line: "false", path: ["config", "allow-plugins"] },
  { key: "secure-http", expected: "true", line: "true", path: ["config", "secure-http"] },
  { key: "disable-tls", expected: "false", line: "false", path: ["config", "disable-tls"] },
  { key: "abandoned", expected: '"fail"', line: '"fail"', path: ["config", "audit", "abandoned"] },
];

// Keys written by pmsec < 2026.11.5 that Composer never read.
const LEGACY_KEYS = ["minimum-release-age", "min-release-age", "minimum_release_age", "minimumReleaseAge"];

export function path(ctx) { return composerConfigPath(ctx.env, ctx.home, ctx.platform); }

export const preflight = buildPreflight(name, minBin,
  "config.policy.cooldown is silently ignored. Upgrade Composer to enforce the cooldown.");

// Composer: "<n> second|minute|hour|day|week[s]", or an integer number of
// seconds (a bare numeric string counts as seconds too). Partial days floor.
function parseDays(value) {
  if (value === null) return null;
  const v = String(value).trim().replace(/^"|"$/g, "").trim();
  const dur = v.match(/^(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?)$/i);
  if (dur) {
    const n = Number(dur[1]);
    const unit = dur[2].toLowerCase().replace(/s$/, "");
    const secs = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 }[unit];
    return Math.floor((n * secs) / 86400);
  }
  if (!/^\d+$/.test(v)) return null;
  return Math.floor(Number(v) / 86400);
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const configured = readJsonKey(raw, COOLDOWN_PATH);
  return {
    path: p, configured, days: parseDays(configured),
    extras: extras.map(e => {
      const cur = readJsonKey(raw, e.path);
      const safeValues = e.safeValues ?? [e.expected];
      return { key: e.key, configured: cur, expected: e.expected, ok: cur !== null && safeValues.includes(cur) };
    }),
  };
}

function dropLegacy(text) {
  let removed = false;
  for (const k of LEGACY_KEYS) {
    const r = removeJsonKey(text, ["config", k]);
    text = r.text;
    if (r.removed) removed = true;
  }
  return { text, removed };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = await readSafe(p);
  text = dropLegacy(text).text;
  text = setJsonKey(text, COOLDOWN_PATH, `"${days} days"`);
  for (const e of extras) text = setJsonKey(text, e.path, e.line);
  await writeAtomic(p, text, { home: ctx.home });
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  let text = await readSafe(p);
  let removed = false;
  const r0 = removeJsonKey(text, COOLDOWN_PATH);
  text = r0.text; removed = r0.removed;
  const r1 = dropLegacy(text);
  text = r1.text; removed = removed || r1.removed;
  for (const e of extras) {
    const r = removeJsonKey(text, e.path);
    text = r.text;
    if (r.removed) removed = true;
  }
  if (removed) await writeAtomic(p, text, { home: ctx.home });
  return { path: p, removed };
}
