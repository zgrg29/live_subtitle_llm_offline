// 启动入口：日语横幅、端口检查、自动开浏览器。
import net from "node:net";
import { spawn } from "node:child_process";
import { DEFAULT_API_PATH, appDir, loadConfig } from "./config.mjs";
import { createApp } from "./server.mjs";

function portAvailable(host, port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

function waitForPort(host, port, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function launchBrowser(url) {
  const candidates = process.platform === "win32"
    ? [
        ["rundll32.exe", ["url.dll,FileProtocolHandler", url]],
        ["cmd.exe", ["/c", "start", "", url]],
      ]
    : [["xdg-open", [url]]];
  for (const [command, args] of candidates) {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      return command.replace(/\.exe$/, "");
    } catch {
      // 下一个
    }
  }
  return null;
}

async function openBrowser(host, port) {
  const url = `http://${host}:${port}/studio`;
  const ready = await waitForPort(host, port);
  if (!ready) {
    console.log(`[情報] サーバーの起動を確認できませんでした。手動で開いてください: ${url}`);
    return;
  }
  const method = launchBrowser(url);
  if (method) console.log(`[情報] ブラウザを開きました（${method}）: ${url}`);
  else console.log(`[情報] ブラウザを自動で開けませんでした。手動で開いてください: ${url}`);
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.log(`[エラー] 設定ファイルに問題があります: ${error.message}`);
    console.log(`         ${DEFAULT_API_PATH} と config.toml の書き方を確認してください。`);
    process.exitCode = 1;
    return;
  }

  const { host, port, openBrowser: autoOpen } = config.server;
  if (!(await portAvailable(host, port))) {
    console.log(`[エラー] ポート ${port} は使用中です。config.toml の [server].port を変えてください。`);
    process.exitCode = 1;
    return;
  }

  const app = createApp(config);
  const engine = app.state.engine;
  const region = app.state.region;

  if (!config.qwen.apiKey) {
    console.log(`[情報] Qwen の API Key が読めません（${config.apiPath || DEFAULT_API_PATH}）。`);
    console.log("       mock モードで起動します。訳文はダミーです。");
    console.log("       このファイルをメモ帳で開き、qwen.api_key を入れてから再起動してください。");
  }

  const url = `http://${host}:${port}`;
  console.log("=".repeat(60));
  console.log(`  LiveSub Local   ${url}/studio`);
  console.log(`  OBS ブラウザ    ${url}/view`);
  console.log(`  翻訳エンジン    ${engine}（${region}）`);
  console.log(`  設定ファイル    ${config.path}`);
  console.log("  停止するには、この画面で Ctrl+C を押します。");
  console.log("=".repeat(60));

  if (autoOpen) {
    console.log("[情報] 起動後にブラウザを自動で開きます（open_browser = true）。");
    openBrowser(host, port).catch(() => {});
  } else {
    console.log(`[情報] open_browser = false のため自動では開きません: ${url}/studio`);
  }

  app.server.listen(port, host, () => {
    console.log(`[情報] 待ち受け開始 ${url}`);
  });

  app.server.on("error", (error) => {
    console.log(`[エラー] ${error.message}`);
    process.exitCode = 1;
  });

  const shutdown = async () => {
    console.log("\n[情報] 停止します…");
    await app.hub.shutdown();
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { appDir };

main();
