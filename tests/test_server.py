"""HTTP / WebSocket 路由的离线测试（注入假翻译器，不需要网络）。"""
from __future__ import annotations

import json
import shutil
import time
import unittest
import uuid
from pathlib import Path

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
    def setUp(self):
        self.work = Path(__file__).resolve().parent / "_work" / uuid.uuid4().hex
        self.work.mkdir(parents=True)
        self.settings = self.work / "settings.json"

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def make_client(self, translator=None) -> TestClient:
        app = create_app(
            Config(),
            translator=translator or FakeTranslator(),
            engine="mock",
            settings_path=self.settings,
        )
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
                self.assertIn("display", first)
                self.assertEqual(first["display"]["target_size"], 44)

    def test_display_update_is_clamped_and_persisted(self):
        client = self.make_client()
        with client:
            response = client.post(
                "/api/display",
                json={"target_size": 88, "position": "top", "pairs": 9, "order": "top"},
            )
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["target_size"], 88)
            self.assertEqual(data["pairs"], 6)          # 夹到上限
            self.assertEqual(data["position"], "top")

            saved = json.loads(self.settings.read_text(encoding="utf-8"))
            self.assertEqual(saved["display"]["target_size"], 88)

            with client.websocket_connect("/v1/view") as socket:
                first = socket.receive_json()
                self.assertEqual(first["display"]["target_size"], 88)

            reset = client.post("/api/display/reset").json()
            self.assertEqual(reset["target_size"], 44)

    def test_display_rejects_unknown_or_invalid(self):
        client = self.make_client()
        with client:
            self.assertEqual(client.post("/api/display", json={"nope": 1}).status_code, 400)
            self.assertEqual(client.post("/api/display", json={"target_size": "big"}).status_code, 400)
            self.assertEqual(client.post("/api/display", json={"target_color": "red"}).status_code, 400)

    def test_engine_info_and_region_switch(self):
        client = self.make_client()
        with client:
            info = client.get("/api/engine").json()
            self.assertEqual(info["engine"], "mock")
            self.assertEqual(info["region"], "cn")
            self.assertIn("dashscope.aliyuncs.com", info["endpoint"])

            response = client.post("/api/engine", json={"region": "intl"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["region"], "intl")
            self.assertIn("dashscope-intl", response.json()["endpoint"])

            saved = json.loads(self.settings.read_text(encoding="utf-8"))
            self.assertEqual(saved["region"], "intl")

            self.assertEqual(client.post("/api/engine", json={"region": "us"}).status_code, 400)

    def test_engine_test_endpoint(self):
        client = self.make_client()
        with client:
            result = client.post("/api/engine/test").json()
            self.assertTrue(result["ok"])
            self.assertEqual(result["engine"], "mock")
            self.assertIn("こんにちは", result["sample"])

    def test_region_switch_blocked_while_streaming(self):
        client = self.make_client()
        with client:
            with client.websocket_connect("/v1/text?source=ja&targets=zh") as socket:
                socket.receive_json()
                response = client.post("/api/engine", json={"region": "intl"})
                self.assertEqual(response.status_code, 409)

    def test_display_from_settings_file_wins(self):
        self.settings.write_text(
            json.dumps({"display": {"target_size": 70, "show_source": False}}),
            encoding="utf-8",
        )
        client = self.make_client()
        with client:
            display = client.get("/api/display").json()
            self.assertEqual(display["target_size"], 70)
            self.assertFalse(display["show_source"])

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
