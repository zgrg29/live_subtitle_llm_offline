// 极简 TOML 读取器：只支持本项目配置用到的语法
// （注释、[section]、key = "字符串" / 数字 / true|false / 字符串数组）。
// 目的是零依赖，不追求 TOML 1.0 全覆盖。
export function parseToml(text) {
  const root = {};
  let current = root;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      const name = line.slice(1, -1).trim();
      if (!name || name.includes("[")) throw new Error(`不支持的 TOML 段落：${line}`);
      current = root;
      for (const part of name.split(".")) {
        const key = part.trim();
        if (!current[key] || typeof current[key] !== "object") current[key] = {};
        current = current[key];
      }
      continue;
    }
    const eq = findEquals(line);
    if (eq < 0) throw new Error(`无法解析的 TOML 行：${line}`);
    const key = line.slice(0, eq).trim().replace(/^"|"$/g, "");
    const value = parseValue(line.slice(eq + 1).trim(), line);
    current[key] = value;
  }
  return root;
}

function stripComment(line) {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (ch === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

function findEquals(line) {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (ch === "=" && !inString) return i;
  }
  return -1;
}

function parseValue(text, line) {
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Error(`字符串没有结束：${line}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`字符串转义有误：${line}`);
    }
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new Error(`数组没有结束：${line}`);
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return splitArray(inner).map((item) => {
      const value = item.trim();
      if (!value.startsWith('"')) throw new Error(`数组只支持字符串：${line}`);
      try {
        return JSON.parse(value);
      } catch {
        throw new Error(`数组元素转义有误：${line}`);
      }
    });
  }
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`无法识别的值：${line}`);
  return number;
}

function splitArray(inner) {
  const parts = [];
  let current = "";
  let inString = false;
  let escaped = false;
  for (const ch of inner) {
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === "\\" && inString) { current += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; current += ch; continue; }
    if (ch === "," && !inString) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}
