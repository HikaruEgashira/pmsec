import { uvConfigPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { buildPreflight } from "../util/version.mjs";

export const name = "uv";
export const key = "exclude-newer";
export const docs = "https://docs.astral.sh/uv/reference/settings/#exclude-newer";
// 0.9.17 added relative exclude-newer; the [audit] table only parses from 0.11.3
// (verified against released binaries: 0.11.2 rejects it, 0.11.3 accepts it).
export const minBin = [0, 11, 3];
export const extras = [
  { key: "index-strategy", expected: '"first-index"', line: 'index-strategy = "first-index"' },
  { key: "malware-check", expected: "true", line: "malware-check = true", section: "audit" },
];

export function path(ctx) { return uvConfigPath(ctx.env, ctx.home, ctx.platform); }

export const preflight = buildPreflight(name, minBin,
  "the written uv.toml (relative exclude-newer and the [audit] table) will not parse on this uv and every uv command will fail until you `uv self update`.");

function parseDays(value) {
  if (value === null) return null;
  const m = value.match(/^"\s*(\d+)\s*(day|days|d|week|weeks|w)\s*"$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(week|weeks|w)$/i.test(m[2]) ? n * 7 : n;
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  return { path: p, configured: value, days: parseDays(value), extras: readExtras(raw, extras) };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key} = "${days} days"`);
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
