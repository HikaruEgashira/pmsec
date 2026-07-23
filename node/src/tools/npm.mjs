import { npmrcPath } from "../util/paths.mjs";
import { readSafe, writeAtomic } from "../util/io.mjs";
import { readKey, setKey, removeKey } from "../util/lines.mjs";
import { readExtras, applyExtras, removeExtras } from "../util/extras.mjs";
import { buildPreflight } from "../util/version.mjs";

export const name = "npm";
export const key = "min-release-age";
export const docs = "https://docs.npmjs.com/cli/v11/using-npm/config#min-release-age";
export const minBin = [11, 10, 0];
export const extras = [
  { key: "audit-level", expected: "high", line: "audit-level=high" },
  { key: "allow-git", expected: "root", line: "allow-git=root", safeValues: ["none", "root"] },
  { key: "allow-remote", expected: "root", line: "allow-remote=root", safeValues: ["none", "root"] },
  { key: "allow-file", expected: "root", line: "allow-file=root", safeValues: ["none", "root"] },
  { key: "allow-directory", expected: "root", line: "allow-directory=root", safeValues: ["none", "root"] },
  { key: "strict-allow-scripts", expected: "true", line: "strict-allow-scripts=true" },
  { key: "dangerously-allow-all-scripts", expected: "false", line: "dangerously-allow-all-scripts=false" },
];

export function path(ctx) { return npmrcPath(ctx.env, ctx.home); }

export const preflight = buildPreflight(name, minBin,
  "min-release-age is silently ignored. Upgrade npm to enforce the cooldown.");

export async function read(ctx) {
  const p = path(ctx);
  const raw = await readSafe(p);
  const value = readKey(raw, key);
  return {
    path: p, configured: value,
    days: value === null ? null : Number(value),
    extras: readExtras(raw, extras)
  };
}

export async function write(days, ctx) {
  const p = path(ctx);
  let text = setKey(await readSafe(p), key, `${key}=${days}`);
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
