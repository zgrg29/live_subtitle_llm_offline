"""本机 HTTP / WebSocket 服务。

对外只有两个 WebSocket：
  /v1/text   studio 上行（识别文字）
  /v1/view   OBS 下行（字幕快照）
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import (
    BROWSER_LANGUAGES,
    BUNDLE_ROOT,
    DEFAULT_API_PATH,
    LANGUAGE_CODES,
    LANGUAGE_LABELS,
    QWEN_ENDPOINTS,
    QWEN_REGIONS,
    Config,
    application_dir,
    load_config,
    normalize_display,
)
from .hub import Hub
from .mt import MockTranslator, QwenTranslator


def _static_dir() -> Path:
    if getattr(sys, "frozen", False):
        return BUNDLE_ROOT / "livesub_local" / "static"
    return Path(__file__).resolve().parent / "static"


STATIC_DIR = _static_dir()
log = logging.getLogger("livesub_local")

SETTINGS_NAME = "settings.json"


def _settings_path() -> Path:
    return application_dir() / SETTINGS_NAME


def _load_settings(config: Config, path: Path) -> dict:
    """settings.json > config.toml > 默认值。返回 {"display": {...}, "region": "cn"|"intl"}。"""
    settings = {"display": config.display.as_dict(), "region": config.qwen.region}
    if not path.exists():
        return settings
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.warning("settings.json 无法读取，改用 config.toml 的设置")
        return settings
    if not isinstance(raw, dict):
        return settings
    try:
        settings["display"] = normalize_display(raw.get("display", raw), settings["display"])
    except ValueError:
        pass
    if raw.get("region") in QWEN_REGIONS:
        settings["region"] = raw["region"]
    return settings


def _save_settings(settings: dict, path: Path) -> None:
    try:
        path.write_text(
            json.dumps(settings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        log.warning("设置保存失败（%s）", path)


def build_translator(config: Config, region: str | None = None):
    region = region or config.qwen.region
    if config.subtitle.engine == "mock":
        return MockTranslator(), "mock"
    qwen_config = config.qwen.with_region(region)
    if not qwen_config.api_key:
        return MockTranslator(), "mock"
    return QwenTranslator(qwen_config), "qwen"


def create_app(
    config: Config | None = None,
    *,
    translator=None,
    engine: str | None = None,
    settings_path: Path | None = None,
) -> FastAPI:
    if config is None:
        config = load_config()

    settings_file = Path(settings_path) if settings_path is not None else _settings_path()
    settings = _load_settings(config, settings_file)
    region = settings["region"]

    if translator is None:
        translator, engine = build_translator(config, region)
    elif engine is None:
        engine = "mock"

    display_state = settings["display"]

    hub = Hub(
        translator,
        config.subtitle.source_language,
        config.subtitle.target_languages,
        max_sentences=config.subtitle.max_sentences,
        min_interval_ms=config.subtitle.min_interval_ms,
        display=display_state,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            await hub.shutdown()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config = config
    app.state.hub = hub
    app.state.engine = engine
    app.state.region = region
    app.state.display = display_state
    app.state.settings = settings
    app.state.settings_file = settings_file
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    def page(name: str) -> FileResponse:
        return FileResponse(
            STATIC_DIR / name,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/")
    async def index():
        return RedirectResponse("/studio")

    @app.get("/studio")
    async def studio():
        return page("studio.html")

    @app.get("/view")
    async def view():
        return page("view.html")

    @app.get("/api/health")
    async def health():
        session = hub.session
        return {
            "ok": True,
            "engine": app.state.engine,
            "region": app.state.region,
            "model": config.qwen.model if app.state.engine == "qwen" else None,
            "session": session.session_id if session else None,
            "stats": session.stats if session else None,
        }

    @app.get("/api/engine")
    async def engine_info():
        qwen = config.qwen.with_region(app.state.region)
        return {
            "engine": app.state.engine,
            "region": app.state.region,
            "endpoint": qwen.resolved_endpoint(),
            "model": qwen.model,
            "has_key": bool(qwen.api_key),
            "regions": [
                {"code": code, "endpoint": url} for code, url in QWEN_ENDPOINTS.items()
            ],
        }

    @app.post("/api/engine")
    async def switch_engine(payload: dict = Body(...)):
        region = payload.get("region")
        if region not in QWEN_REGIONS:
            raise HTTPException(status_code=400, detail="region 只能是 cn / intl")
        if hub.session is not None:
            raise HTTPException(status_code=409, detail="配信中は変更できません")
        translator_new, engine_new = build_translator(config, region)
        await hub.set_translator(translator_new)
        app.state.engine = engine_new
        app.state.region = region
        app.state.settings["region"] = region
        _save_settings(app.state.settings, settings_file)
        return await engine_info()

    @app.post("/api/engine/test")
    async def test_engine(payload: dict = Body(default={})):
        source = payload.get("source") if isinstance(payload, dict) else None
        target = payload.get("target") if isinstance(payload, dict) else None
        try:
            sample = await hub.probe(source, target)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # MTError を含む
            return {"ok": False, "error": getattr(exc, "code", "unavailable")}
        return {"ok": True, "engine": app.state.engine, "sample": sample}

    @app.get("/api/display")
    async def display():
        return {
            **app.state.display,
            "source_language": config.subtitle.source_language,
            "target_languages": list(config.subtitle.target_languages),
        }

    @app.post("/api/display")
    async def update_display(patch: dict = Body(...)):
        try:
            merged = normalize_display(patch, app.state.display)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        app.state.display = merged
        hub.update_display(merged)
        app.state.settings["display"] = merged
        _save_settings(app.state.settings, settings_file)
        return {**merged, "ok": True}

    @app.post("/api/display/reset")
    async def reset_display():
        merged = dict(config.display.as_dict())
        app.state.display = merged
        hub.update_display(merged)
        app.state.settings["display"] = merged
        _save_settings(app.state.settings, settings_file)
        return {**merged, "ok": True}

    @app.get("/api/languages")
    async def languages():
        return {
            "languages": [
                {"code": code, "label": LANGUAGE_LABELS[code], "browser": BROWSER_LANGUAGES[code]}
                for code in LANGUAGE_CODES
            ],
        }

    @app.websocket("/v1/text")
    async def text_feed(socket_ws: WebSocket):
        await socket_ws.accept()
        params = socket_ws.query_params
        source = (params.get("source") or config.subtitle.source_language).strip().lower()
        raw_targets = params.get("targets") or ""
        targets = [item.strip().lower() for item in raw_targets.split(",") if item.strip()]
        if not targets:
            targets = list(config.subtitle.target_languages)

        try:
            session = await hub.start_session(source, targets)
        except ValueError as exc:
            await socket_ws.send_json({"type": "error", "message": str(exc)})
            await socket_ws.close(code=1008)
            return

        await socket_ws.send_json(
            {
                "type": "ready",
                "session": session.session_id,
                "engine": app.state.engine,
                "source_language": session.source_language,
                "targets": list(session.targets),
            }
        )
        log.info("session %s started (%s -> %s)", session.session_id, source, ",".join(targets))

        try:
            while True:
                raw = await socket_ws.receive_text()
                try:
                    message = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                if not isinstance(message, dict):
                    continue
                if message.get("type") == "ping":
                    await socket_ws.send_json({"type": "pong"})
                    continue
                if "text" not in message:
                    continue
                try:
                    sentence_id = message.get("id", 0)
                    session.ingest(sentence_id, message.get("text", ""), bool(message.get("final")))
                except Exception:
                    # 单条消息出错不能把整条连接打断。
                    log.warning("bad text message: %r", message, exc_info=True)
        except WebSocketDisconnect:
            pass
        finally:
            await hub.stop_session(session)
            log.info("session %s stopped", session.session_id)

    @app.websocket("/v1/view")
    async def view_feed(socket_ws: WebSocket):
        await socket_ws.accept()
        try:
            queue = hub.subscribe()
        except ValueError:
            await socket_ws.send_json({"type": "error", "message": "观看连接数已满"})
            await socket_ws.close(code=1013)
            return

        async def pump():
            try:
                while True:
                    payload = await queue.get()
                    await socket_ws.send_json(payload)
            except (WebSocketDisconnect, RuntimeError):
                return

        async def watch():
            # 只为感知断开；浏览器不会主动发消息。
            try:
                while True:
                    await socket_ws.receive_text()
            except (WebSocketDisconnect, RuntimeError):
                return

        sender = asyncio.create_task(pump())
        receiver = asyncio.create_task(watch())
        try:
            await receiver
        finally:
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
            hub.unsubscribe(queue)

    return app


def _port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((host, port))
        except OSError:
            return False
    return True


def _prepare_runtime_files() -> None:
    """exe 第一次运行时，把配置模板复制到 exe 旁边，用户直接改就行。"""
    if not getattr(sys, "frozen", False):
        return
    root = application_dir()
    for name in ("config", "api"):
        target = root / f"{name}.toml"
        template = BUNDLE_ROOT / f"{name}.example.toml"
        if not target.exists() and template.exists():
            shutil.copyfile(template, target)
            print(f"[情報] {target} を作成しました。")


def _setup_console() -> None:
    """Windows のコンソールで日本語が文字化けしないように UTF-8 に切り替える。"""
    if os.name != "nt":
        return
    try:
        import ctypes

        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except Exception:
        pass
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _wait_for_port(host: str, port: int, timeout: float = 25.0) -> bool:
    """原始 socket 探测端口（不走代理、不用 HTTP），确认服务真的在监听。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def _find_chromium() -> str | None:
    """优先用 Chrome/Edge 的 --new-window：比“在已有窗口里加后台标签”更容易看见。"""
    roots = (
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("LOCALAPPDATA"),
    )
    relatives = (
        os.path.join("Google", "Chrome", "Application", "chrome.exe"),
        os.path.join("Microsoft", "Edge", "Application", "msedge.exe"),
    )
    for root in roots:
        if not root:
            continue
        for relative in relatives:
            candidate = os.path.join(root, relative)
            if os.path.isfile(candidate):
                return candidate
    return None


def _launch_browser(url: str) -> str | None:
    """Windows 用 ShellExecute 系列打开默认浏览器；返回实际用到的方式。"""
    if os.name != "nt":
        try:
            return "webbrowser" if webbrowser.open_new_tab(url) else None
        except Exception:
            return None

    browser = _find_chromium()
    if browser:
        try:
            subprocess.Popen([browser, "--new-window", url], close_fds=True)
            return f"new window: {os.path.basename(browser)}"
        except OSError:
            pass

    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    # 1) rundll32 url.dll,FileProtocolHandler：参考 BiliGiftDrop 的做法，最接近资源管理器双击。
    try:
        subprocess.Popen(
            ["rundll32.exe", "url.dll,FileProtocolHandler", url],
            close_fds=True,
            creationflags=flags,
        )
        return "rundll32"
    except OSError:
        pass
    # 2) os.startfile
    try:
        os.startfile(url)  # type: ignore[attr-defined]
        return "os.startfile"
    except OSError:
        pass
    # 3) cmd /c start
    try:
        subprocess.Popen(
            ["cmd", "/c", "start", "", url], close_fds=True, creationflags=flags
        )
        return "cmd start"
    except OSError:
        pass
    return None


def _open_browser(host: str, port: int) -> None:
    """サーバーが待ち受けを始めてからブラウザを開く。"""
    url = f"http://{host}:{port}/studio"
    if not _wait_for_port(host, port):
        print(f"[情報] サーバーの起動を確認できませんでした。手動で開いてください: {url}")
        return
    method = _launch_browser(url)
    if method:
        print(f"[情報] ブラウザを開きました（{method}）: {url}")
    else:
        print(f"[情報] ブラウザを自動で開けませんでした。手動で開いてください: {url}")


def run(config: Config | None = None) -> int:
    _setup_console()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    if config is None:
        _prepare_runtime_files()
        try:
            config = load_config()
        except ValueError as exc:
            print(f"[エラー] 設定ファイルに問題があります: {exc}")
            print(f"         {DEFAULT_API_PATH} と config.toml の書き方を確認してください。")
            return 1

    host, port = config.server.host, config.server.port
    if not _port_available(host, port):
        print(f"[エラー] ポート {port} は使用中です。config.toml の [server].port を変えてください。")
        return 1

    if config.path is None or not config.path.exists():
        print(f"[情報] {config.path} が見つからないため、既定値で起動します。")

    engine = "qwen" if (config.subtitle.engine != "mock" and config.qwen.api_key) else "mock"
    region = config.qwen.region
    if engine == "mock":
        print(f"[情報] Qwen の API Key が読めません（{config.api_path or DEFAULT_API_PATH}）。")
        print("       mock モードで起動します。訳文はダミーです。")
        print("       このファイルをメモ帳で開き、qwen.api_key を入れてから再起動してください。")

    url = f"http://{host}:{port}"
    print("=" * 60)
    print(f"  LiveSub Local   {url}/studio")
    print(f"  OBS ブラウザ    {url}/view")
    print(f"  翻訳エンジン    {engine}（{region}）")
    print(f"  設定ファイル    {config.path}")
    print("  停止するには、この画面で Ctrl+C を押します。")
    print("=" * 60)

    if config.server.open_browser:
        print("[情報] 起動後にブラウザを自動で開きます（open_browser = true）。")
        threading.Thread(target=_open_browser, args=(host, port), daemon=True).start()
    else:
        print(f"[情報] open_browser = false のため自動では開きません: {url}/studio")

    app = create_app(config)
    try:
        uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(run())
