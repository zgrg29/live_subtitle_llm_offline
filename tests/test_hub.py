"""字幕会话状态机与翻译队列的离线测试（不需要网络、不需要浏览器）。"""
from __future__ import annotations

import asyncio
import unittest

from livesub_local.hub import Hub, Session
from livesub_local.mt import MTError


class FakeTranslator:
    def __init__(self, fail_texts: tuple[str, ...] = ()):
        self.calls: list[tuple[str, str, str]] = []
        self.fail_texts = set(fail_texts)
        self.closed = False

    async def translate(self, text: str, source_language: str, target_language: str) -> str:
        self.calls.append((text, source_language, target_language))
        if text in self.fail_texts:
            raise MTError("unavailable")
        return "译:" + text

    async def aclose(self) -> None:
        self.closed = True


async def wait_for(predicate, *, timeout: float = 2.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("等待超时")


class SessionTest(unittest.IsolatedAsyncioTestCase):
    async def test_partial_then_final_translates_once(self):
        translator = FakeTranslator()
        session = Session(translator, "ja", ("zh",), min_interval_ms=0)
        try:
            session.ingest("1", "こんにちは", False)
            session.ingest("1", "こんにちは、元気ですか", False)
            snapshot = session.snapshot()
            self.assertEqual(len(snapshot["sentences"]), 1)
            self.assertEqual(snapshot["sentences"][0]["source"], "こんにちは、元気ですか")
            self.assertEqual(snapshot["sentences"][0]["translations"], {})

            session.ingest("1", "こんにちは、元気ですか", True)
            await wait_for(lambda: session.snapshot()["sentences"][0]["translations"].get("zh"))
            self.assertEqual(
                session.snapshot()["sentences"][0]["translations"]["zh"],
                "译:こんにちは、元気ですか",
            )
            # 同一句重复定稿不应重复调用供应商
            session.ingest("1", "こんにちは、元気ですか", True)
            await asyncio.sleep(0.05)
            self.assertEqual(len(translator.calls), 1)
        finally:
            await session.aclose()

    async def test_partial_only_never_calls_translator(self):
        translator = FakeTranslator()
        session = Session(translator, "ja", ("zh",), min_interval_ms=0)
        try:
            for _ in range(3):
                session.ingest("1", "途中", False)
            await asyncio.sleep(0.05)
            self.assertEqual(translator.calls, [])
        finally:
            await session.aclose()

    async def test_failed_sentence_is_isolated(self):
        translator = FakeTranslator(fail_texts=("坏句子",))
        session = Session(translator, "ja", ("zh",), min_interval_ms=0)
        try:
            session.ingest("1", "坏句子", True)
            await wait_for(lambda: session.snapshot()["sentences"][0]["errors"].get("zh"))
            self.assertEqual(session.snapshot()["sentences"][0]["errors"]["zh"], "unavailable")
            self.assertEqual(session.snapshot()["sentences"][0]["translations"], {})

            session.ingest("2", "好句子", True)
            await wait_for(lambda: len(session.snapshot()["sentences"]) == 2
                           and session.snapshot()["sentences"][1]["translations"].get("zh"))
            self.assertEqual(session.snapshot()["sentences"][1]["translations"]["zh"], "译:好句子")
        finally:
            await session.aclose()

    async def test_sentences_are_bounded(self):
        translator = FakeTranslator()
        session = Session(translator, "ja", ("zh",), max_sentences=3, min_interval_ms=0)
        try:
            for index in range(6):
                session.ingest(str(index), f"句{index}", True)
            sentences = session.snapshot()["sentences"]
            self.assertEqual([item["id"] for item in sentences], ["3", "4", "5"])
        finally:
            await session.aclose()

    async def test_multi_target(self):
        translator = FakeTranslator()
        session = Session(translator, "ja", ("zh", "en"), min_interval_ms=0)
        try:
            session.ingest("1", "おはよう", True)
            await wait_for(lambda: len(session.snapshot()["sentences"][0]["translations"]) == 2)
            self.assertEqual(session.snapshot()["sentences"][0]["translations"]["zh"], "译:おはよう")
            self.assertEqual(session.snapshot()["sentences"][0]["translations"]["en"], "译:おはよう")
        finally:
            await session.aclose()


class HubTest(unittest.IsolatedAsyncioTestCase):
    async def test_viewer_gets_latest_snapshot(self):
        hub = Hub(FakeTranslator(), "ja", ("zh",), min_interval_ms=0)
        try:
            session = await hub.start_session()
            queue = hub.subscribe()
            first = queue.get_nowait()
            self.assertEqual(first["type"], "snapshot")
            self.assertEqual(first["sentences"], [])

            session.ingest("1", "やあ", True)
            await wait_for(lambda: not queue.empty())
            payload = queue.get_nowait()
            self.assertEqual(payload["sentences"][0]["source"], "やあ")
            hub.unsubscribe(queue)
        finally:
            await hub.shutdown()

    async def test_new_session_replaces_old(self):
        hub = Hub(FakeTranslator(), "ja", ("zh",), min_interval_ms=0)
        try:
            first_session = await hub.start_session()
            second_session = await hub.start_session("en", ["zh"])
            self.assertIsNot(first_session, second_session)
            self.assertIs(hub.session, second_session)
            self.assertTrue(first_session._closed)
        finally:
            await hub.shutdown()

    async def test_stop_session_keeps_new_session(self):
        hub = Hub(FakeTranslator(), "ja", ("zh",), min_interval_ms=0)
        try:
            first_session = await hub.start_session()
            second_session = await hub.start_session()
            await hub.stop_session(first_session)
            self.assertIs(hub.session, second_session)
        finally:
            await hub.shutdown()


if __name__ == "__main__":
    unittest.main()
