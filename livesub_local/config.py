"""配置读取与校验。

配置来自仓库根目录（或 exe 所在目录）的 config.toml 与 api.toml；
可用环境变量 LIVESUB_LOCAL_CONFIG / LIVESUB_LOCAL_API 指定其它路径。
文件不存在时全部使用默认值 —— 此时没有 API Key，会跑在 mock 模式。
"""
from __future__ import annotations

import os
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


def _frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def application_dir() -> Path:
    """运行目录：源码模式是仓库根目录，打包成 exe 后是 exe 所在目录。"""
    if _frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def bundle_dir() -> Path:
    """打包资源目录：PyInstaller 解包到的临时目录；源码模式与仓库根目录相同。"""
    if _frozen():
        return Path(getattr(sys, "_MEIPASS", application_dir()))
    return Path(__file__).resolve().parent.parent


PROJECT_ROOT = application_dir()
BUNDLE_ROOT = bundle_dir()
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.toml"
DEFAULT_API_PATH = PROJECT_ROOT / "api.toml"

# 千问 MT 接受的语言英文名（与参考项目 src/livesub/languages.py 的 MT_NAMES 一致）
LANGUAGE_NAMES = {
    "ja": "Japanese",
    "zh": "Chinese",
    "en": "English",
    "ko": "Korean",
}

# 浏览器语音识别用的 BCP-47 语言标记
BROWSER_LANGUAGES = {
    "ja": "ja-JP",
    "zh": "zh-CN",
    "en": "en-US",
    "ko": "ko-KR",
}

DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    open_browser: bool = True


@dataclass(frozen=True)
class QwenConfig:
    api_key: str = ""
    endpoint: str = DEFAULT_ENDPOINT
    model: str = "qwen-mt-flash"
    timeout_s: float = 10.0


@dataclass(frozen=True)
class SubtitleConfig:
    source_language: str = "ja"
    target_languages: tuple[str, ...] = ("zh",)
    max_sentences: int = 100
    min_interval_ms: int = 120
    engine: str = "auto"  # auto | qwen | mock


@dataclass(frozen=True)
class DisplayConfig:
    pairs: int = 3
    show_source: bool = True
    position: str = "bottom"
    source_size: int = 26
    target_size: int = 44
    outline_width: int = 4
    fade_ms: int = 160
    clear_after_ms: int = 6000


@dataclass(frozen=True)
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    qwen: QwenConfig = field(default_factory=QwenConfig)
    subtitle: SubtitleConfig = field(default_factory=SubtitleConfig)
    display: DisplayConfig = field(default_factory=DisplayConfig)
    path: Path | None = None
    api_path: Path | None = None

    def engine(self) -> str:
        """实际使用的翻译引擎：auto 时按有没有 Key 决定。"""
        if self.subtitle.engine == "auto":
            return "qwen" if self.qwen.api_key.strip() else "mock"
        return self.subtitle.engine


def _section(data: dict, name: str) -> dict:
    value = data.get(name, {})
    if not isinstance(value, dict):
        raise ValueError(f"[{name}] 必须是一个配置段")
    return value


def _text(section: dict, key: str, default: str) -> str:
    value = section.get(key, default)
    if not isinstance(value, str):
        raise ValueError(f"{key} 必须是字符串")
    return value


def _int(section: dict, key: str, default: int, low: int, high: int) -> int:
    value = section.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{key} 必须是整数")
    if not low <= value <= high:
        raise ValueError(f"{key} 必须在 {low}–{high} 之间")
    return value


def _bool(section: dict, key: str, default: bool) -> bool:
    value = section.get(key, default)
    if not isinstance(value, bool):
        raise ValueError(f"{key} 必须是 true / false")
    return value


def _validate_languages(source: str, targets: tuple[str, ...]) -> None:
    if source not in LANGUAGE_NAMES:
        raise ValueError(f"source_language 不支持：{source}（可选 {', '.join(LANGUAGE_NAMES)}）")
    if not targets:
        raise ValueError("target_languages 至少要有一个")
    if len(set(targets)) != len(targets):
        raise ValueError("target_languages 不能重复")
    for target in targets:
        if target not in LANGUAGE_NAMES:
            raise ValueError(f"target_languages 不支持：{target}")
        if target == source:
            raise ValueError("target_languages 不能和 source_language 相同")


def _read_toml(path: Path) -> dict:
    if not path.exists():
        return {}
    raw = path.read_bytes()
    # 记事本/PowerShell 可能写出 UTF-8 BOM，tomllib 不接受，这里先去掉。
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    return tomllib.loads(raw.decode("utf-8"))


def load_config(path: str | Path | None = None, api_path: str | Path | None = None) -> Config:
    env_path = os.environ.get("LIVESUB_LOCAL_CONFIG")
    config_path = Path(path or env_path) if (path or env_path) else DEFAULT_CONFIG_PATH
    env_api = os.environ.get("LIVESUB_LOCAL_API")
    api_file = Path(api_path or env_api) if (api_path or env_api) else DEFAULT_API_PATH

    data = _read_toml(config_path)
    api_data = _read_toml(api_file)

    server = _section(data, "server")
    # 密钥单独放在 api.toml；如果老配置把 [qwen] 写在 config.toml 里也认。
    qwen = _section(api_data, "qwen") if "qwen" in api_data else _section(data, "qwen")
    subtitle = _section(data, "subtitle")
    display = _section(data, "display")

    source = _text(subtitle, "source_language", "ja").strip().lower()
    raw_targets = subtitle.get("target_languages", ["zh"])
    if not isinstance(raw_targets, list) or not all(isinstance(item, str) for item in raw_targets):
        raise ValueError("target_languages 必须是字符串数组，例如 [\"zh\"]")
    targets = tuple(item.strip().lower() for item in raw_targets)
    _validate_languages(source, targets)

    api_key = _text(qwen, "api_key", "").strip()
    api_key = os.environ.get("QWEN_API_KEY", api_key).strip()
    engine = _text(subtitle, "engine", "auto").strip().lower()
    if engine not in ("auto", "qwen", "mock"):
        raise ValueError("engine 只能是 auto / qwen / mock")

    port_env = os.environ.get("LIVESUB_LOCAL_PORT")
    port = _int(server, "port", 8765, 1, 65535)
    if port_env:
        port = _int({"port": int(port_env)}, "port", port, 1, 65535)

    return Config(
        server=ServerConfig(
            host=_text(server, "host", "127.0.0.1"),
            port=port,
            open_browser=_bool(server, "open_browser", True),
        ),
        qwen=QwenConfig(
            api_key=api_key,
            endpoint=_text(qwen, "endpoint", DEFAULT_ENDPOINT).strip(),
            model=_text(qwen, "model", "qwen-mt-flash").strip(),
            timeout_s=float(qwen.get("timeout_s", 10.0)),
        ),
        subtitle=SubtitleConfig(
            source_language=source,
            target_languages=targets,
            max_sentences=_int(subtitle, "max_sentences", 100, 1, 1000),
            min_interval_ms=_int(subtitle, "min_interval_ms", 120, 0, 5000),
            engine=engine,
        ),
        display=DisplayConfig(
            pairs=_int(display, "pairs", 3, 1, 6),
            show_source=_bool(display, "show_source", True),
            position=_text(display, "position", "bottom").strip().lower(),
            source_size=_int(display, "source_size", 26, 8, 200),
            target_size=_int(display, "target_size", 44, 8, 200),
            outline_width=_int(display, "outline_width", 4, 0, 20),
            fade_ms=_int(display, "fade_ms", 160, 0, 5000),
            clear_after_ms=_int(display, "clear_after_ms", 6000, 0, 600000),
        ),
        path=config_path,
        api_path=api_file,
    )
