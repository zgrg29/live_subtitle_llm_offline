import test from "node:test";
import assert from "node:assert/strict";
import { Hub, Session } from "../src/hub.mjs";
import { FakeTranslator, waitFor } from "./helpers.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("partial then final translates once", async () => {
  const translator = new FakeTranslator();
  const session = new Session({ translator, sourceLanguage: "ja", targets: ["zh"], minIntervalMs: 0 });
  session.ingest("1", "こんにちは", false);
  session.ingest("1", "こんにちは、元気ですか", false);
  let snapshot = session.snapshot();
  assert.equal(snapshot.sentences.length, 1);
  assert.equal(snapshot.sentences[0].source, "こんにちは、元気ですか");
  assert.deepEqual(snapshot.sentences[0].translations, {});

  session.ingest("1", "こんにちは、元気ですか", true);
  await waitFor(() => session.snapshot().sentences[0].translations.zh);
  assert.equal(session.snapshot().sentences[0].translations.zh, "译:こんにちは、元気ですか");

  session.ingest("1", "こんにちは、元気ですか", true);
  await sleep(60);
  assert.equal(translator.calls.length, 1);
});

test("partial only never calls translator", async () => {
  const translator = new FakeTranslator();
  const session = new Session({ translator, sourceLanguage: "ja", targets: ["zh"], minIntervalMs: 0 });
  session.ingest("1", "途中", false);
  await sleep(60);
  assert.equal(translator.calls.length, 0);
});

test("failed sentence is isolated", async () => {
  const translator = new FakeTranslator(["坏句子"]);
  const session = new Session({ translator, sourceLanguage: "ja", targets: ["zh"], minIntervalMs: 0 });
  session.ingest("1", "坏句子", true);
  await waitFor(() => session.snapshot().sentences[0].errors.zh);
  assert.equal(session.snapshot().sentences[0].errors.zh, "unavailable");

  session.ingest("2", "好句子", true);
  await waitFor(() => session.snapshot().sentences[1]?.translations.zh);
  assert.equal(session.snapshot().sentences[1].translations.zh, "译:好句子");
});

test("sentences are bounded", () => {
  const session = new Session({
    translator: new FakeTranslator(), sourceLanguage: "ja", targets: ["zh"],
    maxSentences: 3, minIntervalMs: 0,
  });
  for (let i = 0; i < 6; i++) session.ingest(String(i), `句${i}`, true);
  assert.deepEqual(session.snapshot().sentences.map((item) => item.id), ["3", "4", "5"]);
});

test("multi target translates each", async () => {
  const session = new Session({
    translator: new FakeTranslator(), sourceLanguage: "ja", targets: ["zh", "en"], minIntervalMs: 0,
  });
  session.ingest("1", "おはよう", true);
  await waitFor(() => Object.keys(session.snapshot().sentences[0].translations).length === 2);
  assert.equal(session.snapshot().sentences[0].translations.en, "译:おはよう");
});

test("viewer gets latest snapshot", () => {
  const hub = new Hub({
    translator: new FakeTranslator(), sourceLanguage: "ja", targets: ["zh"],
    minIntervalMs: 0, display: { pairs: 2 },
  });
  const session = hub.startSession();
  const received = [];
  hub.subscribe((payload) => received.push(payload));
  session.ingest("1", "やあ", true);
  assert.equal(received[0].type, "snapshot");
  assert.equal(received[0].display.pairs, 2);
  assert.equal(received.at(-1).sentences[0].source, "やあ");
});

test("new session replaces old", () => {
  const hub = new Hub({ translator: new FakeTranslator(), sourceLanguage: "ja", targets: ["zh"] });
  const first = hub.startSession();
  const second = hub.startSession("en", ["zh"]);
  assert.notEqual(first, second);
  assert.equal(hub.session, second);
  assert.equal(first.closed, true);
});

test("stop session keeps new session", () => {
  const hub = new Hub({ translator: new FakeTranslator(), sourceLanguage: "ja", targets: ["zh"] });
  const first = hub.startSession();
  const second = hub.startSession();
  hub.stopSession(first);
  assert.equal(hub.session, second);
});

test("probe uses requested languages", async () => {
  const translator = new FakeTranslator();
  const hub = new Hub({ translator, sourceLanguage: "ja", targets: ["zh"] });
  const sample = await hub.probe("en", "zh");
  assert.match(sample, /Hello/);
  await assert.rejects(hub.probe("zh", "zh"), /不支持/);
});
