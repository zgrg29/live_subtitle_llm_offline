"""会话、字幕状态、翻译队列与 viewer 广播。

设计对应参考项目的 hosted.py(ingest_text/_text_worker) + subtitle_gateway.py + subtitle_state.py，
但去掉了额度、时间线、审计与多目标并发：单机单人，一次只跑一个会话。
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

MAX_VIEWERS = 16
MAX_TEXT_CHARS = 500


@dataclass
class Sentence:
    sentence_id: str
    source: str = ""
    final: bool = False
    translations: dict[str, str] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)
    translated_source: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.sentence_id,
            "source": self.source,
            "final": self.final,
            "translations": dict(self.translations),
            "errors": dict(self.errors),
        }


class Session:
    """一个字幕会话：保存最近若干句、串行翻译定稿句、每次变化通知 Hub。

    - 只对 ``final=True`` 的句子调用翻译，每句一次（同句重复定稿且文本变长才重翻）。
    - 翻译串行执行，两次请求之间至少间隔 ``min_interval_ms``，避免触发限流。
    - 单句失败只记录错误码，不抛给调用方，也不影响后续句子。
    - 超过 ``max_sentences`` 时丢最旧的一句（与参考项目「滚动窗口」语义一致）。
    """

    def __init__(
        self,
        translator: Any,
        source_language: str,
        targets: tuple[str, ...],
        *,
        max_sentences: int = 100,
        min_interval_ms: int = 120,
        on_change: Callable[["Session", dict[str, Any]], None] | None = None,
    ):
        if not targets:
            raise ValueError("至少需要一个目标语言")
        self.session_id = uuid.uuid4().hex[:8]
        self.translator = translator
        self.source_language = source_language
        self.targets = tuple(targets)
        self.max_sentences = max_sentences
        self.min_interval_ms = min_interval_ms
        self._on_change = on_change

        self._sentences: dict[str, Sentence] = {}
        self._order: list[str] = []
        self._pending: dict[str, str] = {}
        self._worker: asyncio.Task | None = None
        self._last_request = 0.0
        self._closed = False
        self._translated_count = 0
        self._failed_count = 0

    # ---------------------------------------------------------------- 输入

    def ingest(self, sentence_id: Any, text: str, final: bool) -> None:
        """接收一句识别文本（中间结果或定稿）。空文本直接忽略。"""
        if self._closed:
            return
        sentence_id = str(sentence_id)
        text = (text or "").strip()
        if not text or not sentence_id:
            return
        text = text[:MAX_TEXT_CHARS]

        sentence = self._sentences.get(sentence_id)
        if sentence is None:
            if len(self._order) >= self.max_sentences:
                self._drop_oldest()
            sentence = Sentence(sentence_id)
            self._sentences[sentence_id] = sentence
            self._order.append(sentence_id)

        sentence.source = text
        if final:
            sentence.final = True
            # 已经译过同样文本就不重复花钱；文本变长了才重翻。
            if sentence.translated_source != text and self._pending.get(sentence_id) != text:
                self._pending[sentence_id] = text
                self._ensure_worker()
        self._emit()

    # ---------------------------------------------------------------- 状态

    def snapshot(self) -> dict[str, Any]:
        return {
            "type": "snapshot",
            "session": self.session_id,
            "source_language": self.source_language,
            "targets": list(self.targets),
            "sentences": [
                self._sentences[sentence_id].as_dict()
                for sentence_id in self._order
                if sentence_id in self._sentences
            ],
        }

    @property
    def stats(self) -> dict[str, int]:
        return {
            "sentences": len(self._order),
            "pending": len(self._pending),
            "translated": self._translated_count,
            "failed": self._failed_count,
        }

    def _emit(self) -> None:
        if self._on_change is not None:
            self._on_change(self, self.snapshot())

    def _drop_oldest(self) -> None:
        if not self._order:
            return
        oldest = self._order.pop(0)
        self._sentences.pop(oldest, None)
        self._pending.pop(oldest, None)

    # ---------------------------------------------------------------- 翻译

    def _ensure_worker(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.get_running_loop().create_task(self._run_worker())

    async def _run_worker(self) -> None:
        try:
            while self._pending and not self._closed:
                sentence_id, text = next(iter(self._pending.items()))
                del self._pending[sentence_id]
                sentence = self._sentences.get(sentence_id)
                if sentence is None or not sentence.final:
                    continue
                await self._translate(sentence, text)
        finally:
            self._worker = None

    async def _translate(self, sentence: Sentence, text: str) -> None:
        from .mt import MTError

        for target in self.targets:
            if self._closed or self._sentences.get(sentence.sentence_id) is not sentence:
                return
            gap = self.min_interval_ms / 1000.0 - (time.monotonic() - self._last_request)
            if gap > 0:
                await asyncio.sleep(gap)
            self._last_request = time.monotonic()
            try:
                translated = await self.translator.translate(text, self.source_language, target)
            except MTError as exc:
                sentence.errors[target] = exc.code
                self._failed_count += 1
            except asyncio.CancelledError:
                raise
            except Exception:
                # 供应商返回了意料之外的东西：也只丢这一句。
                sentence.errors[target] = "internal"
                self._failed_count += 1
            else:
                sentence.translations[target] = translated
                sentence.errors.pop(target, None)
                self._translated_count += 1
            self._emit()
        sentence.translated_source = text

    # ---------------------------------------------------------------- 关闭

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._pending.clear()
        worker = self._worker
        if worker is not None and not worker.done():
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        self._worker = None


class Hub:
    """当前会话 + 所有 viewer 的订阅关系。

    viewer 队列长度固定为 1：慢的客户端只会拿到最新快照，不会积压。
    """

    def __init__(
        self,
        translator: Any,
        source_language: str,
        targets: tuple[str, ...],
        *,
        max_sentences: int = 100,
        min_interval_ms: int = 120,
        display: dict[str, Any] | None = None,
    ):
        self._translator = translator
        self._source_language = source_language
        self._targets = tuple(targets)
        self._max_sentences = max_sentences
        self._min_interval_ms = min_interval_ms
        self.display: dict[str, Any] = dict(display or {})
        self.session: Session | None = None
        self._viewers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def start_session(
        self,
        source_language: str | None = None,
        targets: list[str] | None = None,
    ) -> Session:
        """开始新会话；旧会话（如果还在）先停掉。"""
        source = source_language or self._source_language
        target_tuple = tuple(targets or self._targets)
        if source not in self._allowed_sources():
            raise ValueError(f"不支持的识别语言：{source}")
        if not target_tuple or any(target not in self._allowed_targets() for target in target_tuple):
            raise ValueError("不支持的译文语言")
        if source in target_tuple:
            raise ValueError("译文语言不能和识别语言相同")

        async with self._lock:
            previous = self.session
            session = Session(
                self._translator,
                source,
                target_tuple,
                max_sentences=self._max_sentences,
                min_interval_ms=self._min_interval_ms,
                on_change=self._on_session_change,
            )
            self.session = session
            if previous is not None:
                await previous.aclose()
            self._broadcast(session.snapshot())
            return session

    async def stop_session(self, session: Session | None = None) -> None:
        """停止会话。传入 session 时，只有它仍是当前会话才会停。"""
        async with self._lock:
            if session is not None and session is not self.session:
                return
            current = self.session
            self.session = None
            if current is not None:
                await current.aclose()
            self._broadcast({"type": "idle"})

    def subscribe(self) -> asyncio.Queue:
        if len(self._viewers) >= MAX_VIEWERS:
            raise ValueError("viewer 数量已达上限")
        queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        session = self.session
        base = session.snapshot() if session is not None else {"type": "idle"}
        queue.put_nowait(self._with_display(base))
        self._viewers.add(queue)
        return queue

    def update_display(self, display: dict[str, Any]) -> None:
        """样式改了：存下来，并立刻推一份当前画面，让 OBS 不用刷新。"""
        self.display = dict(display)
        session = self.session
        self._broadcast(session.snapshot() if session is not None else {"type": "idle"})

    def _with_display(self, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("display") is not None:
            return payload
        return {**payload, "display": self.display}

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._viewers.discard(queue)

    async def probe(self, source: str | None = None, target: str | None = None) -> str:
        """接続テスト用に 1 文だけ翻訳する（セッションは作らない）。"""
        source = source or self._source_language
        target = target or self._targets[0]
        if (source not in self._allowed_sources() or target not in self._allowed_targets()
                or source == target):
            raise ValueError("不支持的识别/译文语言")
        text = "こんにちは" if source == "ja" else "Hello"
        return await self._translator.translate(text, source, target)

    async def set_translator(self, translator: Any) -> None:
        """切换翻译引擎（区域/引擎变更）。调用前必须确保没有正在进行的会话。"""
        if self.session is not None:
            raise ValueError("セッション中は翻訳エンジンを変更できません")
        previous = self._translator
        self._translator = translator
        if previous is not None and previous is not translator:
            try:
                await previous.aclose()
            except Exception:
                pass

    def _on_session_change(self, session: Session, payload: dict[str, Any]) -> None:
        # 旧会话的残余事件不能覆盖新会话的画面。
        if session is self.session:
            self._broadcast(payload)

    def _broadcast(self, payload: dict[str, Any]) -> None:
        payload = self._with_display(payload)
        for queue in list(self._viewers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def shutdown(self) -> None:
        await self.stop_session()
        await self._translator.aclose()

    @staticmethod
    def _allowed_sources() -> frozenset[str]:
        from .config import LANGUAGE_NAMES

        return frozenset(LANGUAGE_NAMES)

    @staticmethod
    def _allowed_targets() -> frozenset[str]:
        from .config import LANGUAGE_NAMES

        return frozenset(LANGUAGE_NAMES)
