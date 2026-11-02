"""HTTP / WebSocket 路由的离线测试（注入假翻译器，不需要网络）。"""
from __future__ import annotations

import time
import unittest

from fastapi.testclient import TestClient

from livesub_local.config import Config
from livesub_local.mt import MTError
from livesub_local.server import create_app


class FakeTranslator:
    def __init__(self):
        self.calls: list[tuple[str, str, str]] = []
        self.closed = False

    async def translate(self, text: str, source_language: str, target_language: str) -> str:
        self.calls.append((text, source_language, target_language))
        return "译:" + text

    async def aclose(self) -> None:
        self.closed = True


class FailingTranslator(FakeTranslator):
    async def translate(self, text: str, source_language: str, target_language: str) -> str:
        raise MTError("rate_limited")


def wait_for(predicate, timeout: float = 3.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("等待超时")


class ServerTest(unittest.TestCase):
    def make_client(self, translator=None) -> TestClient:
        app = create_app(Config(), translator=translator or FakeTranslator(), engine="mock")
        return TestClient(app)

    def test_pages_and_health(self):
        client = self.make_client()
        with client:
            self.assertTrue(client.get("/api/health").json()["ok"])
            self.assertEqual(client.get("/").status_code, 200)
            self.assertIn("LiveSub Local", client.get("/studio").text)
            self.assertIn('id="stage"', client.get("/view").text)
            display = client.get("/api/display").json()
            self.assertEqual(display["pairs"], 3)
            self.assertEqual(display["position"], "bottom")
            self.assertEqual(client.get("/api/health").json()["engine"], "mock")

    def test_text_websocket_translates(self):
        translator = FakeTranslator()
        client = self.make_client(translator)
        with client:
            with client.websocket_connect("/v1/text?source=ja&targets=zh") as socket:
                ready = socket.receive_json()
                self.assertEqual(ready["type"], "ready")
                self.assertEqual(ready["source_language"], "ja")
                self.assertEqual(ready["targets"], ["zh"])

                socket.send_json({"type": "ping"})
                self.assertEqual(socket.receive_json()["type"], "pong")

                socket.send_json({"id": 1, "text": "おはよう", "final": True})

                hub = client.app.state.hub

                def translated() -> bool:
                    session = hub.session
                    if session is None:
                        return False
                    sentences = session.snapshot()["sentences"]
                    return bool(sentences) and sentences[0]["translations"].get("zh")

                wait_for(translated)
                sentences = hub.session.snapshot()["sentences"]
                self.assertEqual(sentences[0]["source"], "おはよう")
                self.assertEqual(sentences[0]["translations"]["zh"], "译:おはよう")
                self.assertEqual(translator.calls, [("おはよう", "ja", "zh")])

    def test_view_websocket_gets_initial_snapshot(self):
        client = self.make_client()
        with client:
            with client.websocket_connect("/v1/view") as socket:
                first = socket.receive_json()
                self.assertIn(first["type"], ("idle", "snapshot"))

    def test_translate_failure_does_not_break_session(self):
        client = self.make_client(FailingTranslator())
        with client:
            with client.websocket_connect("/v1/text?source=ja&targets=zh") as socket:
                socket.receive_json()
                socket.send_json({"id": 1, "text": "だめ", "final": True})
                hub = client.app.state.hub

                def failed() -> bool:
                    if hub.session is None:
                        return False
                    sentences = hub.session.snapshot()["sentences"]
                    return bool(sentences) and sentences[0]["errors"].get("zh")

                wait_for(failed)
                self.assertEqual(hub.session.snapshot()["sentences"][0]["errors"]["zh"], "rate_limited")

                # 连接仍然可用：还能继续收下一句
                socket.send_json({"id": 2, "text": "つぎ", "final": True})
                wait_for(lambda: hub.session is not None
                         and len(hub.session.snapshot()["sentences"]) == 2)

    def test_bad_language_is_rejected(self):
        client = self.make_client()
        with client:
            with client.websocket_connect("/v1/text?source=xx&targets=zh") as socket:
                message = socket.receive_json()
                self.assertEqual(message["type"], "error")

    def test_unknown_message_is_ignored(self):
        client = self.make_client()
        with client:
            with client.websocket_connect("/v1/text?source=ja&targets=zh") as socket:
                socket.receive_json()
                socket.send_json({"type": "whatever"})
                socket.send_json({"type": "ping"})
                self.assertEqual(socket.receive_json()["type"], "pong")


if __name__ == "__main__":
    unittest.main()
