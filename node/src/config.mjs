// 配置读取与校验（从 Python 版 config.py 移植）。
// 配置来自 exe/仓库根目录的 config.toml 与 api.toml；环境变量可覆盖路径与 Key。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseToml } from "./toml.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function isSea() {
  try {
    // node:sea 在普通 Node 进程里也能加载，isSea() 返回 false。
    return process.env.NODE_SEA_BLOB !== undefined && process.env.LIVESUB_SEA === "1";
  } catch {
    return false;
  }
}

// exe 模式：资源解包目录由 SEA bootstrap 通过环境变量告诉我们。
export function appDir() {
  if (process.env.LIVESUB_APP_DIR) return process.env.LIVESUB_APP_DIR;
  if (isSea()) return path.dirname(process.execPath);
  return path.resolve(HERE, "..", "..");
}

export function bundleDir() {
  return process.env.LIVESUB_BUNDLE_DIR || appDir();
}

export const PROJECT_ROOT = appDir();
export const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "config.toml");
export const DEFAULT_API_PATH = path.join(PROJECT_ROOT, "api.toml");
// 页面资源：过渡期与 Python 版共用同一份 static/。
export const STATIC_DIR = process.env.LIVESUB_STATIC_DIR
  || path.join(PROJECT_ROOT, "livesub_local", "static");

export const DEFAULT_FONT_FAMILY =
  '"Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", "Microsoft YaHei", ' +
  "-apple-system, BlinkMacSystemFont, sans-serif";

// 可选语言 = 千问 MT 支持 ∩ Chrome Web Speech 能识别。与 Python 版保持一致。
export const LANGUAGES = [
  { code: "ja", mt: "Japanese", label: "日本語", browser: "ja-JP" },
  { code: "zh", mt: "Chinese", label: "中文", browser: "zh-CN" },
  { code: "en", mt: "English", label: "English", browser: "en-US" },
  { code: "ko", mt: "Korean", label: "한국어", browser: "ko-KR" },
  { code: "ar", mt: "Arabic", label: "العربية", browser: "ar-SA" },
  { code: "yue", mt: "Cantonese", label: "粵語", browser: "zh-HK" },
  { code: "cs", mt: "Czech", label: "Čeština", browser: "cs-CZ" },
  { code: "da", mt: "Danish", label: "Dansk", browser: "da-DK" },
  { code: "fi", mt: "Finnish", label: "Suomi", browser: "fi-FI" },
  { code: "fr", mt: "French", label: "Français", browser: "fr-FR" },
  { code: "de", mt: "German", label: "Deutsch", browser: "de-DE" },
  { code: "hi", mt: "Hindi", label: "हिन्दी", browser: "hi-IN" },
  { code: "is", mt: "Icelandic", label: "Íslenska", browser: "is-IS" },
  { code: "id", mt: "Indonesian", label: "Bahasa Indonesia", browser: "id-ID" },
  { code: "it", mt: "Italian", label: "Italiano", browser: "it-IT" },
  { code: "ms", mt: "Malay", label: "Bahasa Melayu", browser: "ms-MY" },
  { code: "pl", mt: "Polish", label: "Polski", browser: "pl-PL" },
  { code: "pt", mt: "Portuguese", label: "Português", browser: "pt-BR" },
  { code: "ru", mt: "Russian", label: "Русский", browser: "ru-RU" },
  { code: "es", mt: "Spanish", label: "Español", browser: "es-ES" },
  { code: "sv", mt: "Swedish", label: "Svenska", browser: "sv-SE" },
  { code: "th", mt: "Thai", label: "ไทย", browser: "th-TH" },
  { code: "tr", mt: "Turkish", label: "Türkçe", browser: "tr-TR" },
  { code: "uk", mt: "Ukrainian", label: "Українська", browser: "uk-UA" },
  { code: "vi", mt: "Vietnamese", label: "Tiếng Việt", browser: "vi-VN" },
];

export const LANGUAGE_NAMES = Object.fromEntries(LANGUAGES.map((item) => [item.code, item.mt]));
export const BROWSER_LANGUAGES = Object.fromEntries(LANGUAGES.map((item) => [item.code, item.browser]));
export const LANGUAGE_LABELS = Object.fromEntries(LANGUAGES.map((item) => [item.code, item.label]));
export const LANGUAGE_CODES = LANGUAGES.map((item) => item.code);

export const QWEN_ENDPOINTS = {
  cn: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  intl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
};
export const QWEN_REGIONS = ["cn", "intl"];

export const DISPLAY_DEFAULTS = Object.freeze({
  font_family: DEFAULT_FONT_FAMILY,
  target_size: 44,
  source_size: 26,
  target_color: "#ffffff",
  source_color: "#b9c6d4",
  outline_color: "#000000",
  outline_width: 4,
  background_color: "#000000",
  background_alpha: 0,
  position: "bottom",
  pairs: 2,
  order: "bottom",
  margin_percent: 8,
  line_gap: 10,
  clear_after_ms: 5000,
  fade_ms: 160,
  show_source: true,
});

const DISPLAY_INT_RANGES = {
  target_size: [12, 140],
  source_size: [10, 120],
  outline_width: [0, 12],
  background_alpha: [0, 100],
  pairs: [2, 6],
  margin_percent: [0, 45],
  line_gap: [0, 40],
  clear_after_ms: [0, 30000],
  fade_ms: [0, 2000],
};
const DISPLAY_COLORS = ["target_color", "source_color", "outline_color", "background_color"];
const DISPLAY_CHOICES = { position: ["bottom", "top"], order: ["bottom", "top"] };
const DISPLAY_BOOLS = ["show_source"];
const DISPLAY_TEXT_MAX = { font_family: 160 };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeDisplay(patch, base = DISPLAY_DEFAULTS) {
  const result = { ...base };
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("display 必须是对象");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key in DISPLAY_INT_RANGES) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} 必须是数字`);
      const [low, high] = DISPLAY_INT_RANGES[key];
      result[key] = Math.max(low, Math.min(high, Math.round(value)));
    } else if (DISPLAY_COLORS.includes(key)) {
      if (typeof value !== "string" || !COLOR_RE.test(value.trim())) throw new Error(`${key} 必须是 #rrggbb`);
      result[key] = value.trim().toLowerCase();
    } else if (key in DISPLAY_CHOICES) {
      if (!DISPLAY_CHOICES[key].includes(value)) {
        throw new Error(`${key} 只能是 ${DISPLAY_CHOICES[key].join(" / ")}`);
      }
      result[key] = value;
    } else if (DISPLAY_BOOLS.includes(key)) {
      if (typeof value !== "boolean") throw new Error(`${key} 必须是 true / false`);
      result[key] = value;
    } else if (key in DISPLAY_TEXT_MAX) {
      if (typeof value !== "string" || value.length > DISPLAY_TEXT_MAX[key]) {
        throw new Error(`${key} 必须是长度不超过 ${DISPLAY_TEXT_MAX[key]} 的字符串`);
      }
      result[key] = value.replace(/[^\P{C}]/gu, "").trim() || DEFAULT_FONT_FAMILY;
    } else {
      throw new Error(`未知的样式字段：${key}`);
    }
  }
  return result;
}

function readToml(file) {
  try {
    return parseToml(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function section(data, name) {
  const value = data[name] ?? {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`[${name}] 必须是一个配置段`);
  return value;
}

function text(source, key, fallback) {
  const value = source[key] ?? fallback;
  if (typeof value !== "string") throw new Error(`${key} 必须是字符串`);
  return value;
}

function integer(source, key, fallback, low, high) {
  const value = source[key] ?? fallback;
  if (!Number.isInteger(value)) throw new Error(`${key} 必须是整数`);
  if (value < low || value > high) throw new Error(`${key} 必须在 ${low}–${high} 之间`);
  return value;
}

function bool(source, key, fallback) {
  const value = source[key] ?? fallback;
  if (typeof value !== "boolean") throw new Error(`${key} 必须是 true / false`);
  return value;
}

export function loadConfig(configPath = null, apiPath = null) {
  const configFile = path.resolve(configPath || process.env.LIVESUB_LOCAL_CONFIG || DEFAULT_CONFIG_PATH);
  const apiFile = path.resolve(apiPath || process.env.LIVESUB_LOCAL_API || DEFAULT_API_PATH);
  const data = readToml(configFile);
  const apiData = readToml(apiFile);

  const server = section(data, "server");
  const qwen = "qwen" in apiData ? section(apiData, "qwen") : section(data, "qwen");
  const subtitle = section(data, "subtitle");
  const display = section(data, "display");

  const source = text(subtitle, "source_language", "ja").trim().toLowerCase();
  const rawTargets = subtitle.target_languages ?? ["zh"];
  if (!Array.isArray(rawTargets) || rawTargets.some((item) => typeof item !== "string")) {
    throw new Error('target_languages 必须是字符串数组，例如 ["zh"]');
  }
  const targets = rawTargets.map((item) => item.trim().toLowerCase());
  validateLanguages(source, targets);

  const engine = text(subtitle, "engine", "auto").trim().toLowerCase();
  if (!["auto", "qwen", "mock"].includes(engine)) throw new Error("engine 只能是 auto / qwen / mock");

  let region = text(qwen, "region", "cn").trim().toLowerCase();
  let endpoint = text(qwen, "endpoint", "").trim();
  for (const [code, url] of Object.entries(QWEN_ENDPOINTS)) {
    if (endpoint === url) { region = code; endpoint = ""; break; }
  }
  if (!QWEN_REGIONS.includes(region)) throw new Error("region 只能是 cn（中国大陆）/ intl（海外）");

  let apiKey = text(qwen, "api_key", "").trim();
  if (process.env.QWEN_API_KEY !== undefined) apiKey = process.env.QWEN_API_KEY.trim();

  let port = integer(server, "port", 8765, 1, 65535);
  if (process.env.LIVESUB_LOCAL_PORT) port = integer({ port: Number(process.env.LIVESUB_LOCAL_PORT) }, "port", port, 1, 65535);

  return {
    server: {
      host: text(server, "host", "127.0.0.1"),
      port,
      openBrowser: bool(server, "open_browser", true),
    },
    qwen: {
      apiKey,
      region,
      endpoint,
      model: text(qwen, "model", "qwen-mt-flash").trim(),
      timeoutS: typeof qwen.timeout_s === "number" ? qwen.timeout_s : 10,
    },
    subtitle: {
      sourceLanguage: source,
      targetLanguages: targets,
      maxSentences: integer(subtitle, "max_sentences", 100, 1, 1000),
      minIntervalMs: integer(subtitle, "min_interval_ms", 120, 0, 5000),
      engine,
    },
    display: normalizeDisplay(display, DISPLAY_DEFAULTS),
    path: configFile,
    apiPath: apiFile,
  };
}

function validateLanguages(source, targets) {
  if (!(source in LANGUAGE_NAMES)) {
    throw new Error(`source_language 不支持：${source}（可选 ${LANGUAGE_CODES.join(", ")}）`);
  }
  if (!targets.length) throw new Error("target_languages 至少要有一个");
  if (new Set(targets).size !== targets.length) throw new Error("target_languages 不能重复");
  for (const target of targets) {
    if (!(target in LANGUAGE_NAMES)) throw new Error(`target_languages 不支持：${target}`);
    if (target === source) throw new Error("target_languages 不能和 source_language 相同");
  }
}

export function resolvedEndpoint(qwen) {
  return (qwen.endpoint || "").trim() || QWEN_ENDPOINTS[qwen.region] || QWEN_ENDPOINTS.cn;
}

export function withRegion(qwen, region) {
  return { ...qwen, region, endpoint: "" };
}

export function effectiveEngine(config, region = config.qwen.region) {
  if (config.subtitle.engine === "mock") return "mock";
  return config.qwen.apiKey ? "qwen" : "mock";
}
