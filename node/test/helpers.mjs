// 测试共用工具：临时工作目录、启动真实 HTTP/WS 服务、消息队列。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { createApp } from "../src/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORK_ROOT = path.join(HERE, "_work");

export class FakeTranslator {
  constructor(failTexts = []) {
    this.calls = [];
    this.failTexts = new Set(failTexts);
    this.closed = false;
  }
  async translate(text, sourceLanguage, targetLanguage) {
    this.calls.push([text, sourceLanguage, targetLanguage]);
    if (this.failTexts.has(text)) {
      const error = new Error("unavailable");
      error.code = "unavailable";
      throw error;
    }
    return `译:${text}`;
  }
  async aclose() {
    this.closed = true;
  }
}

export async function startServer({ translator = null, engine = "mock" } = {}) {
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  const work = fs.mkdtempSync(path.join(WORK_ROOT, "case-"));
  const config = loadConfig(path.join(work, "config.toml"), path.join(work, "api.toml"));
  const app = createApp(config, {
    translator: translator || new FakeTranslator(),
    engine,
    settingsPath: path.join(work, "settings.json"),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  return {
    app,
    config,
    work,
    port,
    base: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
    async close() {
      await app.hub.shutdown();
      // 升级后的 WebSocket 不受 http.Server 管理，先自己断开，再关服务器。
      app.closeConnections?.();
      app.server.closeAllConnections?.();
      await new Promise((resolve) => app.server.close(resolve));
      fs.rmSync(work, { recursive: true, force: true });
    },
  };
}

export function messageQueue(socket) {
  const queue = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    if (waiters.length) waiters.shift()(value);
    else queue.push(value);
  });
  return {
    next(timeoutMs = 3000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("等待 WebSocket 消息超时")), timeoutMs);
        waiters.push((value) => { clearTimeout(timer); resolve(value); });
      });
    },
  };
}

export async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`WebSocket 连接失败：${url}`)), { once: true });
  });
  return socket;
}

export async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待条件超时");
}
