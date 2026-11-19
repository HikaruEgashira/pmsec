import { mkdir, readFile, rename, lstat, unlink, open, realpath, stat, lchown, chmod } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
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

function currentEuid() {
  return typeof process.geteuid === "function" ? process.geteuid() : null;
}

function isWithin(p, root) {
  return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
}

// Under root, a user-planted symlinked directory (`~/.config -> /etc`) would
// make mkdir/rename act on the link target. Refuse when a path lexically
// inside the target home resolves physically outside it. Paths already outside
// the home (operator-set CARGO_HOME etc.) pass through unchanged. Mirrors
// bash _pmsec_root_dir_guard.
async function rootDirGuard(dir, home) {
  const lexHome = resolve(home);
  const lexDir = resolve(dir);
  if (!isWithin(lexDir, lexHome)) return;
  let homePhys;
  try { homePhys = await realpath(lexHome); } catch { return; }
  // The leaf may not exist yet; mkdir would follow a link at the deepest
  // existing ancestor, so resolve that one.
  let probe = lexDir;
  while (probe !== lexHome && probe !== dirname(probe)) {
    try { if ((await stat(probe)).isDirectory()) break; } catch {}
    probe = dirname(probe);
  }
  let dirPhys;
  try { dirPhys = await realpath(probe); } catch { return; }
  if (isWithin(dirPhys, homePhys)) return;
  const e = new Error(`refusing to write under ${dir}: it resolves to ${dirPhys}, outside ${homePhys}`);
  e.code = "ELOOP";
  e.path = dir;
  throw e;
}

// Hand the written file, its .bak and any dirs we created back to the home
// owner when running as root. lchown never follows a link. Mirrors bash
// _pmsec_handback: failures are warnings, not errors.
async function handback(home, paths, warn) {
  let owner;
  try { owner = await stat(home); } catch { return; }
  for (const p of paths) {
    try { await lchown(p, owner.uid, owner.gid); }
    catch (e) { warn(`pmsec: warning: chown ${owner.uid}:${owner.gid} ${p} failed (${e.code ?? e.message}); file may be unreadable for the user\n`); }
  }
}

async function createdDirs(dir) {
  // Returns the dirs mkdir -p would create, outermost first.
  const missing = [];
  let probe = resolve(dir);
  while (probe !== dirname(probe) && !existsSync(probe)) {
    missing.unshift(probe);
    probe = dirname(probe);
  }
  return missing;
}

// Permission errors propagate to the caller, which prints a chown hint. pmsec
// never escalates privileges itself: an unwritable config under HOME is an
// operator decision (or a symptom worth seeing), not something to sudo past.
// When already running as root with a target `home` (PMSEC_HOME), the guard
// and handback above keep the result owned by and confined to that home.
export async function writeAtomic(path, text, {
  backup = true,
  home = null,
  euid = currentEuid(),
  warn = s => process.stderr.write(s),
} = {}) {
  const asRoot = euid === 0 && !!home;
  const dir = dirname(path);
  if (asRoot) await rootDirGuard(dir, home);
  const created = asRoot ? await createdDirs(dir) : [];
  await mkdir(dir, { recursive: true });
  if (existsSync(path) && await isSymlink(path)) throw symlinkError("config", path);
  const fresh = !existsSync(path);
  const bak = path + ".bak";
  if (backup && existsSync(path) && !existsSync(bak)) {
    // A dangling symlink fails existsSync; rename() would replace the link
    // itself, but refuse anyway so a planted link is visible, not silently clobbered.
    if (await isSymlink(bak)) throw symlinkError("backup", bak);
    await atomicReplace(bak, await readFile(path, "utf8"));
  }
  await atomicReplace(path, text);
  if (!asRoot) return;
  // The temp file is created 600; a new file must stay readable post-chown.
  if (fresh) { try { await chmod(path, 0o644); } catch {} }
  const targets = [...created, path];
  if (existsSync(bak)) targets.push(bak);
  await handback(home, targets, warn);
}
