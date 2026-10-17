// Minimal line-oriented JSON object editor.
//
// Composer stores its user config as JSON. Pulling in a full JSON round-trip
// would reorder/reformat unrelated keys (and the bash port has no JSON parser),
// so pmsec edits the pretty-printed object in place instead. Only the shapes
// pmsec needs are supported: objects of scalar members, one member per line.

function normalizeLines(lines) {
  const out = [];
  for (const line of lines) {
    let current = "", inString = false, escaped = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        current += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; current += ch; continue; }
      if (ch === "{" || ch === ",") {
        current += ch;
        if (line.slice(i + 1).trim() !== "") { out.push(current); current = ""; }
      } else if (ch === "}") {
        if (current.trim() !== "") { out.push(current); current = ""; }
        current += ch;
      } else {
        current += ch;
      }
    }
    if (current.trim() !== "" || out.length === 0) out.push(current);
  }
  return out;
}

function scanDepth(line, depth) {
  let inString = false, escaped = false;
  for (const ch of line) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

function depthMaps(lines) {
  const start = [], end = [];
  let depth = 0;
  for (const line of lines) {
    start.push(depth);
    depth = scanDepth(line, depth);
    end.push(depth);
  }
  return { start, end };
}

function rootRange(lines, dm) {
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("{")) { open = i; break; }
  }
  if (open < 0) return null;
  const base = dm.start[open];
  const close = dm.end[open] === base
    ? open
    : (() => {
        for (let i = open + 1; i < lines.length; i++) if (dm.end[i] === base) return i;
        return -1;
      })();
  if (close < 0) return null;
  return { open, close, start: open + 1, end: close, depth: base + 1 };
}

function findMember(lines, dm, range, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*"${escaped}"\\s*:`);
  for (let i = range.start; i < range.end; i++) {
    if (dm.start[i] === range.depth && re.test(lines[i])) return i;
  }
  return -1;
}

function objectRange(lines, dm, path) {
  let current = rootRange(lines, dm);
  if (!current) return null;
  for (const key of path) {
    const idx = findMember(lines, dm, current, key);
    if (idx < 0) return null;
    let open = -1;
    for (let i = idx; i < current.end; i++) {
      if (lines[i].includes("{")) { open = i; break; }
    }
    if (open < 0) return null;
    const base = dm.start[idx];
    let close = -1;
    if (dm.end[open] === base) close = open;
    else for (let i = open + 1; i < current.end; i++) if (dm.end[i] === base) { close = i; break; }
    if (close < 0) return null;
    current = { open, close, start: open + 1, end: close, depth: base + 1 };
  }
  return current;
}

function indent(level) { return "  ".repeat(level); }

function lastContentLine(lines, range) {
  for (let i = range.end - 1; i >= range.start; i--) {
    if (lines[i].trim() !== "") return i;
  }
  return -1;
}

function ensureComma(lines, range) {
  const last = lastContentLine(lines, range);
  if (last >= 0 && !/,\s*$/.test(lines[last])) lines[last] += ",";
}

function expandEmptyObject(lines, range) {
  if (range.open !== range.close) return lines;
  const line = lines[range.open];
  const openIdx = line.indexOf("{");
  const closeIdx = line.lastIndexOf("}");
  if (openIdx < 0 || closeIdx < openIdx) return lines;
  const head = line.slice(0, openIdx + 1);
  const tail = line.slice(closeIdx + 1);
  const level = range.depth - 1;
  lines[range.open] = head;
  lines.splice(range.open + 1, 0, `${indent(level)}}${tail}`);
  return lines;
}

function insertObject(lines, parent, key) {
  let dm = depthMaps(lines);
  let range = objectRange(lines, dm, parent);
  if (!range) return lines;
  if (range.open === range.close) {
    lines = expandEmptyObject(lines, range);
    dm = depthMaps(lines);
    range = objectRange(lines, dm, parent);
    if (!range) return lines;
  }
  ensureComma(lines, range);
  const level = range.depth;
  const memberIndent = indent(level);
  lines.splice(range.end, 0, `${memberIndent}"${key}": {`, `${memberIndent}}`);
  return lines;
}

function ensureObject(lines, path) {
  let dm = depthMaps(lines);
  if (objectRange(lines, dm, path)) return lines;
  if (path.length === 0) return ["{", "}"];
  lines = ensureObject(lines, path.slice(0, -1));
  lines = insertObject(lines, path.slice(0, -1), path[path.length - 1]);
  return lines;
}

function setKeyInRange(lines, range, key, value) {
  let dm = depthMaps(lines);
  let idx = findMember(lines, dm, range, key);
  const memberIndent = indent(range.depth);
  if (idx >= 0) {
    const m = lines[idx].match(/^(\s*"[^"]+"\s*:\s*)(.*?)(\s*,)?\s*$/);
    const comma = m && m[3] ? "," : "";
    lines[idx] = `${m ? m[1] : `${memberIndent}"${key}": `}${value}${comma}`;
    return lines;
  }
  if (range.open === range.close) {
    lines = expandEmptyObject(lines, range);
    dm = depthMaps(lines);
    range = { ...range, start: range.open + 1, end: range.open + 1, close: range.open + 1 };
  }
  ensureComma(lines, range);
  lines.splice(range.end, 0, `${memberIndent}"${key}": ${value}`);
  return lines;
}

export function readJsonKey(text, path) {
  const lines = normalizeLines((text || "").split(/\r?\n/));
  const dm = depthMaps(lines);
  const range = objectRange(lines, dm, path.slice(0, -1));
  if (!range) return null;
  const idx = findMember(lines, dm, range, path[path.length - 1]);
  if (idx < 0) return null;
  const m = lines[idx].match(/^\s*"[^"]+"\s*:\s*(.*?)\s*,?\s*$/);
  return m ? m[1] : null;
}

export function setJsonKey(text, path, value) {
  let lines = text === "" ? ["{", "}"] : normalizeLines(text.replace(/\r?\n$/, "").split(/\r?\n/));
  if (!rootRange(lines, depthMaps(lines))) lines = ["{", "}"];
  lines = ensureObject(lines, path.slice(0, -1));
  let dm = depthMaps(lines);
  const range = objectRange(lines, dm, path.slice(0, -1));
  if (!range) return text;
  lines = setKeyInRange(lines, range, path[path.length - 1], value);
  return lines.join("\n") + "\n";
}

export function removeJsonKey(text, path) {
  const lines = text === "" ? [] : normalizeLines(text.replace(/\r?\n$/, "").split(/\r?\n/));
  const dm = depthMaps(lines);
  const range = objectRange(lines, dm, path.slice(0, -1));
  if (!range) return { text, removed: false };
  const idx = findMember(lines, dm, range, path[path.length - 1]);
  if (idx < 0) return { text, removed: false };
  lines.splice(idx, 1);
  const dm2 = depthMaps(lines);
  const range2 = objectRange(lines, dm2, path.slice(0, -1));
  if (range2) {
    const hasLater = (() => {
      for (let i = idx; i < range2.end; i++) if (dm2.start[i] === range2.depth) return true;
      return false;
    })();
    if (!hasLater) {
      const prev = lastContentLine(lines, range2);
      if (prev >= 0) lines[prev] = lines[prev].replace(/,\s*$/, "");
    }
  }
  return { text: lines.join("\n") + (lines.length ? "\n" : ""), removed: true };
}
