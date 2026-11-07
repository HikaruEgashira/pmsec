import { mkdir, readFile, rename, lstat, unlink, open } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

export async function readSafe(path) {
  // Editors on Windows may prepend a BOM; it would hide the first header or key.
  try { return (await readFile(path, "utf8")).replace(/^﻿/, ""); }
  catch (e) { if (e.code === "ENOENT") return ""; throw e; }
}

async function isSymlink(p) {
  try { return (await lstat(p)).isSymbolicLink(); }
  catch { return false; }
}

export function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function symlinkError(what, p) {
  const e = new Error(`refusing to write ${what} through symlink ${p}`);
  e.code = "ELOOP";
  e.path = p;
  return e;
}

async function atomicReplace(path, text) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  let fh;
  try {
    fh = await open(tmp, "wx", 0o600);
    await fh.writeFile(text, "utf8");
    try { await fh.sync(); } catch {}
    await fh.close();
    fh = null;
    await rename(tmp, path);
  } catch (e) {
    if (fh) { try { await fh.close(); } catch {} }
    try { await unlink(tmp); } catch {}
    throw e;
  }
}

// Permission errors propagate to the caller, which prints a chown hint. pmsec
// never escalates privileges itself: an unwritable config under HOME is an
// operator decision (or a symptom worth seeing), not something to sudo past.
export async function writeAtomic(path, text, { backup = true } = {}) {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path) && await isSymlink(path)) throw symlinkError("config", path);
  const bak = path + ".bak";
  if (backup && existsSync(path) && !existsSync(bak)) {
    // A dangling symlink fails existsSync; rename() would replace the link
    // itself, but refuse anyway so a planted link is visible, not silently clobbered.
    if (await isSymlink(bak)) throw symlinkError("backup", bak);
    await atomicReplace(bak, await readFile(path, "utf8"));
  }
  await atomicReplace(path, text);
}
