// 翻译适配器：千问 MT（fetch）与离线 mock。请求形状与 Python 版一致。
import { LANGUAGE_NAMES, resolvedEndpoint } from "./config.mjs";

export class MTError extends Error {
  constructor(code) {
    super(code);
    this.name = "MTError";
    this.code = code;
  }
}

export class MockTranslator {
  async translate(text, sourceLanguage, targetLanguage) {
    return `［mock·${targetLanguage}］${text}`;
  }
  async aclose() {}
}

export class QwenTranslator {
  constructor(qwen) {
    if (!qwen.apiKey || !qwen.apiKey.trim()) throw new Error("千问 API Key 为空");
    this.qwen = qwen;
    this.endpoint = resolvedEndpoint(qwen);
  }

  async translate(text, sourceLanguage, targetLanguage) {
    if (!(sourceLanguage in LANGUAGE_NAMES) || !(targetLanguage in LANGUAGE_NAMES)
        || sourceLanguage === targetLanguage) {
      throw new MTError("unsupported");
    }
    const body = {
      model: this.qwen.model,
      stream: false,
      max_tokens: 512,
      messages: [{ role: "user", content: text }],
      translation_options: {
        source_lang: LANGUAGE_NAMES[sourceLanguage],
        target_lang: LANGUAGE_NAMES[targetLanguage],
      },
    };
    let response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.qwen.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(Math.round(this.qwen.timeoutS * 1000)),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new MTError("deadline_exceeded");
      throw new MTError("unavailable");
    }

    if (response.status === 401 || response.status === 403) throw new MTError("authentication");
    if (response.status === 429) throw new MTError("rate_limited");
    if (response.status >= 500) throw new MTError("unavailable");
    if (response.status !== 200) throw new MTError("protocol_error");

    const raw = await response.text();
    if (raw.length > 65536) throw new MTError("protocol_error");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MTError("protocol_error");
    }
    let translated;
    try {
      const choices = parsed.choices;
      if (!Array.isArray(choices) || choices.length !== 1) throw new MTError("protocol_error");
      const message = choices[0].message;
      if (message.role !== "assistant") throw new MTError("protocol_error");
      translated = message.content;
    } catch (error) {
      if (error instanceof MTError) throw error;
      throw new MTError("protocol_error");
    }
    if (typeof translated !== "string") throw new MTError("protocol_error");
    translated = translated.trim();
    if (!translated || translated.length > 2000) throw new MTError("protocol_error");
    return translated;
  }

  async aclose() {}
}
