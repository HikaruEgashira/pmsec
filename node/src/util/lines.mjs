const SECTION = /^\s*\[[^\]]+\]\s*$/;

function lineKey(line) {
  const m = line.match(/^\s*([A-Za-z0-9_.\-]+)\s*=/);
  return m ? m[1] : null;
}

function indexOfTopLevelKey(lines, key) {
  for (let i = 0; i < lines.length; i++) {
    if (SECTION.test(lines[i])) return -1;
    if (lineKey(lines[i]) === key) return i;
  }
  return -1;
}

function indexOfFirstSection(lines) {
  for (let i = 0; i < lines.length; i++) if (SECTION.test(lines[i])) return i;
  return -1;
}

export function readKey(text, key) {
  const lines = text.split(/\r?\n/);
  const i = indexOfTopLevelKey(lines, key);
  if (i < 0) return null;
  const m = lines[i].match(/^\s*[A-Za-z0-9_.\-]+\s*=\s*(.*?)\s*$/);
  return m ? m[1] : null;
}

export function setKey(text, key, valueLine) {
  const trailing = text.endsWith("\n") || text === "";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const idx = indexOfTopLevelKey(lines, key);
  if (idx >= 0) {
    lines[idx] = valueLine;
  } else {
    const sec = indexOfFirstSection(lines);
    if (sec < 0) lines.push(valueLine);
    else lines.splice(sec, 0, valueLine, "");
  }
  return lines.join("\n") + (trailing || lines.length ? "\n" : "");
}

export function removeKey(text, key) {
  const trailing = text.endsWith("\n");
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const idx = indexOfTopLevelKey(lines, key);
  if (idx < 0) return { text, removed: false };
  lines.splice(idx, 1);
  if (lines[idx] === "") lines.splice(idx, 1);
  const out = lines.join("\n") + (trailing && lines.length ? "\n" : "");
  return { text: out, removed: true };
}
