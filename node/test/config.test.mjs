import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeDisplay, DISPLAY_DEFAULTS } from "../src/config.mjs";
import { parseToml } from "../src/toml.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, "_work", `config-${process.pid}`);

function writeCase(name, configText, apiText = "") {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, "config.toml");
  const apiFile = path.join(dir, "api.toml");
  fs.writeFileSync(configFile, configText, "utf8");
  if (apiText) fs.writeFileSync(apiFile, apiText, "utf8");
  return { dir, configFile, apiFile };
}

test("defaults are usable", () => {
  const { dir } = writeCase("defaults", "");
  const config = loadConfig(path.join(dir, "missing.toml"), path.join(dir, "missing-api.toml"));
  assert.equal(config.server.port, 8765);
  assert.equal(config.subtitle.sourceLanguage, "ja");
  assert.deepEqual(config.subtitle.targetLanguages, ["zh"]);
  assert.equal(config.display.pairs, 2);
  assert.equal(config.display.position, "bottom");
  assert.equal(config.display.order, "bottom");
  assert.equal(config.subtitle.engine, "auto");
});

test("api file supplies key and region selects endpoint", () => {
  const { configFile, apiFile } = writeCase(
    "region",
    "[server]\nport = 9000\n",
    '[qwen]\napi_key = "sk-local"\nregion = "intl"\n',
  );
  const config = loadConfig(configFile, apiFile);
  assert.equal(config.qwen.apiKey, "sk-local");
  assert.equal(config.qwen.region, "intl");
  assert.match(config.qwen.endpoint, /^$/);
  assert.equal(config.server.port, 9000);
  assert.equal(config.path, configFile);
});

test("legacy endpoint falls back to region", () => {
  const { configFile, apiFile } = writeCase(
    "legacy",
    "",
    '[qwen]\nendpoint = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"\n',
  );
  const config = loadConfig(configFile, apiFile);
  assert.equal(config.qwen.region, "intl");
  assert.equal(config.qwen.endpoint, "");
});

test("unknown region rejected", () => {
  const { configFile, apiFile } = writeCase("badregion", "", '[qwen]\nregion = "us"\n');
  assert.throws(() => loadConfig(configFile, apiFile), /region/);
});

test("bad position rejected", () => {
  const { configFile, apiFile } = writeCase("badpos", '[display]\nposition = "middle"\n');
  assert.throws(() => loadConfig(configFile, apiFile), /position/);
});

test("display numbers are clamped", () => {
  const { configFile, apiFile } = writeCase("clamp", "[display]\npairs = 9\ntarget_size = 999\n");
  const config = loadConfig(configFile, apiFile);
  assert.equal(config.display.pairs, 6);
  assert.equal(config.display.target_size, 140);
});

test("same source and target rejected", () => {
  const { configFile, apiFile } = writeCase("sametarget", '[subtitle]\nsource_language = "ja"\ntarget_languages = ["ja"]\n');
  assert.throws(() => loadConfig(configFile, apiFile), /相同/);
});

test("toml parser keeps # inside strings and reads arrays", () => {
  const parsed = parseToml(
    'font = "#000000"\ntargets = ["zh", "en"]\nflag = true\nnum = 12\n[nested]\nkey = "v" # 注释\n',
  );
  assert.equal(parsed.font, "#000000");
  assert.deepEqual(parsed.targets, ["zh", "en"]);
  assert.equal(parsed.flag, true);
  assert.equal(parsed.num, 12);
  assert.equal(parsed.nested.key, "v");
});

test("normalizeDisplay rejects unknown fields", () => {
  assert.throws(() => normalizeDisplay({ nope: 1 }, DISPLAY_DEFAULTS), /未知的样式字段/);
});

test("normalizeDisplay accepts partial patch", () => {
  const merged = normalizeDisplay({ target_size: 88 }, DISPLAY_DEFAULTS);
  assert.equal(merged.target_size, 88);
  assert.equal(merged.pairs, DISPLAY_DEFAULTS.pairs);
});
