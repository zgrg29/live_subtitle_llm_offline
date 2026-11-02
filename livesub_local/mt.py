"""翻译适配器：千问 MT（HTTP）与离线 mock。

请求形状与参考项目 src/livesub/qwen_mt_http.py 保持一致：
POST <endpoint>，Bearer Key，messages 里放原文，translation_options 指定源/目标语言。
"""
from __future__ import annotations

import json

import httpx

from .config import LANGUAGE_NAMES, QwenConfig

MAX_RESPONSE_BYTES = 65536


class MTError(Exception):
    """稳定错误码；不携带供应商原始报文，避免把 Key 或内部信息带到前端。"""

    CODES = (
        "authentication",
        "rate_limited",
        "unavailable",
        "deadline_exceeded",
        "protocol_error",
        "unsupported",
    )

    def __init__(self, code: str):
        if code not in self.CODES:
            code = "protocol_error"
        self.code = code
        super().__init__(code)


class MockTranslator:
    """没有 Key 时的占位翻译：结果带明显标记，绝不冒充真实翻译。"""

    def __init__(self, note: str = "mock"):
        self.note = note

    async def translate(self, text: str, source_language: str, target_language: str) -> str:
        return f"［{self.note}·{target_language}］{text}"

    async def aclose(self) -> None:
        return None


class QwenTranslator:
    """一次调用翻一句；不重试（重试是上层的策略，本版直接丢弃该句）。"""

    def __init__(self, config: QwenConfig, *, transport: httpx.AsyncBaseTransport | None = None):
        if not config.api_key.strip():
            raise ValueError("千问 API Key 为空")
        self.config = config
        self._client = httpx.AsyncClient(
            timeout=config.timeout_s,
            transport=transport,
            follow_redirects=False,
        )

    @property
    def endpoint(self) -> str:
        return self.config.resolved_endpoint()

    async def translate(self, text: str, source_language: str, target_language: str) -> str:
        if (source_language not in LANGUAGE_NAMES or target_language not in LANGUAGE_NAMES
                or source_language == target_language):
            raise MTError("unsupported")
        body = {
            "model": self.config.model,
            "stream": False,
            "max_tokens": 512,
            "messages": [{"role": "user", "content": text}],
            "translation_options": {
                "source_lang": LANGUAGE_NAMES[source_language],
                "target_lang": LANGUAGE_NAMES[target_language],
            },
        }
        try:
            response = await self._client.post(
                self.config.resolved_endpoint(),
                json=body,
                headers={
                    "Authorization": "Bearer " + self.config.api_key,
                    "Accept": "application/json",
                },
            )
        except httpx.TimeoutException:
            raise MTError("deadline_exceeded") from None
        except httpx.HTTPError:
            raise MTError("unavailable") from None

        status = response.status_code
        if status in (401, 403):
            raise MTError("authentication")
        if status == 429:
            raise MTError("rate_limited")
        if status >= 500:
            raise MTError("unavailable")
        if status != 200:
            raise MTError("protocol_error")
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise MTError("protocol_error")

        try:
            raw = json.loads(response.content)
            choices = raw["choices"]
            if not isinstance(choices, list) or len(choices) != 1:
                raise MTError("protocol_error")
            message = choices[0]["message"]
            if message.get("role") != "assistant":
                raise MTError("protocol_error")
            translated = message["content"]
        except MTError:
            raise
        except (KeyError, TypeError, ValueError, AttributeError, UnicodeError):
            raise MTError("protocol_error") from None

        if not isinstance(translated, str):
            raise MTError("protocol_error")
        translated = translated.strip()
        if not translated or len(translated) > 2000:
            raise MTError("protocol_error")
        return translated

    async def aclose(self) -> None:
        await self._client.aclose()
