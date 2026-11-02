"""千问 MT 适配器的离线测试：请求形状、响应校验、错误码映射。"""
from __future__ import annotations

import json
import unittest

import httpx

from livesub_local.config import QwenConfig
from livesub_local.mt import MTError, MockTranslator, QwenTranslator


def make_translator(handler) -> QwenTranslator:
    return QwenTranslator(
        QwenConfig(api_key="sk-test-key", endpoint="https://example.invalid/chat/completions"),
        transport=httpx.MockTransport(handler),
    )


class QwenTranslatorTest(unittest.IsolatedAsyncioTestCase):
    async def test_request_shape_and_result(self):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={"choices": [{"message": {"role": "assistant", "content": " 你好 "}}]},
            )

        translator = make_translator(handler)
        try:
            result = await translator.translate("こんにちは", "ja", "zh")
        finally:
            await translator.aclose()

        self.assertEqual(result, "你好")
        self.assertEqual(captured["url"], "https://example.invalid/chat/completions")
        self.assertEqual(captured["auth"], "Bearer sk-test-key")
        body = captured["body"]
        self.assertEqual(body["model"], "qwen-mt-flash")
        self.assertFalse(body["stream"])
        self.assertEqual(body["messages"], [{"role": "user", "content": "こんにちは"}])
        self.assertEqual(
            body["translation_options"],
            {"source_lang": "Japanese", "target_lang": "Chinese"},
        )

    async def test_status_codes_map_to_codes(self):
        cases = {401: "authentication", 403: "authentication", 429: "rate_limited",
                 500: "unavailable", 400: "protocol_error"}
        for status, expected in cases.items():
            with self.subTest(status=status):
                translator = make_translator(lambda request, s=status: httpx.Response(s, json={}))
                try:
                    with self.assertRaises(MTError) as raised:
                        await translator.translate("テスト", "ja", "zh")
                finally:
                    await translator.aclose()
                self.assertEqual(raised.exception.code, expected)

    async def test_timeout_maps_to_deadline(self):
        def handler(request):
            raise httpx.ReadTimeout("timed out", request=request)

        translator = make_translator(handler)
        try:
            with self.assertRaises(MTError) as raised:
                await translator.translate("テスト", "ja", "zh")
        finally:
            await translator.aclose()
        self.assertEqual(raised.exception.code, "deadline_exceeded")

    async def test_broken_payload_is_protocol_error(self):
        payloads = [
            {},
            {"choices": []},
            {"choices": [{"message": {"role": "assistant", "content": ""}}]},
            {"choices": [{"message": {"role": "user", "content": "x"}}]},
            {"choices": [{"message": {"role": "assistant", "content": "   "}}]},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                translator = make_translator(lambda request, p=payload: httpx.Response(200, json=p))
                try:
                    with self.assertRaises(MTError) as raised:
                        await translator.translate("テスト", "ja", "zh")
                finally:
                    await translator.aclose()
                self.assertEqual(raised.exception.code, "protocol_error")

    async def test_same_language_is_unsupported(self):
        translator = make_translator(lambda request: httpx.Response(200, json={}))
        try:
            with self.assertRaises(MTError) as raised:
                await translator.translate("テスト", "ja", "ja")
        finally:
            await translator.aclose()
        self.assertEqual(raised.exception.code, "unsupported")


class MockTranslatorTest(unittest.IsolatedAsyncioTestCase):
    async def test_output_is_marked_as_mock(self):
        translator = MockTranslator()
        result = await translator.translate("こんにちは", "ja", "zh")
        self.assertIn("mock", result)
        self.assertIn("こんにちは", result)


if __name__ == "__main__":
    unittest.main()
