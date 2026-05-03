import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

export async function readSafe(path) {
  try { return await readFile(path, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return ""; throw e; }
}

export async function writeAtomic(path, text, { backup = true } = {}) {
  await mkdir(dirname(path), { recursive: true });
  if (backup && existsSync(path) && !existsSync(path + ".bak")) await copyFile(path, path + ".bak");
  await writeFile(path, text, "utf8");
}
