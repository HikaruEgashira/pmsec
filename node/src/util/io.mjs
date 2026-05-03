import { mkdir, readFile, writeFile, rename, lstat, unlink, open } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

export async function readSafe(path) {
  try { return await readFile(path, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return ""; throw e; }
}

function isPermErr(e) { return e?.code === "EACCES" || e?.code === "EPERM"; }

async function isSymlink(p) {
  try { return (await lstat(p)).isSymbolicLink(); }
  catch { return false; }
}

function underHome(p, home) {
  const r = resolve(p);
  const h = resolve(home);
  return r === h || r.startsWith(h + sep);
}

function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

async function reclaim(path, home, err) {
  if (process.platform === "win32" || typeof process.getuid !== "function") return false;
  if (!existsSync(path)) return false;
  if (await isSymlink(path)) {
    err.write(`pmsec: refusing to chown symlink ${path}; remove or replace it manually.\n`);
    return false;
  }
  if (!underHome(path, home)) {
    err.write(`pmsec: refusing to chown ${path} outside HOME (${home}); fix ownership manually.\n`);
    return false;
  }
  err.write(`pmsec: ${path} not writable; running \`sudo chown -h $(id -u):$(id -g) ${shellQuote(path)}\`. You may be prompted for your password.\n`);
  const r = spawnSync("sudo", ["chown", "-h", `${process.getuid()}:${process.getgid()}`, path], { stdio: "inherit" });
  return r.status === 0;
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

export async function writeAtomic(path, text, { backup = true, home = homedir(), err = process.stderr } = {}) {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path) && await isSymlink(path)) {
    const e = new Error(`refusing to write through symlink ${path}`);
    e.code = "ELOOP";
    throw e;
  }
  if (backup && existsSync(path) && !existsSync(path + ".bak")) {
    try { await atomicReplace(path + ".bak", await readFile(path, "utf8")); }
    catch (e) {
      const target = existsSync(path + ".bak") ? path + ".bak" : path;
      if (!isPermErr(e) || !(await reclaim(target, home, err))) throw e;
      await atomicReplace(path + ".bak", await readFile(path, "utf8"));
    }
  }
  try { await atomicReplace(path, text); }
  catch (e) {
    if (!isPermErr(e) || !(await reclaim(path, home, err))) throw e;
    await atomicReplace(path, text);
  }
}
