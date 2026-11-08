import { mkdir, readFile, rename, lstat, unlink, open, realpath, stat, lchown, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { existsSync, statSync } from "node:fs";
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

function isRoot() {
  return typeof process.geteuid === "function" && process.geteuid() === 0;
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function isUnder(p, root) {
  return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
}

// The topmost ancestor of `dir` that mkdir -p is about to create, so the
// handback only touches dirs pmsec made — never an existing user-owned dir.
function topMissing(dir, home) {
  if (isDir(dir)) return null;
  let top = dir;
  while (top !== dirname(top) && top !== home && !isDir(dirname(top))) top = dirname(top);
  return top;
}

// Under root, a user-planted symlinked directory (`~/.config -> /etc`) would
// make mkdir/rename act on the link target. Refuse when a path that is
// lexically inside the target home resolves physically outside it. Paths that
// are already outside the home (operator-set CARGO_HOME etc.) are the
// operator's choice and pass through unchanged.
export async function rootDirGuard(dir, home) {
  dir = resolve(dir);
  home = resolve(home);
  if (!isUnder(dir, home)) return;
  let homePhys;
  try { homePhys = await realpath(home); } catch { return; }
  // The leaf may not exist yet (mkdir -p creates it); resolve the deepest
  // existing ancestor, since that is where mkdir would follow a link.
  let probe = dir;
  while (!isDir(probe) && probe !== dirname(probe) && probe !== home) probe = dirname(probe);
  let dirPhys;
  try { dirPhys = await realpath(probe); } catch { return; }
  if (isUnder(dirPhys, homePhys)) return;
  const e = new Error(`refusing to write under ${dir}: it resolves to ${dirPhys}, outside ${homePhys}`);
  e.code = "EXDEV";
  e.path = dir;
  throw e;
}

async function lchownTree(p, uid, gid) {
  await lchown(p, uid, gid);
  const st = await lstat(p);
  if (!st.isDirectory()) return;
  for (const name of await readdir(p)) await lchownTree(join(p, name), uid, gid);
}

// Hand the freshly-written file (and dirs we created) back to the home owner.
// lchown never follows a link, so even a link swapped in after our own checks
// cannot redirect a root chown at a file outside the user's home. A failed
// chown is a warning, not an error: the config is in place, but the operator
// needs to fix ownership or the user cannot read it.
export async function handback(path, bak, topCreated, home, err = process.stderr) {
  let owner;
  try { owner = await stat(home); } catch { return; }
  if (!owner.isDirectory()) return;
  const { uid, gid } = owner;
  try { await lchown(path, uid, gid); }
  catch (e) { err.write(`pmsec: warning: chown ${uid} ${path} failed (${e.message}); file may be unreadable for the user\n`); }
  if (existsSync(bak)) {
    try { await lchown(bak, uid, gid); }
    catch (e) { err.write(`pmsec: warning: chown ${uid} ${bak} failed (${e.message})\n`); }
  }
  if (topCreated && isDir(topCreated)) {
    try { await lchownTree(topCreated, uid, gid); }
    catch (e) { err.write(`pmsec: warning: chown -R ${uid} ${topCreated} failed (${e.message})\n`); }
  }
}

// Permission errors propagate to the caller, which prints a chown hint. pmsec
// never escalates privileges itself: an unwritable config under HOME is an
// operator decision (or a symptom worth seeing), not something to sudo past.
// `home` is the target home (PMSEC_HOME or HOME); under root it enables the
// physical-path guard and the ownership handback.
export async function writeAtomic(path, text, { backup = true, home = null } = {}) {
  const dir = dirname(path);
  const asRoot = home !== null && isRoot();
  const topCreated = asRoot ? topMissing(resolve(dir), resolve(home)) : null;
  if (asRoot) await rootDirGuard(dir, home);
  await mkdir(dir, { recursive: true });
  if (existsSync(path) && await isSymlink(path)) throw symlinkError("config", path);
  const bak = path + ".bak";
  if (await isSymlink(bak)) throw symlinkError("backup", bak);
  if (asRoot) await rootDirGuard(dir, home);
  if (backup && existsSync(path) && !existsSync(bak)) {
    await atomicReplace(bak, await readFile(path, "utf8"));
  }
  await atomicReplace(path, text);
  if (asRoot) await handback(path, bak, topCreated, home);
}
