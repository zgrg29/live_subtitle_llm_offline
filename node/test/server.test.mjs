import test from "node:test";
import assert from "node:assert/strict";
import { startServer, FakeTranslator, connect, messageQueue, waitFor } from "./helpers.mjs";

test("pages, health, display and static files", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const health = await (await fetch(`${srv.base}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.engine, "mock");
  assert.equal(health.region, "cn");

  const index = await fetch(`${srv.base}/`, { redirect: "manual" });
  assert.equal(index.status, 302);
  assert.equal(index.headers.get("location"), "/studio");

  const studio = await (await fetch(`${srv.base}/studio`)).text();
  assert.match(studio, /LiveSub Local/);
  assert.match(studio, /id="ui-lang"/);

  const view = await (await fetch(`${srv.base}/view`)).text();
  assert.match(view, /id="stage"/);

  const css = await fetch(`${srv.base}/static/ui.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);

  const display = await (await fetch(`${srv.base}/api/display`)).json();
  assert.equal(display.pairs, 2);
  assert.equal(display.position, "bottom");
  assert.deepEqual(display.target_languages, ["zh"]);
});

test("language catalog has 25 entries", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const data = await (await fetch(`${srv.base}/api/languages`)).json();
  const codes = data.languages.map((item) => item.code);
  assert.equal(codes.length, 25);
  assert.deepEqual(codes.slice(0, 4), ["ja", "zh", "en", "ko"]);
  const japanese = data.languages[0];
  assert.equal(japanese.browser, "ja-JP");
  assert.equal(japanese.label, "日本語");
});

test("text websocket translates once per final sentence", async (t) => {
  const translator = new FakeTranslator();
  const srv = await startServer({ translator });
  t.after(() => srv.close());

  const text = await connect(`${srv.wsBase}/v1/text?source=ja&targets=zh`);
  t.after(() => text.close());
  const textQueue = messageQueue(text);
  const ready = await textQueue.next();
  assert.equal(ready.type, "ready");
  assert.equal(ready.source_language, "ja");
  assert.deepEqual(ready.targets, ["zh"]);

  text.send(JSON.stringify({ type: "ping" }));
  const pong = await textQueue.next();
  assert.equal(pong.type, "pong");

  text.send(JSON.stringify({ id: 1, text: "おはよう", final: true }));
  await waitFor(() => srv.app.hub.session?.snapshot().sentences[0]?.translations.zh);
  assert.deepEqual(translator.calls, [["おはよう", "ja", "zh"]]);
});

test("text websocket accepts other languages", async (t) => {
  const translator = new FakeTranslator();
  const srv = await startServer({ translator });
  t.after(() => srv.close());

  const text = await connect(`${srv.wsBase}/v1/text?source=en&targets=zh`);
  t.after(() => text.close());
  const queue = messageQueue(text);
  const ready = await queue.next();
  assert.equal(ready.source_language, "en");
  text.send(JSON.stringify({ id: 1, text: "hello", final: true }));
  await waitFor(() => srv.app.hub.session?.snapshot().sentences[0]?.translations.zh);
  assert.deepEqual(translator.calls.at(-1), ["hello", "en", "zh"]);
});

test("view websocket receives snapshot with display", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const view = await connect(`${srv.wsBase}/v1/view`);
  t.after(() => view.close());
  const first = await messageQueue(view).next();
  assert.equal(first.type, "idle");
  assert.equal(first.display.target_size, 44);
});

test("display update is clamped, pushed and persisted", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const response = await fetch(`${srv.base}/api/display`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_size: 88, position: "top", pairs: 9, order: "top" }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.target_size, 88);
  assert.equal(data.pairs, 6);
  assert.equal(data.position, "top");
  assert.equal(srv.app.hub.display.target_size, 88);

  const saved = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(srv.app.settingsFile, "utf8")),
  );
  assert.equal(saved.display.target_size, 88);

  const reset = await (await fetch(`${srv.base}/api/display/reset`, { method: "POST" })).json();
  assert.equal(reset.target_size, 44);
});

test("display rejects unknown or invalid fields", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  for (const body of [{ nope: 1 }, { target_size: "big" }, { target_color: "red" }]) {
    const response = await fetch(`${srv.base}/api/display`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("engine info, region switch and 409 while streaming", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const info = await (await fetch(`${srv.base}/api/engine`)).json();
  assert.equal(info.region, "cn");
  assert.match(info.endpoint, /dashscope\.aliyuncs\.com/);

  const text = await connect(`${srv.wsBase}/v1/text?source=ja&targets=zh`);
  t.after(() => text.close());
  await messageQueue(text).next();

  const blocked = await fetch(`${srv.base}/api/engine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: "intl" }),
  });
  assert.equal(blocked.status, 409);
  text.close();

  await waitFor(() => srv.app.hub.session === null);
  const switched = await fetch(`${srv.base}/api/engine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: "intl" }),
  });
  assert.equal(switched.status, 200);
  const data = await switched.json();
  assert.equal(data.region, "intl");
  assert.match(data.endpoint, /dashscope-intl/);

  const bad = await fetch(`${srv.base}/api/engine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: "us" }),
  });
  assert.equal(bad.status, 400);
});

test("engine test endpoint", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const ok = await (await fetch(`${srv.base}/api/engine/test`, { method: "POST" })).json();
  assert.equal(ok.ok, true);
  assert.equal(ok.engine, "mock");
  assert.match(ok.sample, /こんにちは/);

  const english = await (await fetch(`${srv.base}/api/engine/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "en", target: "zh" }),
  })).json();
  assert.match(english.sample, /Hello/);

  const bad = await fetch(`${srv.base}/api/engine/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "zh", target: "zh" }),
  });
  assert.equal(bad.status, 400);
});
