import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export async function readSafe(path) {
  try { return await readFile(path, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return ""; throw e; }
}

function isPermErr(e) { return e?.code === "EACCES" || e?.code === "EPERM"; }

function reclaim(path, err) {
  if (process.platform === "win32" || typeof process.getuid !== "function") return false;
  const target = existsSync(path) ? path : dirname(path);
  err.write(`pmsec: ${path} not writable; running \`sudo chown $(id -u):$(id -g) ${target}\`. You may be prompted for your password.\n`);
  const r = spawnSync("sudo", ["chown", `${process.getuid()}:${process.getgid()}`, target], { stdio: "inherit" });
  return r.status === 0;
}

export async function writeAtomic(path, text, { backup = true, err = process.stderr } = {}) {
  try { await mkdir(dirname(path), { recursive: true }); }
  catch (e) { if (!isPermErr(e) || !reclaim(dirname(path), err)) throw e; await mkdir(dirname(path), { recursive: true }); }
  if (backup && existsSync(path) && !existsSync(path + ".bak")) {
    try { await copyFile(path, path + ".bak"); }
    catch (e) { if (!isPermErr(e) || !reclaim(path + ".bak", err)) throw e; await copyFile(path, path + ".bak"); }
  }
  try { await writeFile(path, text, "utf8"); }
  catch (e) { if (!isPermErr(e) || !reclaim(path, err)) throw e; await writeFile(path, text, "utf8"); }
}
