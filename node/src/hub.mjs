// 会话、字幕状态、翻译队列与 viewer 广播（从 Python 版 hub.py 移植）。
// JS 单线程，不需要锁；翻译仍然串行，两次请求之间保持最小间隔。
import { randomUUID } from "node:crypto";
import { LANGUAGE_NAMES } from "./config.mjs";

const MAX_VIEWERS = 16;
const MAX_TEXT_CHARS = 500;
const LANGUAGE_NAMES_SET = new Set(Object.keys(LANGUAGE_NAMES));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Session {
  constructor({ translator, sourceLanguage, targets, maxSentences = 100, minIntervalMs = 120, onChange = null }) {
    if (!targets || !targets.length) throw new Error("至少需要一个目标语言");
    this.id = randomId();
    this.translator = translator;
    this.sourceLanguage = sourceLanguage;
    this.targets = [...targets];
    this.maxSentences = maxSentences;
    this.minIntervalMs = minIntervalMs;
    this.onChange = onChange;
    this.closed = false;

    this.sentences = new Map();
    this.order = [];
    this.pending = new Map();
    this.working = false;
    this.lastRequest = 0;
    this.translatedCount = 0;
    this.failedCount = 0;
  }

  ingest(sentenceId, text, final) {
    if (this.closed) return;
    const id = String(sentenceId ?? "");
    let clean = String(text ?? "").trim();
    if (!id || !clean) return;
    clean = clean.slice(0, MAX_TEXT_CHARS);

    let sentence = this.sentences.get(id);
    if (!sentence) {
      if (this.order.length >= this.maxSentences) this.dropOldest();
      sentence = { id, source: "", final: false, translations: {}, errors: {}, translatedSource: "" };
      this.sentences.set(id, sentence);
      this.order.push(id);
    }
    sentence.source = clean;
    if (final) {
      sentence.final = true;
      if (sentence.translatedSource !== clean && this.pending.get(id) !== clean) {
        this.pending.set(id, clean);
        this.ensureWorker();
      }
    }
    this.emit();
  }

  snapshot() {
    return {
      type: "snapshot",
      session: this.id,
      source_language: this.sourceLanguage,
      targets: [...this.targets],
      sentences: this.order
        .filter((id) => this.sentences.has(id))
        .map((id) => {
          const item = this.sentences.get(id);
          return {
            id: item.id,
            source: item.source,
            final: item.final,
            translations: { ...item.translations },
            errors: { ...item.errors },
          };
        }),
    };
  }

  get stats() {
    return {
      sentences: this.order.length,
      pending: this.pending.size,
      translated: this.translatedCount,
      failed: this.failedCount,
    };
  }

  emit() {
    if (this.onChange) this.onChange(this, this.snapshot());
  }

  dropOldest() {
    const oldest = this.order.shift();
    if (oldest === undefined) return;
    this.sentences.delete(oldest);
    this.pending.delete(oldest);
  }

  ensureWorker() {
    if (this.working || !this.pending.size || this.closed) return;
    this.working = true;
    this.runWorker()
      .catch(() => {})
      .finally(() => {
        this.working = false;
        if (this.pending.size && !this.closed) this.ensureWorker();
      });
  }

  async runWorker() {
    while (this.pending.size && !this.closed) {
      const [id, text] = this.pending.entries().next().value;
      this.pending.delete(id);
      const sentence = this.sentences.get(id);
      if (!sentence || !sentence.final) continue;
      await this.translateSentence(sentence, text);
    }
  }

  async translateSentence(sentence, text) {
    for (const target of this.targets) {
      if (this.closed || this.sentences.get(sentence.id) !== sentence) return;
      const gap = this.minIntervalMs - (Date.now() - this.lastRequest);
      if (gap > 0) await sleep(gap);
      this.lastRequest = Date.now();
      try {
        const translated = await this.translator.translate(text, this.sourceLanguage, target);
        sentence.translations[target] = translated;
        delete sentence.errors[target];
        this.translatedCount += 1;
      } catch (error) {
        sentence.errors[target] = error?.code ?? "internal";
        this.failedCount += 1;
      }
      this.emit();
    }
    sentence.translatedSource = text;
  }

  close() {
    this.closed = true;
    this.pending.clear();
  }
}

export class Hub {
  constructor({ translator, sourceLanguage, targets, maxSentences = 100, minIntervalMs = 120, display = {} }) {
    this.translator = translator;
    this.defaultSource = sourceLanguage;
    this.defaultTargets = [...targets];
    this.maxSentences = maxSentences;
    this.minIntervalMs = minIntervalMs;
    this.display = { ...display };
    this.session = null;
    this.viewers = new Set();
  }

  startSession(sourceLanguage = null, targets = null) {
    const source = sourceLanguage || this.defaultSource;
    const targetList = [...(targets || this.defaultTargets)];
    if (!LANGUAGE_NAMES_SET.has(source)) throw new Error(`不支持的识别语言：${source}`);
    if (!targetList.length || targetList.some((item) => !LANGUAGE_NAMES_SET.has(item))) {
      throw new Error("不支持的译文语言");
    }
    if (targetList.includes(source)) throw new Error("译文语言不能和识别语言相同");

    const previous = this.session;
    const session = new Session({
      translator: this.translator,
      sourceLanguage: source,
      targets: targetList,
      maxSentences: this.maxSentences,
      minIntervalMs: this.minIntervalMs,
      onChange: (changed, payload) => {
        if (changed === this.session) this.broadcast(payload);
      },
    });
    this.session = session;
    if (previous) previous.close();
    this.broadcast(session.snapshot());
    return session;
  }

  stopSession(session = null) {
    if (session && session !== this.session) return;
    const current = this.session;
    this.session = null;
    if (current) current.close();
    this.broadcast({ type: "idle" });
  }

  subscribe(send) {
    if (this.viewers.size >= MAX_VIEWERS) throw new Error("viewer 数量已达上限");
    this.viewers.add(send);
    send(this.withDisplay(this.session ? this.session.snapshot() : { type: "idle" }));
    return () => this.viewers.delete(send);
  }

  unsubscribe(send) {
    this.viewers.delete(send);
  }

  updateDisplay(display) {
    this.display = { ...display };
    this.broadcast(this.session ? this.session.snapshot() : { type: "idle" });
  }

  withDisplay(payload) {
    if (payload.display !== undefined) return payload;
    return { ...payload, display: this.display };
  }

  broadcast(payload) {
    const message = this.withDisplay(payload);
    for (const send of [...this.viewers]) {
      try {
        send(message);
      } catch {
        this.viewers.delete(send);
      }
    }
  }

  async probe(source = null, target = null) {
    const from = source || this.defaultSource;
    const to = target || this.defaultTargets[0];
    if (!LANGUAGE_NAMES_SET.has(from) || !LANGUAGE_NAMES_SET.has(to) || from === to) {
      throw new Error("不支持的识别/译文语言");
    }
    const text = from === "ja" ? "こんにちは" : "Hello";
    return this.translator.translate(text, from, to);
  }

  async setTranslator(translator) {
    if (this.session) throw new Error("セッション中は翻訳エンジンを変更できません");
    const previous = this.translator;
    this.translator = translator;
    if (previous && previous !== translator) {
      try { await previous.aclose(); } catch {}
    }
  }

  async shutdown() {
    this.stopSession();
    try { await this.translator.aclose(); } catch {}
  }
}

function randomId() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}
