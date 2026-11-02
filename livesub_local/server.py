"""本机 HTTP / WebSocket 服务。

对外只有两个 WebSocket：
  /v1/text   studio 上行（识别文字）
  /v1/view   OBS 下行（字幕快照）
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import socket
import sys
import threading
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import (
    BROWSER_LANGUAGES,
    BUNDLE_ROOT,
    DEFAULT_API_PATH,
    LANGUAGE_NAMES,
    Config,
    application_dir,
    load_config,
)
from .hub import Hub
from .mt import MockTranslator, QwenTranslator


def _static_dir() -> Path:
    if getattr(sys, "frozen", False):
        return BUNDLE_ROOT / "livesub_local" / "static"
    return Path(__file__).resolve().parent / "static"


STATIC_DIR = _static_dir()
log = logging.getLogger("livesub_local")


def build_translator(config: Config):
    engine = config.engine()
    if engine == "qwen":
        return QwenTranslator(config.qwen), "qwen"
    return MockTranslator(), "mock"


def create_app(
    config: Config | None = None,
    *,
    translator=None,
    engine: str | None = None,
) -> FastAPI:
    if config is None:
        config = load_config()
    if translator is None:
        translator, engine = build_translator(config)
    elif engine is None:
        engine = "mock"

    hub = Hub(
        translator,
        config.subtitle.source_language,
        config.subtitle.target_languages,
        max_sentences=config.subtitle.max_sentences,
        min_interval_ms=config.subtitle.min_interval_ms,
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
            "engine": engine,
            "model": config.qwen.model if engine == "qwen" else None,
            "session": session.session_id if session else None,
            "stats": session.stats if session else None,
        }

    @app.get("/api/display")
    async def display():
        settings = config.display
        return {
            "pairs": settings.pairs,
            "show_source": settings.show_source,
            "position": settings.position,
            "source_size": settings.source_size,
            "target_size": settings.target_size,
            "outline_width": settings.outline_width,
            "fade_ms": settings.fade_ms,
            "clear_after_ms": settings.clear_after_ms,
            "source_language": config.subtitle.source_language,
            "target_languages": list(config.subtitle.target_languages),
        }

    @app.get("/api/languages")
    async def languages():
        return {
            "source": [
                {"code": code, "label": code, "browser": BROWSER_LANGUAGES[code]}
                for code in LANGUAGE_NAMES
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
                "engine": engine,
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
            while True:
                payload = await queue.get()
                await socket_ws.send_json(payload)

        async def watch():
            # 只为感知断开；浏览器不会主动发消息。
            while True:
                await socket_ws.receive_text()

        sender = asyncio.create_task(pump())
        receiver = asyncio.create_task(watch())
        try:
            await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in (sender, receiver):
                task.cancel()
            await asyncio.gather(sender, receiver, return_exceptions=True)
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
            print(f"[提示] 已生成 {target}")


def run(config: Config | None = None) -> int:
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
            print(f"[错误] 配置文件有问题：{exc}")
            print(f"       检查 {DEFAULT_API_PATH} 和 config.toml 的写法（错别字/漏引号都会导致这个错误）。")
            return 1

    host, port = config.server.host, config.server.port
    if not _port_available(host, port):
        print(f"[错误] 端口 {port} 已被占用。请修改 config.toml 里的 [server].port 后重试。")
        return 1

    if config.path is None or not config.path.exists():
        print(f"[提示] 没有找到 {config.path}，使用默认配置。")

    engine = config.engine()
    if engine == "mock":
        print(f"[提示] 没有读到千问 API Key（{config.api_path or DEFAULT_API_PATH}）。")
        print("       现在是 mock 模式，译文只是占位文字。")
        print("       用记事本打开上面这个文件，填好 qwen.api_key，关掉本窗口重新运行。")

    url = f"http://{host}:{port}"
    print("=" * 56)
    print(f"  LiveSub Local  {url}/studio")
    print(f"  OBS 浏览器源   {url}/view")
    print(f"  翻译引擎       {engine}")
    print("  停止服务：在这个窗口按 Ctrl+C")
    print("=" * 56)

    if config.server.open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url + "/studio")).start()

    app = create_app(config)
    try:
        uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(run())
