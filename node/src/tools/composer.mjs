import { composerConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readJsonKey, setJsonKey, removeJsonKey } from "../util/jsonconf.mjs";

export const name = "composer";
export const key = "minimum-release-age";
export const section = "config";
export const docs = "https://getcomposer.org/doc/06-config.md#minimum-release-age";
export const extras = [
  { key: "allow-plugins", expected: "false", line: "false", path: ["config", "allow-plugins"] },
  { key: "secure-http", expected: "true", line: "true", path: ["config", "secure-http"] },
  { key: "disable-tls", expected: "false", line: "false", path: ["config", "disable-tls"] },
  { key: "abandoned", expected: '"fail"', line: '"fail"', path: ["config", "audit", "abandoned"] },
];

// Composer is newer than most tools in the bundle; accept the shorter npm
// spelling too so a config written by hand is still recognized.
const PRIMARY_ALIASES = [key, "min-release-age", "minimum_release_age", "minimumReleaseAge"];

export function path(ctx) { return composerConfigPath(ctx.env, ctx.home, ctx.platform); }

function parseDays(value) {
  if (value === null) return null;
  const v = String(value).trim().replace(/^"|"$/g, "").trim();
  const dur = v.match(/^(\d+)\s*(d|days?|w|weeks?)$/i);
  if (dur) {
    const n = Number(dur[1]);
    return /^(w|weeks?)$/i.test(dur[2]) ? n * 7 : n;
  }
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  // Large values are seconds or minutes (the units Composer uses for its
  // other time settings); small values are days.
  if (n >= 86400) return Math.floor(n / 86400);
  if (n >= 1440 && n % 1440 === 0) return n / 1440;
  return n;
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  let configured = null;
  for (const candidate of PRIMARY_ALIASES) {
    const v = readJsonKey(raw, ["config", candidate]);
    if (v !== null) { configured = v; break; }
  }
  return {
    path: p, configured, days: parseDays(configured),
    extras: extras.map(e => {
      const cur = readJsonKey(raw, e.path);
      const safeValues = e.safeValues ?? [e.expected];
      return { key: e.key, configured: cur, expected: e.expected, ok: cur !== null && safeValues.includes(cur) };
    }),
  };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = await readSafe(p);
  text = setJsonKey(text, ["config", key], `${days}`);
  for (const e of extras) text = setJsonKey(text, e.path, e.line);
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  let text = await readSafe(p);
  let removed = false;
  for (const candidate of PRIMARY_ALIASES) {
    const r = removeJsonKey(text, ["config", candidate]);
    text = r.text;
    if (r.removed) removed = true;
  }
  for (const e of extras) {
    const r = removeJsonKey(text, e.path);
    text = r.text;
    if (r.removed) removed = true;
  }
  if (removed) await writeAtomic(p, text);
  return { path: p, removed };
}
