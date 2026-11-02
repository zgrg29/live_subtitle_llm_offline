// 本机 HTTP / WebSocket 服务（从 Python 版 server.py 移植）。
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_LANGUAGES,
  DISPLAY_DEFAULTS,
  LANGUAGE_CODES,
  LANGUAGE_LABELS,
  QWEN_ENDPOINTS,
  QWEN_REGIONS,
  STATIC_DIR,
  appDir,
  normalizeDisplay,
  resolvedEndpoint,
  withRegion,
} from "./config.mjs";
import { Hub } from "./hub.mjs";
import { MockTranslator, QwenTranslator } from "./mt.mjs";
import { acceptWebSocket } from "./ws.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function buildTranslator(config, region) {
  if (config.subtitle.engine === "mock") return { translator: new MockTranslator(), engine: "mock" };
  const qwen = withRegion(config.qwen, region);
  if (!qwen.apiKey) return { translator: new MockTranslator(), engine: "mock" };
  return { translator: new QwenTranslator(qwen), engine: "qwen" };
}

function loadSettings(config, file) {
  const settings = { display: { ...config.display }, region: config.qwen.region };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return settings;
  }
  if (!raw || typeof raw !== "object") return settings;
  try {
    settings.display = normalizeDisplay(raw.display ?? raw, settings.display);
  } catch {
    // 文件被改坏了就退回 config.toml
  }
  if (QWEN_REGIONS.includes(raw.region)) settings.region = raw.region;
  return settings;
}

async function saveSettings(settings, file) {
  try {
    await fsp.writeFile(file, JSON.stringify(settings, null, 2), "utf8");
  } catch {
    console.warn(`[警告] 設定を保存できませんでした: ${file}`);
  }
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}

async function readJson(req, limit = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(res, urlPath) {
  const relative = urlPath.replace(/^\/static\//, "");
  const target = path.resolve(STATIC_DIR, relative);
  if (!target.startsWith(path.resolve(STATIC_DIR))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await fsp.readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

async function servePage(res, name) {
  try {
    const body = await fsp.readFile(path.join(STATIC_DIR, name));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(500).end("page missing");
  }
}

export function createApp(config, options = {}) {
  const settingsFile = options.settingsPath || path.join(appDir(), "settings.json");
  const settings = loadSettings(config, settingsFile);
  const built = options.translator
    ? { translator: options.translator, engine: options.engine || "mock" }
    : buildTranslator(config, settings.region);

  const state = {
    display: settings.display,
    region: settings.region,
    engine: built.engine,
  };

  const hub = new Hub({
    translator: built.translator,
    sourceLanguage: config.subtitle.sourceLanguage,
    targets: config.subtitle.targetLanguages,
    maxSentences: config.subtitle.maxSentences,
    minIntervalMs: config.subtitle.minIntervalMs,
    display: state.display,
  });

  // 升级后的 WebSocket 不再受 http.Server 管理，关闭服务时要自己断开。
  const wsConnections = new Set();
  function track(conn) {
    wsConnections.add(conn);
    return conn;
  }
  function closeConnections() {
    for (const conn of wsConnections) conn.destroy();
    wsConnections.clear();
  }

  function engineInfo() {
    const qwen = withRegion(config.qwen, state.region);
    return {
      engine: state.engine,
      region: state.region,
      endpoint: resolvedEndpoint(qwen),
      model: qwen.model,
      has_key: Boolean(qwen.apiKey),
      regions: QWEN_REGIONS.map((code) => ({ code, endpoint: QWEN_ENDPOINTS[code] })),
    };
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    const { pathname } = url;

    try {
      if (req.method === "GET") {
        if (pathname === "/") {
          res.writeHead(302, { Location: "/studio" }).end();
          return;
        }
        if (pathname === "/studio") return void (await servePage(res, "studio.html"));
        if (pathname === "/view") return void (await servePage(res, "view.html"));
        if (pathname.startsWith("/static/")) return void (await serveStatic(res, pathname));
        if (pathname === "/api/health") {
          const session = hub.session;
          json(res, 200, {
            ok: true,
            engine: state.engine,
            region: state.region,
            model: state.engine === "qwen" ? config.qwen.model : null,
            session: session ? session.id : null,
            stats: session ? session.stats : null,
          });
          return;
        }
        if (pathname === "/api/engine") return void json(res, 200, engineInfo());
        if (pathname === "/api/display") {
          json(res, 200, {
            ...state.display,
            source_language: config.subtitle.sourceLanguage,
            target_languages: [...config.subtitle.targetLanguages],
          });
          return;
        }
        if (pathname === "/api/languages") {
          json(res, 200, {
            languages: LANGUAGE_CODES.map((code) => ({
              code,
              label: LANGUAGE_LABELS[code],
              browser: BROWSER_LANGUAGES[code],
            })),
          });
          return;
        }
        res.writeHead(404).end("not found");
        return;
      }

      if (req.method === "POST") {
        if (pathname === "/api/display") {
          const patch = await readJson(req);
          let merged;
          try {
            merged = normalizeDisplay(patch, state.display);
          } catch (error) {
            return void json(res, 400, { detail: error.message });
          }
          state.display = merged;
          hub.updateDisplay(merged);
          settings.display = merged;
          await saveSettings(settings, settingsFile);
          return void json(res, 200, { ...merged, ok: true });
        }
        if (pathname === "/api/display/reset") {
          const merged = { ...DISPLAY_DEFAULTS };
          state.display = merged;
          hub.updateDisplay(merged);
          settings.display = merged;
          await saveSettings(settings, settingsFile);
          return void json(res, 200, { ...merged, ok: true });
        }
        if (pathname === "/api/engine") {
          const payload = await readJson(req);
          const region = payload.region;
          if (!QWEN_REGIONS.includes(region)) return void json(res, 400, { detail: "region 只能是 cn / intl" });
          if (hub.session) return void json(res, 409, { detail: "配信中は変更できません" });
          const next = buildTranslator(config, region);
          await hub.setTranslator(next.translator);
          state.engine = next.engine;
          state.region = region;
          settings.region = region;
          await saveSettings(settings, settingsFile);
          return void json(res, 200, engineInfo());
        }
        if (pathname === "/api/engine/test") {
          const payload = (await readJson(req)) || {};
          try {
            const sample = await hub.probe(payload.source, payload.target);
            return void json(res, 200, { ok: true, engine: state.engine, sample });
          } catch (error) {
            if (error && error.code) return void json(res, 200, { ok: false, error: error.code });
            return void json(res, 400, { detail: error.message });
          }
        }
        res.writeHead(404).end("not found");
        return;
      }

      res.writeHead(405).end("method not allowed");
    } catch (error) {
      res.writeHead(500).end("internal error");
    }
  });

  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname === "/v1/text") {
      let session = null;
      const conn = track(acceptWebSocket(req, socket, head, {
        onMessage: (raw) => {
          let message;
          try {
            message = JSON.parse(raw);
          } catch {
            return;
          }
          if (!message || typeof message !== "object") return;
          if (message.type === "ping") { conn.send(JSON.stringify({ type: "pong" })); return; }
          if (!("text" in message) || !session) return;
          session.ingest(message.id ?? 0, message.text, Boolean(message.final));
        },
        onClose: () => {
          wsConnections.delete(conn);
          if (session) hub.stopSession(session);
        },
      }));
      if (!conn) return;

      const source = (url.searchParams.get("source") || config.subtitle.sourceLanguage).trim().toLowerCase();
      let targets = (url.searchParams.get("targets") || "")
        .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
      if (!targets.length) targets = [...config.subtitle.targetLanguages];

      try {
        session = hub.startSession(source, targets);
      } catch (error) {
        conn.send(JSON.stringify({ type: "error", message: error.message }));
        conn.close(1008);
        return;
      }
      conn.send(JSON.stringify({
        type: "ready",
        session: session.id,
        engine: state.engine,
        source_language: session.sourceLanguage,
        targets: session.targets,
      }));
      return;
    }

    if (url.pathname === "/v1/view") {
      let unsubscribe = null;
      const conn = track(acceptWebSocket(req, socket, head, {
        onClose: () => {
          wsConnections.delete(conn);
          if (unsubscribe) unsubscribe();
        },
      }));
      if (!conn) return;
      try {
        unsubscribe = hub.subscribe((payload) => conn.send(JSON.stringify(payload)));
      } catch (error) {
        conn.send(JSON.stringify({ type: "error", message: error.message }));
        conn.close(1013);
      }
      return;
    }

    socket.destroy();
  });

  return { server, hub, state, settings, settingsFile, config, closeConnections };
}
