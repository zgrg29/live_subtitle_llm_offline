"""配置读取的离线测试，重点是「Key 只在 api.toml 里」。"""
from __future__ import annotations

import shutil
import unittest
import uuid
from pathlib import Path

from livesub_local.config import load_config


class ConfigTest(unittest.TestCase):
    def setUp(self):
        # 不用 tempfile：这个工作区的临时目录权限被沙箱限制，测试目录放在 tests/_work 下。
        self.root = Path(__file__).resolve().parent / "_work" / uuid.uuid4().hex
        self.root.mkdir(parents=True)
        self.api = self.root / "api.toml"
        self.config = self.root / "config.toml"
        self.config.write_text("[server]\nport = 9000\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_api_file_supplies_key(self):
        self.api.write_text(
            '[qwen]\napi_key = "sk-local-test"\nendpoint = "https://example.invalid/x"\n',
            encoding="utf-8",
        )
        loaded = load_config(path=self.config, api_path=self.api)
        self.assertEqual(loaded.qwen.api_key, "sk-local-test")
        self.assertEqual(loaded.qwen.endpoint, "https://example.invalid/x")
        self.assertEqual(loaded.engine(), "qwen")
        self.assertEqual(loaded.server.port, 9000)
        self.assertEqual(loaded.api_path, self.api)

    def test_missing_api_file_falls_back_to_mock(self):
        loaded = load_config(path=self.config, api_path=self.api)
        self.assertEqual(loaded.qwen.api_key, "")
        self.assertEqual(loaded.engine(), "mock")

    def test_empty_key_falls_back_to_mock(self):
        self.api.write_text('[qwen]\napi_key = "   "\n', encoding="utf-8")
        loaded = load_config(path=self.config, api_path=self.api)
        self.assertEqual(loaded.engine(), "mock")

    def test_api_file_wins_over_legacy_section(self):
        self.config.write_text('[qwen]\napi_key = "sk-old"\n', encoding="utf-8")
        self.api.write_text('[qwen]\napi_key = "sk-new"\n', encoding="utf-8")
        loaded = load_config(path=self.config, api_path=self.api)
        self.assertEqual(loaded.qwen.api_key, "sk-new")

    def test_invalid_engine_rejected(self):
        self.api.write_text('[qwen]\napi_key = "sk-x"\n', encoding="utf-8")
        self.config.write_text('[subtitle]\nengine = "cloud"\n', encoding="utf-8")
        with self.assertRaises(ValueError):
            load_config(path=self.config, api_path=self.api)

    def test_same_source_and_target_rejected(self):
        self.config.write_text(
            '[subtitle]\nsource_language = "ja"\ntarget_languages = ["ja"]\n',
            encoding="utf-8",
        )
        with self.assertRaises(ValueError):
            load_config(path=self.config, api_path=self.api)

    def test_display_pairs_are_bounded(self):
        self.config.write_text("[display]\npairs = 9\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            load_config(path=self.config, api_path=self.api)

    def test_defaults_are_usable(self):
        loaded = load_config(path=self.root / "missing.toml", api_path=self.api)
        self.assertEqual(loaded.display.pairs, 3)
        self.assertEqual(loaded.subtitle.source_language, "ja")
        self.assertEqual(loaded.subtitle.target_languages, ("zh",))


if __name__ == "__main__":
    unittest.main()
