import { yarnrcPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { buildPreflight } from "../util/version.mjs";

export const name = "yarn";
export const key = "npmMinimalAgeGate";
export const docs = "https://yarnpkg.com/configuration/yarnrc#npmMinimalAgeGate";
export const minBin = [4, 10, 0];
const SEP = ":";
export const extras = [
  { key: "enableHardenedMode", expected: "true", line: "enableHardenedMode: true", sep: SEP },
  { key: "enableScripts", expected: "false", line: "enableScripts: false", sep: SEP },
  { key: "approvedGitRepositories", expected: "[]", line: "approvedGitRepositories: []", sep: SEP },
];

export function path(ctx) { return yarnrcPath(ctx.env, ctx.home); }

export const preflight = buildPreflight(name, minBin,
  "npmMinimalAgeGate is silently ignored. Upgrade yarn (v4.10+) to enforce the cooldown.");

// yarn 4.10.x mis-parsed the `d` suffix (yarnpkg/berry#6991); a bare number is
// minutes on every 4.10+, so write minutes and read bare numbers as minutes.
function parseDays(value) {
  if (value === null) return null;
  const mins = value.match(/^"?\s*(\d+)\s*"?$/);
  if (mins) return Math.floor(Number(mins[1]) / (60 * 24));
  const m = value.match(/^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(w|weeks?)$/i.test(m[2]) ? n * 7 : n;
}

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key, { sep: SEP });
  return {
    path: p, configured: value, days: parseDays(value),
    extras: readExtras(raw, extras)
  };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key}: ${days * 24 * 60}`, { sep: SEP });
  text = applyExtras(text, extras);
  await writeAtomic(p, text);
  return { path: p };
}

export async function unset(ctx) {
  const p = path(ctx);
  const before = await readSafe(p);
  const cooldown = removeKey(before, key, { sep: SEP });
  const ex = removeExtras(cooldown.text, extras);
  const removed = cooldown.removed || ex.removed;
  if (removed) await writeAtomic(p, ex.text);
  return { path: p, removed };
}
